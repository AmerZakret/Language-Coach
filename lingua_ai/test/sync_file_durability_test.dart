import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/offline_queue_service.dart';
import 'package:lingua_ai/services/progress_api_service.dart';
import 'package:lingua_ai/services/progress_cache.dart';
import 'package:lingua_ai/services/api_response.dart';
import 'package:lingua_ai/services/sync_storage.dart';
import 'package:lingua_ai/services/sync_storage_io.dart';
import 'offline_queue_durability_test.dart' show DurableCardsApi;
import 'offline_queue_ownership_test.dart' show FakeProgressApi;

class CheckpointProgress extends FakeProgressApi {
  @override
  Future<Map<String, dynamic>> completeLesson(
          String userId, String lessonId, int score,
          {required int progressEpoch, String? operationId}) async =>
      {
        'data': {
          'progressEpoch': progressEpoch,
          'newTotalXp': 50,
          'targetLanguage': 'en',
          'score': score
        }
      };
  @override
  Future<Map<String, dynamic>> resetProgress(String userId,
          {required int expectedEpoch, required String operationId}) async =>
      {'progressEpoch': expectedEpoch + 1};
}

class FailedProgress extends FakeProgressApi {
  @override
  Future<Map<String, dynamic>> completeLesson(
          String userId, String lessonId, int score,
          {required int progressEpoch, String? operationId}) async =>
      throw const ApiException(
          ApiFailure.client, 'Rejected', 400, false, 'STALE_PROGRESS_EPOCH');
}

class AfterCommitInterruption implements SyncStorageBackend {
  final SyncStorageBackend delegate;
  AfterCommitInterruption(this.delegate);
  @override
  bool get durable => true;
  @override
  Future<Map<String, dynamic>?> read(String owner) => delegate.read(owner);
  @override
  Future<void> write(String owner, Map<String, dynamic> value) async {
    await delegate.write(owner, value);
    throw const FileSystemException('Interrupted after file commit');
  }
}

