import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/flashcard_api_service.dart';
import 'package:lingua_ai/services/offline_queue_service.dart';
import 'package:lingua_ai/services/progress_api_service.dart';
import 'package:lingua_ai/services/progress_cache.dart';
import 'package:lingua_ai/services/progress_epoch.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const a = '507f1f77bcf86cd799439011';
  const b = '507f1f77bcf86cd799439012';
  final auth = AuthService();
  late SharedPreferences prefs;
  late OfflineQueueService queue;
  var now = DateTime.utc(2026);
  String getOwner() => auth.localStorageNamespace;
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await auth.init();
    await auth.setGuestSession(
        id: a, email: 'guest-a@guest.lingua.local', token: 'test-a');
    prefs = await SharedPreferences.getInstance();
    queue = OfflineQueueService.forTesting(
        progressApi: ProgressApiService(),
        flashcardApi: FlashcardApiService(),
        now: () => now);
  });
  Future<void> enqueue({int? epoch = 0}) => queue.pushAction(
      'complete-lesson',
      {
        'lessonId': 'one',
        'score': 73,
        'targetLanguage': 'en',
        'xpReward': 50,
        if (epoch != null) 'progressEpoch': epoch,
      },
      ownerNamespace: getOwner());

  test(
      'owner epoch survives restart and cannot cross backend guests, registered owners or local_guest',
      () async {
    final owner = getOwner();
    expect(await ProgressEpoch.acknowledge(prefs, owner, 3), true);
    final disk = {for (final key in prefs.getKeys()) key: prefs.get(key)!};
    SharedPreferences.setMockInitialValues(disk);
    prefs = await SharedPreferences.getInstance();
    expect(ProgressEpoch.read(prefs, owner), 3);
    expect(ProgressEpoch.read(prefs, 'guest_$b'), isNull);
    expect(ProgressEpoch.read(prefs, 'registered_$a'), isNull);
    expect(await ProgressEpoch.acknowledge(prefs, 'registered_$b', 1), true);
    expect(ProgressEpoch.read(prefs, owner), 3);
    expect(await ProgressEpoch.acknowledge(prefs, 'local_guest', 4), false);
    expect(ProgressEpoch.read(prefs, 'local_guest'), isNull);
    await prefs.setString(ProgressEpoch.key('registered_$b'), '');
    expect(ProgressEpoch.read(prefs, 'registered_$b'), isNull);
  });
  test(
      'old epoch progress/ack responses cannot overwrite new cache; stale session writes are rejected',
      () async {
    final owner = getOwner();
    await ProgressEpoch.acknowledge(prefs, owner, 1);
    await ProgressSnapshot(totalXp: 80, lessonIds: {'new'})
        .save(prefs, owner, 'en');
    final revision = await queue.progressRevision(owner);
    expect(
        await queue.saveServerProgress(owner, 'en', revision,
            ProgressSnapshot(totalXp: 999, progressEpoch: 0)),
        false);
    expect(
        await queue.saveServerProgress(owner, 'en', revision,
            ProgressSnapshot(totalXp: 999, progressEpoch: 2),
            isCurrent: () => false),
        false);
    await enqueue(epoch: 0);
    await http.runWithClient(() async {
      expect(await queue.processQueue(a), true);
    },
        () => MockClient((request) async => http.Response(
            jsonEncode({
              'data': {'progressEpoch': 0, 'newTotalXp': 999}
            }),
            201)));
    expect(ProgressSnapshot.read(prefs, owner, 'en').totalXp, 80);
    expect(ProgressEpoch.read(prefs, owner), 1);
  });
  test(
      'replay and restart keep exact original epoch and operation; terminal quarantine retains it',
      () async {
    await ProgressEpoch.acknowledge(prefs, getOwner(), 0);
    await enqueue();
    final original = (await queue.getQueue()).single;
    final sent = <http.Request>[];
    await http.runWithClient(() async {
      expect(await queue.processQueue(a), false);
      final disk = {for (final key in prefs.getKeys()) key: prefs.get(key)!};
      SharedPreferences.setMockInitialValues(disk);
      now = now.add(const Duration(minutes: 6));
      queue = OfflineQueueService.forTesting(
          progressApi: ProgressApiService(),
          flashcardApi: FlashcardApiService(),
          now: () => now);
      expect(await queue.processQueue(a), false);
    },
        () => MockClient((request) async {
              sent.add(request);
              return http.Response('{}', sent.length == 1 ? 503 : 409);
            }));
    expect(sent.map((r) => jsonDecode(r.body)['progressEpoch']), [0, 0]);
    expect(sent.map((r) => r.headers['X-Idempotency-Key']),
        [original.id, original.id]);
    final failed = (await queue.getFailedActions()).single;
    expect(failed.payload['progressEpoch'], 0);
    expect(failed.id, original.id);
  });
  test(
      'legacy epoch-less completion is quarantined without HTTP or epoch invention',
      () async {
    await ProgressEpoch.acknowledge(prefs, getOwner(), 4);
    await enqueue(epoch: null);
    await http.runWithClient(() async {
      expect(await queue.processQueue(a), false);
    }, () => MockClient((_) async => throw StateError('must not dispatch')));
    expect(
        (await queue.getFailedActions())
            .single
            .payload
            .containsKey('progressEpoch'),
        false);
  });
  test(
      'reset ack persists new epoch, same receipt preserves newer cache, failed reset does not advance',
      () async {
    final owner = getOwner();
    await ProgressEpoch.acknowledge(prefs, owner, 0);
    await queue.pushAction('reset-progress', {'expectedEpoch': 0},
        ownerNamespace: owner, operationId: 'reset-1');
    await expectLater(queue.epochForNewProgress(owner), throwsStateError);
    await http.runWithClient(() async {
      expect(await queue.processQueue(a), true);
    },
        () => MockClient((request) async {
              expect(jsonDecode(request.body), {'expectedEpoch': 0});
              return http.Response('{"progressEpoch":1}', 200);
            }));
    expect(await queue.epochForNewProgress(owner), 1);
    await enqueue(epoch: 1);
    await http.runWithClient(() async {
      expect(await queue.processQueue(a), true);
    },
        () => MockClient((request) async => http.Response(
            '{"data":{"progressEpoch":1,"newTotalXp":80}}', 201)));
    // Receipt retry after checkpoint loss, without creating a new reset barrier.
    final key = 'linguaai_offline_queue_${Uri.encodeComponent(owner)}';
    final state = jsonDecode(prefs.getString(key)!) as Map<String, dynamic>;
    state['actions'] = [
      {
        'id': 'reset-1',
        'type': 'reset-progress',
        'ownerNamespace': owner,
        'payload': {'expectedEpoch': 0},
        'createdAt': DateTime.now().toUtc().toIso8601String(),
        'schemaVersion': 1
      }
    ];
    await prefs.setString(key, jsonEncode(state));
    await http.runWithClient(() async {
      expect(await queue.processQueue(a), true);
    },
        () =>
            MockClient((_) async => http.Response('{"progressEpoch":1}', 200)));
    expect(ProgressSnapshot.read(prefs, owner, 'en').totalXp, 80);
    await queue.pushAction('reset-progress', {'expectedEpoch': 1},
        ownerNamespace: owner);
    await http.runWithClient(() async {
      expect(await queue.processQueue(a), false);
    }, () => MockClient((_) async => http.Response('{}', 503)));
    expect(ProgressEpoch.read(prefs, owner), 1);
    expect((await queue.getQueue()).single.payload['expectedEpoch'], 1);
  });
}
