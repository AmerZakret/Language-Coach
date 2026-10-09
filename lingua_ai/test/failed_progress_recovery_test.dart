import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/api_response.dart';
import 'package:lingua_ai/services/flashcard_api_service.dart';
import 'package:lingua_ai/services/offline_queue_service.dart';
import 'package:lingua_ai/services/progress_api_service.dart';
import 'package:lingua_ai/services/progress_cache.dart';
import 'package:lingua_ai/services/progress_epoch.dart';
import 'package:lingua_ai/services/sync_retry_policy.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const a = '507f1f77bcf86cd799439011', b = '507f1f77bcf86cd799439012';
  final auth = AuthService();
  late SharedPreferences prefs;
  late OfflineQueueService queue;
  late String owner;
  var now = DateTime.utc(2026);
  Future<void> login(String id, [String? token]) => auth.setGuestSession(
      id: id,
      email: 'guest-$id@guest.lingua.local',
      token: token ?? 'test-$id');
  Future<bool> drain(Future<http.Response> Function(http.Request) send) =>
      http.runWithClient(() => queue.processQueue(a), () => MockClient(send));
  Future<bool> reconcile(
          String id, Future<http.Response> Function(http.Request) send) =>
      http.runWithClient(
          () => queue.reconcileFailedReset(id), () => MockClient(send));
  Future<void> completion({dynamic epoch = 0, String? id}) => queue.pushAction(
      'complete-lesson',
      {
        'lessonId': 'one',
        'score': 73,
        'targetLanguage': 'en',
        '_lessonLanguageBound': true,
        'xpReward': 50,
        if (epoch != null) 'progressEpoch': epoch
      },
      ownerNamespace: owner,
      operationId: id);
  Future<OfflineQueueAction> failedReset() async {
    await queue.pushAction('reset-progress', {'expectedEpoch': 0},
        ownerNamespace: owner);
    expect(await drain((_) async => http.Response('{}', 403)), false);
    return (await queue.getFailedActions()).single;
  }

  http.Response receipt(OfflineQueueAction action) => http.Response(
      jsonEncode({
        'userId': a,
        'operationId': action.id,
        'expectedEpoch': action.payload['expectedEpoch'],
        'progressEpoch': action.payload['expectedEpoch'] + 1
      }),
      200);
  setUp(() async {
    now = DateTime.utc(2026);
    SharedPreferences.setMockInitialValues({});
    await auth.init();
    await login(a);
    owner = auth.localStorageNamespace;
    prefs = await SharedPreferences.getInstance();
    await ProgressEpoch.acknowledge(prefs, owner, 0);
    queue = OfflineQueueService.forTesting(
        progressApi: ProgressApiService(),
        flashcardApi: FlashcardApiService(),
        now: () => now);
  });

  for (final entry in {
    'STALE_PROGRESS_EPOCH': 'stale-epoch',
    'FUTURE_PROGRESS_EPOCH': 'future-epoch',
    'STALE_RESET_EPOCH': 'stale-reset-epoch',
    'FUTURE_RESET_EPOCH': 'future-reset-epoch',
    'RESET_IDEMPOTENCY_CONFLICT': 'reset-key-conflict',
    'INVALID_PROGRESS_EPOCH': 'invalid-epoch',
    'MISSING_PROGRESS_EPOCH': 'missing-epoch',
  }.entries) {
    test(
        '6E: ${entry.key} is terminal and diagnostic metadata survives restart',
        () async {
      if (entry.key == 'RESET_IDEMPOTENCY_CONFLICT' ||
          entry.key.endsWith('RESET_EPOCH')) {
        await queue.pushAction('reset-progress', {'expectedEpoch': 0},
            ownerNamespace: owner);
      } else {
        await completion();
      }
      final original = (await queue.getQueue()).single;
      expect(
          await drain((_) async => http.Response(
              jsonEncode({'code': entry.key, 'message': 'Epoch rejected'}),
              409)),
          false);
      final failed = (await queue.getFailedActions()).single;
      expect(failed.id, original.id);
      expect(failed.payload, original.payload);
      expect(failed.lastErrorCategory, entry.value);
      expect(failed.lastErrorCode, entry.key);
      expect(failed.lastErrorStatus, 409);
      expect(failed.failedAt, isNotNull);
      final disk = {for (final key in prefs.getKeys()) key: prefs.get(key)!};
      SharedPreferences.setMockInitialValues(disk);
      expect((await queue.getFailedActions()).single.toJson(), failed.toJson());
      expect(await drain((_) async => throw StateError('No automatic resend')),
          true);
    });
  }

  test(
      '6E: failed N completion cannot be relabeled/recovered after reset; new N+1 work is independent',
      () async {
    await completion();
    final original = (await queue.getQueue()).single;
    expect(
        await drain(
            (_) async => http.Response('{"code":"STALE_PROGRESS_EPOCH"}', 409)),
        false);
    final evidence = (await queue.getFailedActions()).single.toJson();
    await queue.pushAction('reset-progress', {'expectedEpoch': 0},
        ownerNamespace: owner);
    expect(await drain((_) async => http.Response('{"progressEpoch":1}', 200)),
        true);
    expect(ProgressEpoch.read(prefs, owner), 1);
    await expectLater(completion(epoch: 1, id: original.id), throwsStateError);
    expect(await queue.reconcileFailedReset(original.id), false);
    expect((await queue.getFailedActions()).single.toJson(), evidence);
    expect(await queue.epochForNewProgress(owner), 1);
    await completion(epoch: 1);
    expect((await queue.getQueue()).single.id, isNot(original.id));
    expect(
        await drain((request) async {
          expect(jsonDecode(request.body)['progressEpoch'], 1);
          expect(request.headers['X-Idempotency-Key'], isNot(original.id));
          return http.Response(
              '{"data":{"progressEpoch":1,"newTotalXp":50,"targetLanguage":"en","score":73}}',
              201);
        }),
        true);
    expect((await queue.getFailedActions()).single.toJson(), evidence);
    expect(ProgressSnapshot.read(prefs, owner, 'en').totalXp, 50);
  });

  test(
      '6E: uncommitted terminal reset is diagnostic and does not hide progress or block valid work',
      () async {
    await ProgressSnapshot(progressEpoch: 0, totalXp: 80, lessonIds: {'server'})
        .save(prefs, owner, 'en');
    final action = await failedReset();
    expect(ProgressEpoch.read(prefs, owner), 0);
    expect(await queue.epochForNewProgress(owner), 0);
    final pending = await queue.getProgressActions();
    final visible = ProgressSnapshot.read(prefs, owner, 'en').overlay(
        pending.where((a) => a.type == 'complete-lesson').map((a) => a.payload),
        reset: pending.any((a) => a.type == 'reset-progress'));
    expect(visible.totalXp, 80);
    expect(visible.lessonIds, {'server'});
    final evidence = action.toJson();
    expect(
        await reconcile(action.id, (request) async {
          expect(request.method, 'GET');
          return http.Response('{"code":"RESET_NOT_COMMITTED"}', 404);
        }),
        false);
    expect((await queue.getFailedActions()).single.toJson(), evidence);
    await completion();
    expect(
        await drain(
            (_) async => http.Response('{"data":{"progressEpoch":0}}', 201)),
        true);
    expect(ProgressEpoch.read(prefs, owner), 0);
  });

  test(
      '6E: lost reset ack retries exact operation and becomes success-equivalent once',
      () async {
    await queue.pushAction('reset-progress', {'expectedEpoch': 0},
        ownerNamespace: owner, operationId: 'lost-ack');
    var committed = false, resets = 0;
    Future<http.Response> send(http.Request request) async {
      expect(request.headers['X-Idempotency-Key'], 'lost-ack');
      expect(jsonDecode(request.body)['expectedEpoch'], 0);
      if (!committed) {
        committed = true;
        resets++;
        throw http.ClientException('lost acknowledgement');
      }
      return http.Response('{"progressEpoch":1}', 200);
    }

    expect(await drain(send), false);
    expect(ProgressEpoch.read(prefs, owner), 0);
    expect((await queue.getQueue()).single.lastErrorCategory, 'network');
    now = now.add(const Duration(minutes: 6));
    expect(await drain(send), true);
    expect(resets, 1);
    expect(ProgressEpoch.read(prefs, owner), 1);
    expect(await queue.getFailedActions(), isEmpty);
  });

  test(
      '6E: failed reset receipt reconciliation preserves identity and cannot erase newer progress',
      () async {
    final action = await failedReset();
    Future<http.Response> send(http.Request request) async {
      expect(request.method, 'GET');
      expect(request.url.path, '/progress/$a/reset-receipts/${action.id}');
      expect(request.url.queryParameters['expectedEpoch'], '0');
      return receipt(action);
    }

    expect(await reconcile(action.id, send), true);
    expect(ProgressEpoch.read(prefs, owner), 1);
    final reconciled = (await queue.getFailedActions()).single;
    expect(reconciled.id, action.id);
    expect(reconciled.ownerNamespace, action.ownerNamespace);
    expect(reconciled.payload, action.payload);
    expect(reconciled.failedAt, action.failedAt);
    expect(reconciled.lastErrorCategory, action.lastErrorCategory);
    expect(reconciled.lastErrorStatus, action.lastErrorStatus);
    expect(reconciled.acknowledgedEpoch, 1);
    expect(reconciled.reconciledAt, isNotNull);
    expect(await queue.getQueue(), isEmpty);
    for (final epoch in [1, 2]) {
      await ProgressEpoch.acknowledge(prefs, owner, epoch);
      await ProgressSnapshot(
          progressEpoch: epoch,
          totalXp: 80,
          lessonIds: {'new'}).save(prefs, owner, 'en');
      expect(await reconcile(action.id, send), true);
      expect(ProgressEpoch.read(prefs, owner), epoch);
      expect(ProgressSnapshot.read(prefs, owner, 'en').totalXp, 80);
    }
  });

  test('6E: stale reset and receipt key conflict cannot delete newer progress',
      () async {
    await ProgressEpoch.acknowledge(prefs, owner, 2);
    await ProgressSnapshot(progressEpoch: 2, totalXp: 80, lessonIds: {'new'})
        .save(prefs, owner, 'en');
    await queue.pushAction('reset-progress', {'expectedEpoch': 0},
        ownerNamespace: owner);
    expect(
        await drain(
            (_) async => http.Response('{"code":"STALE_RESET_EPOCH"}', 409)),
        false);
    final action = (await queue.getFailedActions()).single;
    expect(action.lastErrorCategory, 'stale-reset-epoch');
    expect(
        await reconcile(
            action.id,
            (_) async =>
                http.Response('{"code":"RESET_IDEMPOTENCY_CONFLICT"}', 409)),
        false);
    expect((await queue.getFailedActions()).single.toJson(), action.toJson());
    expect(ProgressEpoch.read(prefs, owner), 2);
    expect(ProgressSnapshot.read(prefs, owner, 'en').totalXp, 80);
  });

  test('6E: recovery cannot cross owners or a replaced session', () async {
    final action = await failedReset(), evidence = action.toJson();
    await login(b);
    expect(await queue.getFailedActions(), isEmpty);
    expect(await queue.reconcileFailedReset(action.id), false);
    await login(a);
    final started = Completer<void>(), release = Completer<http.Response>();
    final pending = reconcile(action.id, (_) {
      started.complete();
      return release.future;
    });
    await started.future;
    await login(a, 'replacement-token');
    release.complete(receipt(action));
    expect(await pending, false);
    expect((await queue.getFailedActions()).single.toJson(), evidence);
    expect(ProgressEpoch.read(prefs, owner), 0);
  });

  for (final field in [
    'userId',
    'operationId',
    'expectedEpoch',
    'progressEpoch'
  ]) {
    test('6E: wrong receipt $field cannot advance epoch', () async {
      final action = await failedReset();
      expect(
          await reconcile(action.id, (_) async {
            final body =
                jsonDecode(receipt(action).body) as Map<String, dynamic>;
            body[field] = 'wrong';
            return http.Response(jsonEncode(body), 200);
          }),
          false);
      expect(ProgressEpoch.read(prefs, owner), 0);
      expect((await queue.getFailedActions()).single.toJson(), action.toJson());
    });
  }

  test(
      '6E: missing/malformed legacy epochs never upgrade and failed overlay stays excluded',
      () async {
    await ProgressEpoch.acknowledge(prefs, owner, 5);
    for (final epoch in [null, -1, 1.5, '5']) {
      await completion(epoch: epoch);
      expect(await drain((_) async => throw StateError('Must not dispatch')),
          false);
    }
    final actions = await queue.getFailedActions();
    expect(actions, hasLength(4));
    expect(actions.first.payload.containsKey('progressEpoch'), false);
    expect(actions.first.lastErrorCode, 'MISSING_PROGRESS_EPOCH');
    for (final action in actions) {
      expect(await queue.reconcileFailedReset(action.id), false);
    }
    final visible =
        ProgressSnapshot(progressEpoch: 5, totalXp: 80, lessonIds: {'server'})
            .overlay((await queue.getProgressActions()).map((a) => a.payload));
    expect(visible.totalXp, 80);
    expect(visible.lessonIds, {'server'});
    expect(ProgressEpoch.read(prefs, owner), 5);
  });

  test(
      '6E: server/network failures remain retryable and unknown conflicts stay conservative',
      () async {
    final server = SyncFailure.classify(const ApiException(
        ApiFailure.server, 'unavailable', 503, false, 'STALE_PROGRESS_EPOCH'));
    expect(server.category, 'backend');
    expect(server.terminal, false);
    expect(
        SyncFailure.classify(const SyncHttpException(409, 'UNKNOWN_CONFLICT'))
            .category,
        'conflict');
    expect(SyncFailure.classify(Exception('offline')).terminal, false);
    await completion();
    expect(await drain((_) async => http.Response('{}', 503)), false);
    expect((await queue.getQueue()).single.lastErrorCategory, 'backend');
    expect((await queue.getQueue()).single.nextAttemptAt, isNotNull);
    expect(await queue.getFailedActions(), isEmpty);
  });
}