class BeforeAckInterruption implements SyncStorageBackend {
  final SyncStorageBackend delegate;
  BeforeAckInterruption(this.delegate);
  @override
  bool get durable => true;
  @override
  Future<Map<String, dynamic>?> read(String owner) => delegate.read(owner);
  @override
  Future<void> write(String owner, Map<String, dynamic> value) async {
    if ((value['actions'] as List).isEmpty &&
        (value['tempIds'] as Map).isNotEmpty) {
      throw const FileSystemException('Interrupted acknowledgement checkpoint');
    }
    await delegate.write(owner, value);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const a = '507f1f77bcf86cd799439011', b = '507f1f77bcf86cd799439012';
  const owner = 'guest_$a', key = 'linguaai_offline_queue_$owner';
  final auth = AuthService();
  late Directory temporary;
  late SharedPreferences prefs;
  late DurableCardsApi cards;
  late OfflineQueueService queue;
  var now = DateTime.utc(2026);
  FileSyncStorage store({Future<void> Function()? beforePromote}) =>
      FileSyncStorage(() async => temporary, beforePromote: beforePromote);
  OfflineQueueService service([ProgressApiService? progress]) =>
      OfflineQueueService.forTesting(
          progressApi: progress ?? FakeProgressApi(),
          flashcardApi: cards,
          now: () => now);
  Future<void> login([String id = a]) => auth.setGuestSession(
      id: id, email: '$id@guest.lingua.local', token: 'token-$id');
  Future<void> restart() async {
    SyncStorage.backend = store();
    SharedPreferences.setMockInitialValues({});
    await auth.init();
    await login();
    prefs = await SharedPreferences.getInstance();
    queue = service();
  }

  Map<String, dynamic> envelope(List<OfflineQueueAction> actions,
          {List<OfflineQueueAction>? failed}) =>
      {
        'schemaVersion': 2,
        'ownerNamespace': owner,
        'actions': actions.map((a) => a.toJson()).toList(),
        'tempIds': {'local_retained': 'server-retained'},
        'startedCreates': [],
        'progressRevision': 'original',
        'failedActions': (failed ?? []).map((a) => a.toJson()).toList(),
      };
  OfflineQueueAction action(String id, {int epoch = 0}) => OfflineQueueAction(
      id: id,
      type: 'complete-lesson',
      ownerNamespace: owner,
      payload: {
        'lessonId': id,
        'score': 73,
        'progressEpoch': epoch,
        'targetLanguage': 'en',
        '_lessonLanguageBound': true
      },
      createdAt: DateTime.utc(2000));
  Future<void> push(String id) =>
      queue.pushAction('complete-lesson', action(id).payload,
          ownerNamespace: owner, operationId: id);

  setUp(() async {
    temporary = await Directory.systemTemp.createTemp('lingua-sync-durable-');
    SyncStorage.backend = store();
    SharedPreferences.setMockInitialValues({});
    await auth.init();
    await login();
    prefs = await SharedPreferences.getInstance();
    cards = DurableCardsApi();
    queue = service();
    now = DateTime.utc(2026);
  });
  tearDown(() async {
    SyncStorage.backend = PreferencesSyncStorage();
    final root = temporary.absolute.path;
    if (!root.startsWith(
        '${Directory.systemTemp.absolute.path}${Platform.pathSeparator}lingua-sync-durable-')) {
      throw StateError('Unsafe test cleanup');
    }
    await temporary.delete(recursive: true);
  });

  test(
      'pending/operation/owner survives a new store/service with preferences erased',
      () async {
    await push('pending');
    await restart();
    final saved = (await queue.getQueue()).single;
    expect(saved.id, 'pending');
    expect(saved.ownerNamespace, owner);
    expect(saved.payload['score'], 73);
    expect(prefs.containsKey(key), false);
  });
  test(
      'acknowledged actions and active retry metadata stay removed after restart',
      () async {
    await push('ack');
    expect(await queue.processQueue(a), true);
    await restart();
    expect(await queue.getQueue(), isEmpty);
    expect((await SyncStorage.backend.read(owner))!['actions'], isEmpty);
  });
  test(
      'create ack/mapping/dependent rewrite commit together and mappings are retained',
      () async {
    await queue.pushAction(
        'create-flashcard',
        {
          'tempId': 'local_new',
          'targetWord': 'word',
          'turkishTranslation': 'meaning',
          'targetLanguage': 'en'
        },
        ownerNamespace: owner);
    await queue.pushAction(
        'review-flashcard', {'cardId': 'local_new', 'score': 4},
        ownerNamespace: owner);
    expect(await queue.processQueue(a), true);
    await restart();
    final state = (await SyncStorage.backend.read(owner))!;
    expect(state['actions'], isEmpty);
    expect(state['tempIds']['local_new'], 'mongo-real');
    expect(cards.calls.last['id'], 'mongo-real');
    await queue.pushAction(
        'review-flashcard', {'cardId': 'local_new', 'score': 5},
        ownerNamespace: owner);
    expect((await queue.getQueue()).single.payload['cardId'], 'mongo-real');
  });
  test(
      'interrupted create acknowledgement preserves dispatched action and original payload for replay',
      () async {
    await queue.pushAction(
        'create-flashcard',
        {
          'tempId': 'local_new',
          'targetWord': 'original',
          'turkishTranslation': 'meaning',
          'targetLanguage': 'en'
        },
        ownerNamespace: owner,
        operationId: 'create-original');
    SyncStorage.backend = BeforeAckInterruption(store());
    await expectLater(
        queue.processQueue(a), throwsA(isA<FileSystemException>()));
    await restart();
    final saved = (await SyncStorage.backend.read(owner))!;
    expect((await queue.getQueue()).single.id, 'create-original');
    expect(saved['tempIds'], isEmpty);
    expect(saved['startedCreates'], ['create-original']);
    await queue.mutatePendingCard(
        'update-flashcard', {'cardId': 'local_new', 'targetWord': 'new edit'},
        ownerNamespace: owner);
    final work = await queue.getQueue();
    expect(work.first.payload['targetWord'], 'original');
    expect(work.last.type, 'update-flashcard');
    expect(await queue.processQueue(a), true);
    await restart();
    expect(await queue.getQueue(), isEmpty);
    expect((await SyncStorage.backend.read(owner))!['tempIds']['local_new'],
        'mongo-real');
  });
  test(
      'failed action original epoch, operation and error evidence survive restart without age expiry',
      () async {
    queue = service(FailedProgress());
    await push('failed');
    expect(await queue.processQueue(a), false);
    await restart();
    final failed = (await queue.getFailedActions()).single;
    expect(failed.id, 'failed');
    expect(failed.payload['progressEpoch'], 0);
    expect(failed.lastErrorCode, 'STALE_PROGRESS_EPOCH');
    expect(failed.failedAt, isNotNull);
    expect(failed.attemptCount, 1);
  });
  test('retry metadata survives restart without expiring a long-offline action',
      () async {
    cards.failReview = true;
    await queue.pushAction('review-flashcard', {'cardId': 'server', 'score': 4},
        ownerNamespace: owner, operationId: 'retry');
    expect(await queue.processQueue(a), false);
    final before = (await queue.getQueue()).single.toJson();
    await restart();
    expect((await queue.getQueue()).single.toJson(), before);
  });
  test('registered/backend guest/local_guest durable files never share owners',
      () async {
    await push('A');
    await login(b);
    expect(await queue.getQueue(), isEmpty);
    auth.setBackendSession(
        id: a, name: 'A', email: 'a@example.test', token: 'registered');
    expect(await queue.getQueue(), isEmpty);
    await auth.loginAsGuest();
    expect(await queue.getQueue(), isEmpty);
    await login();
    expect((await queue.getQueue()).single.id, 'A');
  });
  test('flushed but interrupted promotion keeps previous valid checkpoint',
      () async {
    await push('before');
    SyncStorage.backend = store(beforePromote: () async {
      throw const FileSystemException('Interrupted');
    });
    await expectLater(push('after'), throwsA(isA<FileSystemException>()));
    await restart();
    expect((await queue.getQueue()).map((a) => a.id), ['before']);
    expect(
        (await temporary.list().toList())
            .any((file) => file.path.endsWith('.pending')),
        true);
  });
  test(
      'corrupt newest preserves evidence/known-good backup and blocks authoritative empty work',
      () async {
    await push('one');
    await push('two');
    final files = (await temporary.list().toList())
        .whereType<File>()
        .where((f) => f.path.endsWith('.json'))
        .toList();
    files.sort((a, b) =>
        (jsonDecode(a.readAsStringSync())['body']['generation'] as int)
            .compareTo(
                jsonDecode(b.readAsStringSync())['body']['generation'] as int));
    await files.last.writeAsString('{corrupt', flush: true);
    await expectLater(
        queue.getQueue(),
        throwsA(isA<SyncStorageCorruption>().having(
            (e) => e.previousValid!['actions'].length,
            'backup action count',
            1)));
    await expectLater(push('three'), throwsA(isA<SyncStorageCorruption>()));
    expect(await files.last.readAsString(), '{corrupt');
  });
  test(
      'valid legacy migration is idempotent and preserves failed metadata, mapping and epoch',
      () async {
    final failed = action('failed', epoch: 42).withRetry(
        attempts: 3,
        attemptedAt: DateTime.utc(2001),
        category: 'validation',
        code: 'BAD_INPUT',
        failed: DateTime.utc(2001));
    await prefs.setString(
        key, jsonEncode(envelope([action('legacy')], failed: [failed])));
    await prefs.setInt('progress_epoch_$owner', 0);
    expect((await queue.getQueue()).single.id, 'legacy');
    expect(prefs.containsKey(key), false);
    final before = await SyncStorage.backend.read(owner);
    await restart();
    expect(await SyncStorage.backend.read(owner), before);
    expect((await queue.getQueue()).single.id, 'legacy');
    expect((await queue.getFailedActions()).single.toJson(), failed.toJson());
    expect(await queue.epochForNewProgress(owner), 0);
    expect(before!['tempIds']['local_retained'], 'server-retained');
  });
  test('clearly owned legacy action lists migrate without ID/payload changes',
      () async {
    await prefs.setStringList(key, [jsonEncode(action('old-list').toJson())]);
    expect(
        (await queue.getQueue()).single.toJson(), action('old-list').toJson());
    await restart();
    expect(
        (await queue.getQueue()).single.toJson(), action('old-list').toJson());
  });
  test(
      'owned legacy envelope epoch is preserved when its preference projection is missing',
      () async {
    await prefs.setString(
        key,
        jsonEncode({
          ...envelope([action('old-epoch')]),
          'progressEpoch': 5
        }));
    expect((await queue.getQueue()).single.payload['progressEpoch'], 0);
    expect(await queue.epochForNewProgress(owner), 5);
    await restart();
    expect(await queue.epochForNewProgress(owner), 5);
  });
  test(
      'malformed retry metadata is durably quarantined rather than silently dropped',
      () async {
    final state = envelope([action('bad-date')]);
    state['actions'][0]['nextAttemptAt'] = 'invalid-date';
    final raw = jsonEncode(state);
    await prefs.setString(key, raw);
    await expectLater(queue.getQueue(), throwsA(isA<SyncStorageCorruption>()));
    expect(prefs.getString(key), raw);
    expect(
        (await SyncStorage.backend.read('legacy_unowned'))!['snapshots'].single,
        contains('invalid-date'));
  });
  test(
      'interrupted migration before promotion retains preferences; retry neither duplicates nor drops',
      () async {
    await prefs.setString(key, jsonEncode(envelope([action('legacy')])));
    SyncStorage.backend = store(beforePromote: () async {
      throw const FileSystemException('Interrupted');
    });
    await expectLater(queue.getQueue(), throwsA(isA<FileSystemException>()));
    expect(prefs.containsKey(key), true);
    SyncStorage.backend = store();
    expect((await queue.getQueue()).single.id, 'legacy');
    expect(prefs.containsKey(key), false);
  });
  test(
      'interrupted migration after commit uses file first even when old preferences remain',
      () async {
    await prefs.setString(key, jsonEncode(envelope([action('legacy')])));
    SyncStorage.backend = AfterCommitInterruption(store());
    await expectLater(queue.getQueue(), throwsA(isA<FileSystemException>()));
    expect(prefs.containsKey(key), true);
    SyncStorage.backend = store();
    expect((await queue.getQueue()).map((a) => a.id), ['legacy']);
    await push('new');
    expect((await queue.getQueue()).map((a) => a.id), ['legacy', 'new']);
  });
  test('ownerless legacy work stays quarantined durably and is never adopted',
      () async {
    await prefs.setStringList('linguaai_offline_queue', ['ownerless evidence']);
    expect(await queue.getQueue(), isEmpty);
    expect(prefs.containsKey('linguaai_offline_queue'), false);
    await restart();
    final evidence = (await SyncStorage.backend.read('legacy_unowned'))!;
    expect(evidence['snapshots'], [
      jsonEncode(['ownerless evidence'])
    ]);
    expect(await queue.getQueue(), isEmpty);
  });
  test('foreign-owner legacy state is preserved as evidence and refused',
      () async {
    await prefs.setString(
        key,
        jsonEncode({
          ...envelope([action('foreign')]),
          'ownerNamespace': 'guest_$b'
        }));
    await expectLater(queue.getQueue(), throwsA(isA<SyncStorageCorruption>()));
    expect(prefs.containsKey(key), true);
    expect(await SyncStorage.backend.read(owner), isNull);
    expect((await SyncStorage.backend.read('legacy_unowned'))!['snapshots'],
        isNotEmpty);
  });
  test('overlapping service mutations serialize without lost actions',
      () async {
    await Future.wait(List.generate(
        12,
        (i) => service().pushAction('complete-lesson', action('$i').payload,
            ownerNamespace: owner, operationId: '$i')));
    await restart();
    expect((await queue.getQueue()).map((a) => a.id).toSet(),
        List.generate(12, (i) => '$i').toSet());
    expect(await queue.storageDiagnostics(), containsPair('active', 12));
  });
  test(
      'completion/epoch checkpoint and reset acknowledgement survive lost preference projections',
      () async {
    await prefs.setInt('progress_epoch_$owner', 0);
    queue = service(CheckpointProgress());
    await push('lesson');
    expect(await queue.processQueue(a), true);
    await restart();
    expect(await queue.epochForNewProgress(owner), 0);
    expect(ProgressSnapshot.read(prefs, owner, 'en').totalXp, 50);
    queue = service(CheckpointProgress());
    await queue.pushAction('reset-progress', {'expectedEpoch': 0},
        ownerNamespace: owner, operationId: 'reset');
    await expectLater(queue.epochForNewProgress(owner), throwsStateError);
    expect(await queue.processQueue(a), true);
    await restart();
    expect(await queue.epochForNewProgress(owner), 1);
    expect(await queue.getQueue(), isEmpty);
    expect(ProgressSnapshot.read(prefs, owner, 'en').available, false);
  });
}
