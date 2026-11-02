import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/core/config/api_config.dart';
import 'package:lingua_ai/services/backend_http.dart' as backend;
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/data_timeline.dart';
import 'package:lingua_ai/services/direct_mutation_evidence.dart';
import 'package:lingua_ai/services/offline_queue_service.dart';
import 'package:lingua_ai/services/online_intent_service.dart';
import 'package:lingua_ai/services/online_intent_dispatch.dart';
import 'package:lingua_ai/services/progress_api_service.dart';
import 'package:lingua_ai/services/progress_cache.dart';
import 'package:lingua_ai/services/flashcard_api_service.dart';
import 'package:lingua_ai/services/sync_storage.dart';
import 'package:lingua_ai/services/sync_storage_io.dart';

const timelineA = '11111111-1111-4111-8111-111111111111';
const timelineB = '22222222-2222-4222-8222-222222222222';
const userA = '507f1f77bcf86cd799439011';
const userB = '507f1f77bcf86cd799439012';
const owner = 'guest_$userA';
Map<String, dynamic> compatibility(dynamic id) => {
  'dataTimelineId': id,
  'currentProtocolRevision': 2,
  'minimumMutationRevision': 1,
  'timelineAwareProtocolRevision': 2,
  'timelineWriteState': 'OPEN',
};

class PausedOwnerRead implements SyncStorageBackend {
  final SyncStorageBackend delegate;
  final String pausedOwner;
  final started = Completer<void>();
  final release = Completer<void>();
  bool paused = false;
  PausedOwnerRead(this.delegate, this.pausedOwner);
  @override
  bool get durable => delegate.durable;
  @override
  Future<Map<String, dynamic>?> read(String owner) async {
    if (owner == pausedOwner && !paused) {
      paused = true;
      started.complete();
      await release.future;
    }
    return delegate.read(owner);
  }

  @override
  Future<void> write(String owner, Map<String, dynamic> payload) =>
      delegate.write(owner, payload);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final timeline = DataTimeline();
  final auth = AuthService();
  late Directory directory;
  late OfflineQueueService queue;
  void reopen() {
    SyncStorage.backend = FileSyncStorage(
      () async => Directory('${directory.path}/queue'),
    );
    SyncStorage.intents = FileSyncStorage(
      () async => Directory('${directory.path}/intents'),
    );
    SyncStorage.direct = FileSyncStorage(
      () async => Directory('${directory.path}/direct'),
    );
    queue = OfflineQueueService.forTesting(
      progressApi: ProgressApiService(),
      flashcardApi: FlashcardApiService(),
    );
  }

  Future<void> login([String id = userA]) => auth.setGuestSession(
    id: id,
    email: '$id@guest.lingua.local',
    token: 'token-$id',
  );
  Future<TimelineDiscovery> discover(dynamic id) => timeline.discover(
    fetch: () async => http.Response(jsonEncode(compatibility(id)), 200),
  );
  Future<void> push(String type, Map<String, dynamic> payload, String id) =>
      queue.pushAction(type, payload, ownerNamespace: owner, operationId: id);
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    directory = await Directory.systemTemp.createTemp('lingua-timeline-');
    reopen();
    timeline.resetForTesting();
    await auth.init();
    await login();
  });
  tearDown(() async {
    SyncStorage.backend = PreferencesSyncStorage();
    SyncStorage.intents = PreferencesSyncStorage(
      prefix: 'linguaai_online_intents_',
    );
    SyncStorage.direct = PreferencesSyncStorage(
      prefix: 'linguaai_direct_evidence_',
    );
    timeline.resetForTesting();
    final root = Directory.systemTemp.absolute.path;
    if (directory.parent.absolute.path != root ||
        !directory.path
            .split(Platform.pathSeparator)
            .last
            .startsWith('lingua-timeline-')) {
      throw StateError('Unsafe fixture cleanup');
    }
    await directory.delete(recursive: true);
  });

  test(
    'canonical lowercase UUID v4 only; no timeline is invented offline',
    () async {
      expect(DataTimeline.valid(timelineA), true);
      for (final bad in [
        null,
        '',
        'development',
        '2',
        timelineA.toUpperCase(),
        '11111111-1111-5111-8111-111111111111',
        '$timelineA ',
        2,
      ]) {
        // A contains no letters, so uppercase itself is identical; test letters separately.
        if (bad == timelineA) continue;
        expect(DataTimeline.valid(bad), false, reason: '$bad');
      }
      expect(DataTimeline.valid('AAAAAAAA-1111-4111-8111-111111111111'), false);
      expect(timeline.state, TimelineState.unknown);
      expect(
        () => push('review-flashcard', {'id': 'card', 'score': 4}, 'unknown'),
        throwsA(isA<TimelineRecoveryRequired>()),
      );
      await expectLater(
        OnlineIntentService.prepare('ai-clear', 'en', {'targetLanguage': 'en'}),
        throwsA(isA<TimelineRecoveryRequired>()),
      );
      expect(await SyncStorage.backend.read(owner), isNull);
      expect(await SyncStorage.intents.read(owner), isNull);
    },
  );

  test(
    'discovery uses the central backend boundary; cached restart is not fresh',
    () async {
      await http.runWithClient(
        () async {
          expect(await timeline.discover(), TimelineDiscovery.firstConfirmed);
        },
        () => MockClient((request) async {
          expect(request.method, 'GET');
          expect(request.url.path, '/compatibility');
          expect(request.headers['X-Client-Protocol'], '2');
          expect(request.headers['X-Data-Timeline'], isNull);
          return http.Response(jsonEncode(compatibility(timelineA)), 200);
        }),
      );
      reopen();
      timeline.resetForTesting();
      await timeline.load();
      expect(timeline.lastConfirmedDataTimelineId, timelineA);
      expect(timeline.freshlyConfirmed, false);
      expect(timeline.canDispatch(timelineA), false);
      expect(timeline.captureNewWork(), timelineA);
      expect(await discover(timelineA), TimelineDiscovery.same);
      expect(timeline.canDispatch(timelineA), true);
    },
  );

  test(
    'malformed/missing discovery fails closed and preserves last known ID',
    () async {
      await discover(timelineA);
      for (final bad in [
        null,
        '',
        'development',
        'AAAAAAAA-1111-4111-8111-111111111111',
      ]) {
        await expectLater(
          discover(bad),
          throwsA(isA<TimelineRecoveryRequired>()),
        );
        expect(timeline.state, TimelineState.unavailable);
        expect(timeline.lastConfirmedDataTimelineId, timelineA);
        expect(timeline.canDispatch(timelineA), false);
      }
      for (final invalid in [
        {...compatibility(timelineA), 'timelineWriteState': 'UNAVAILABLE'},
        {...compatibility(timelineA), 'minimumMutationRevision': 3},
        {...compatibility(timelineA), 'timelineAwareProtocolRevision': 1},
      ]) {
        await expectLater(
          timeline.discover(
            fetch: () async => http.Response(jsonEncode(invalid), 200),
          ),
          throwsA(isA<TimelineRecoveryRequired>()),
        );
      }
      expect(
        (await SyncStorage.backend.read(
          DataTimeline.storageOwner,
        ))!['lastConfirmedDataTimelineId'],
        timelineA,
      );
    },
  );

  test(
    'first v2 startup never assigns discovered B to legacy queue or online intents',
    () async {
      final legacy = OfflineQueueAction(
        id: 'legacy-review',
        type: 'review-flashcard',
        ownerNamespace: owner,
        payload: {'id': 'card', 'score': 4},
        clientProtocolRevision: 1,
        createdAt: DateTime.utc(2020),
      );
      await SyncStorage.backend.write(owner, {
        'schemaVersion': 2,
        'ownerNamespace': owner,
        'actions': [legacy.toJson()],
        'failedActions': [],
        'tempIds': {},
        'startedCreates': [],
        'progressRevision': 'old',
        'progressEpoch': 8,
      });
      final oldClear = {
        'schemaVersion': 1,
        'id': 'legacy-clear',
        'ownerNamespace': owner,
        'protocol': 1,
        'kind': 'ai-clear',
        'language': 'en',
        'payload': {'targetLanguage': 'en'},
        'state': 'pending',
        'attempts': 0,
        'nextAttemptAt': 0,
      };
      await SyncStorage.intents.write(owner, {
        'schemaVersion': 1,
        'ownerNamespace': owner,
        'intents': [oldClear],
      });
      final beforeQueue = await SyncStorage.backend.read(owner);
      final beforeIntents = await SyncStorage.intents.read(owner);
      reopen();
      expect(
        (await queue.getQueue()).single.timelineProvenance,
        TimelineProvenance.legacyUnverified,
      );
      await timeline.load();
      expect(await discover(timelineB), TimelineDiscovery.firstConfirmed);
      await http.runWithClient(
        () async {
          expect(await queue.processQueue(userA), false);
          await expectLater(
            replayOnlineIntent('legacy-clear'),
            throwsA(isA<TimelineRecoveryRequired>()),
          );
        },
        () => MockClient(
          (_) async => throw StateError('Legacy must never dispatch'),
        ),
      );
      expect(await SyncStorage.backend.read(owner), beforeQueue);
      expect(await SyncStorage.intents.read(owner), beforeIntents);
      await push('review-flashcard', {'id': 'new-card', 'score': 3}, 'fresh-B');
      expect((await queue.getQueue()).last.dataTimelineId, timelineB);
      expect((await queue.getQueue()).first.toJson(), legacy.toJson());
    },
  );

  test(
    'known offline A work survives reopening and B blocks every queue writer unchanged',
    () async {
      await discover(timelineA);
      timeline.unavailable();
      final writes = <String, Map<String, dynamic>>{
        'complete-lesson': {
          'lessonId': 'lesson',
          'progressEpoch': 4,
          'score': 73,
        },
        'reset-progress': {'expectedEpoch': 4},
        'create-flashcard': {
          'tempId': 'local_card',
          'targetWord': 'word',
          'turkishTranslation': 'translation',
          'targetLanguage': 'en',
        },
        'review-flashcard': {'id': 'card', 'score': 4},
        'update-flashcard': {'id': 'card', 'note': 'saved'},
        'delete-flashcard': {'id': 'card'},
      };
      // Reset compaction is normal within A, so enqueue completion after reset.
      for (final entry in writes.entries.toList().reversed) {
        await push(entry.key, entry.value, entry.key);
      }
      final before = (await queue.getQueue()).map((a) => a.toJson()).toList();
      expect(before, hasLength(writes.length));
      reopen();
      timeline.resetForTesting();
      await timeline.load();
      expect(timeline.freshlyConfirmed, false);
      expect(await discover(timelineB), TimelineDiscovery.changed);
      await http.runWithClient(
        () async {
          expect(await queue.processQueue(userA), false);
        },
        () => MockClient(
          (_) async => throw StateError('A must never dispatch on B'),
        ),
      );
      expect((await queue.getQueue()).map((a) => a.toJson()), before);
      expect(await queue.getFailedActions(), isEmpty);
      expect(auth.localStorageNamespace, owner);
      expect(auth.token, 'token-$userA');
      expect(timeline.recoveryRequired, true);
      await discover(timelineB);
      expect(
        timeline.state,
        TimelineState.changed,
      ); // A successful B read cannot dismiss recovery.
    },
  );

  test(
    'same timeline retry sends stored timeline and protocol after durable reopen',
    () async {
      await discover(timelineA);
      await push('review-flashcard', {
        'id': 'card',
        'score': 4,
      }, 'stable-review');
      reopen();
      timeline.resetForTesting();
      final calls = <String>[];
      await http.runWithClient(
        () async {
          expect(await queue.processQueue(userA), true);
        },
        () => MockClient((request) async {
          calls.add(request.url.path);
          if (request.url.path == '/compatibility') {
            return http.Response(jsonEncode(compatibility(timelineA)), 200);
          }
          if (request.url.path == '/users/me') return http.Response('{}', 503);
          final persisted = (await SyncStorage.backend.read(
            owner,
          ))!['actions'].single;
          expect(persisted['dataTimelineId'], timelineA);
          expect(persisted['attemptCount'], 1);
          expect(
            request.headers['X-Data-Timeline'],
            persisted['dataTimelineId'],
          );
          expect(request.headers['X-Client-Protocol'], '2');
          expect(request.headers['X-Idempotency-Key'], 'stable-review');
          return http.Response('{"_id":"card"}', 200);
        }),
      );
      expect(calls.where((path) => path != '/users/me'), [
        '/compatibility',
        '/flashcards/card/review',
      ]);
      expect(await queue.getQueue(), isEmpty);
    },
  );

  test(
    'new B progress uses refreshed B epoch even when lower than A; A reset never compacts away',
    () async {
      await discover(timelineA);
      await queue.saveServerProgress(
        owner,
        'en',
        await queue.progressRevision(owner),
        ProgressSnapshot(totalXp: 100, progressEpoch: 9),
      );
      await push('reset-progress', {'expectedEpoch': 9}, 'reset-A');
      final original = (await queue.getQueue()).single.toJson();
      await discover(timelineB);
      await expectLater(
        queue.epochForNewProgress(owner),
        throwsA(isA<TimelineRecoveryRequired>()),
      );
      expect(
        await queue.saveServerProgress(
          owner,
          'en',
          await queue.progressRevision(owner),
          ProgressSnapshot(totalXp: 10, progressEpoch: 1),
        ),
        true,
      );
      expect(await queue.epochForNewProgress(owner), 1);
      await push('reset-progress', {'expectedEpoch': 1}, 'reset-B');
      expect((await queue.getQueue()).first.toJson(), original);
      final calls = <String>[];
      await http.runWithClient(
        () async {
          await queue.processQueue(userA);
        },
        () => MockClient((request) async {
          calls.add(request.headers['X-Idempotency-Key']!);
          expect(request.headers['X-Data-Timeline'], timelineB);
          return http.Response('{"progressEpoch":2}', 200);
        }),
      );
      expect(calls, ['reset-B']);
      expect((await queue.getQueue()).single.toJson(), original);
    },
  );

  for (final kind in ['ai-send', 'ai-clear', 'community-create']) {
    test(
      '$kind remains A through restart and B recovery; no provider/upload/destructive dispatch',
      () async {
        await discover(timelineA);
        final payload = kind == 'ai-send'
            ? {'message': 'hello', 'language': 'en', 'targetLanguage': 'en'}
            : kind == 'ai-clear'
            ? {'targetLanguage': 'en'}
            : <String, dynamic>{
                'fields': {'learningLanguage': 'en', 'text': 'saved upload'},
                'files': [
                  {
                    'field': 'image',
                    'filename': 'fixture.png',
                    'contentType': 'image/png',
                    'bytes': base64Encode([1, 2, 3]),
                  },
                ],
              };
        final saved = await OnlineIntentService.prepare(kind, 'en', payload);
        expect(saved['dataTimelineId'], timelineA);
        if (kind.startsWith('ai-')) expect(saved['conversationId'], isNotEmpty);
        reopen();
        timeline.resetForTesting();
        await timeline.load();
        await discover(timelineB);
        await http.runWithClient(
          () async {
            await expectLater(
              replayOnlineIntent(saved['id']),
              throwsA(isA<TimelineRecoveryRequired>()),
            );
            await expectLater(
              OnlineIntentService.prepare(
                kind,
                'en',
                payload,
                operationId: saved['id'],
              ),
              throwsA(isA<TimelineRecoveryRequired>()),
            );
          },
          () => MockClient(
            (_) async => throw StateError('No cross-timeline dispatch'),
          ),
        );
        expect((await OnlineIntentService.list()).single, saved);
        final explicitNew = await OnlineIntentService.prepare(
          kind,
          'en',
          payload,
        );
        expect(explicitNew['id'], isNot(saved['id']));
        expect(explicitNew['dataTimelineId'], timelineB);
        expect((await OnlineIntentService.list()).first, saved);
        // Discard is local only. A fresh clear still needs its UI confirmation;
        // this service creates a new identity and does not reuse the tombstone.
        await http.runWithClient(
          () => OnlineIntentService.discardForReconciliation(saved['id']),
          () => MockClient(
            (_) async => throw StateError('Discard must not send HTTP'),
          ),
        );
        final fresh = await OnlineIntentService.prepare(kind, 'en', payload);
        expect(fresh['dataTimelineId'], timelineB);
        expect(fresh['id'], isNot(saved['id']));
        await expectLater(
          OnlineIntentService.prepare(
            kind,
            'en',
            payload,
            operationId: saved['id'],
          ),
          throwsA(isA<IntentRecoveryRequired>()),
        );
      },
    );
  }

  for (final kind in ['ai-send', 'ai-clear']) {
    test(
      'late A $kind result cannot acknowledge or remove durable evidence after B',
      () async {
        await discover(timelineA);
        final intent = await OnlineIntentService.prepare(
          kind,
          'en',
          kind == 'ai-send'
              ? {'message': 'hello', 'language': 'en', 'targetLanguage': 'en'}
              : {'targetLanguage': 'en'},
        );
        final started = Completer<void>();
        final release = Completer<http.Response>();
        await http.runWithClient(
          () async {
            final result = replayOnlineIntent(intent['id']);
            final assertion = expectLater(
              result,
              throwsA(isA<TimelineRecoveryRequired>()),
            );
            await started.future;
            final before = await SyncStorage.intents.read(owner);
            await discover(timelineB);
            release.complete(
              http.Response(
                kind == 'ai-send' ? '{"reply":"late"}' : '{"success":true}',
                200,
              ),
            );
            await assertion;
            expect(await SyncStorage.intents.read(owner), before);
          },
          () => MockClient((_) {
            started.complete();
            return release.future;
          }),
        );
      },
    );
  }

  for (final path in [
    '/progress/$userA',
    '/flashcards/all',
    '/community/posts',
    '/ai-coach/history?targetLanguage=en',
    '/users/me',
    '/lessons',
  ]) {
    test('late read from A is ignored after B: $path', () async {
      await discover(timelineA);
      final started = Completer<void>();
      final release = Completer<http.Response>();
      await http.runWithClient(
        () async {
          final assertion = expectLater(
            backend.get(Uri.parse('${ApiConfig.baseUrl}$path')),
            throwsA(isA<TimelineRecoveryRequired>()),
          );
          await started.future;
          await discover(timelineB);
          release.complete(http.Response('{}', 200));
          await assertion;
        },
        () => MockClient((_) {
          started.complete();
          return release.future;
        }),
      );
    });
  }

  test(
    'owner switch pauses old owner intent; switching back exposes unchanged evidence',
    () async {
      await discover(timelineA);
      final intent = await OnlineIntentService.prepare('ai-clear', 'en', {
        'targetLanguage': 'en',
      });
      await login(userB);
      expect(await OnlineIntentService.list(), isEmpty);
      await expectLater(
        replayOnlineIntent(intent['id']),
        throwsA(isA<IntentRecoveryRequired>()),
      );
      await OnlineIntentService.discardForReconciliation(intent['id']);
      await login();
      expect((await OnlineIntentService.list()).single, intent);
    },
  );

  test(
    'profile and online-only writes persist provenance before dispatch; same key cannot become B',
    () async {
      await discover(timelineA);
      await http.runWithClient(
        () async {
          await backend.patch(
            Uri.parse('${ApiConfig.baseUrl}/users/profile'),
            headers: {'X-Idempotency-Key': 'profile-A'},
            body: '{"name":"Saved"}',
          );
        },
        () => MockClient((request) async {
          final item = (await DirectMutationEvidence.list()).single;
          expect(item['dataTimelineId'], timelineA);
          expect(item['payload']['body'], '{"name":"Saved"}');
          expect(request.headers['X-Data-Timeline'], timelineA);
          return http.Response('{}', 503);
        }),
      );
      final original = (await DirectMutationEvidence.list()).single;
      await discover(timelineB);
      await http.runWithClient(() async {
        await expectLater(
          backend.patch(
            Uri.parse('${ApiConfig.baseUrl}/users/profile'),
            headers: {'X-Idempotency-Key': 'profile-A'},
            body: '{"name":"Saved"}',
          ),
          throwsA(isA<TimelineRecoveryRequired>()),
        );
      }, () => MockClient((_) async => throw StateError('No A profile on B')));
      expect((await DirectMutationEvidence.list()).single, original);
    },
  );

  test(
    'backend metadata never escapes to external media even with caller-supplied headers',
    () async {
      await discover(timelineA);
      await http.runWithClient(
        () => backend.get(
          Uri.parse('https://media.example.invalid/image'),
          headers: {'x-data-timeline': timelineA, 'x-client-protocol': '2'},
        ),
        () => MockClient((request) async {
          expect(request.headers['X-Data-Timeline'], isNull);
          expect(request.headers['X-Client-Protocol'], isNull);
          return http.Response('', 200);
        }),
      );
    },
  );

  test(
    'multipart update stores exact file evidence and revision before upload',
    () async {
      await discover(timelineA);
      await http.runWithClient(
        () async {
          final request =
              http.MultipartRequest(
                  'PUT',
                  Uri.parse('${ApiConfig.baseUrl}/community/posts/post'),
                )
                ..headers['X-Idempotency-Key'] = 'upload-A'
                ..fields['expectedRevision'] = '7'
                ..files.add(
                  http.MultipartFile.fromBytes('image', [
                    1,
                    2,
                    3,
                  ], filename: 'fixture.png'),
                );
          await backend.sendMultipart(request);
        },
        () => MockClient((request) async {
          final record = (await DirectMutationEvidence.list()).single;
          expect(record['dataTimelineId'], timelineA);
          expect(record['payload']['fields']['expectedRevision'], '7');
          expect(
            record['payload']['files'].single['bytes'],
            base64Encode([1, 2, 3]),
          );
          expect(request.headers['X-Data-Timeline'], timelineA);
          return http.Response('{}', 503);
        }),
      );
      reopen();
      expect(
        (await DirectMutationEvidence.list())
            .single['payload']['files']
            .single['bytes'],
        base64Encode([1, 2, 3]),
      );
    },
  );

  test(
    'registration and server guest writes retain timeline evidence without credentials',
    () async {
      await discover(timelineA);
      await http.runWithClient(
        () async {
          for (final path in ['/auth/register', '/auth/guest']) {
            await backend.post(
              Uri.parse('${ApiConfig.baseUrl}$path'),
              headers: {'Authorization': 'Bearer secret-token'},
              body:
                  '{"password":"secret-password","email":"private@example.invalid"}',
            );
          }
        },
        () => MockClient((request) async {
          expect(request.headers['X-Client-Protocol'], '2');
          expect(request.headers['X-Data-Timeline'], timelineA);
          final stored = jsonEncode(await SyncStorage.direct.read(owner));
          expect(stored, isNot(contains('secret-password')));
          expect(stored, isNot(contains('secret-token')));
          expect(stored, isNot(contains('private@example.invalid')));
          expect(stored, contains('credentialsRetained'));
          return http.Response('{}', 503);
        }),
      );
      expect(await DirectMutationEvidence.list(), hasLength(2));
    },
  );

  for (final (code, status, category) in [
    ('SERVER_TIMELINE_REQUIRED', 428, 'provenance'),
    ('SERVER_TIMELINE_CHANGED', 409, 'timeline'),
    ('RECEIPT_TIMELINE_UNVERIFIED', 409, 'provenance'),
    ('BACKEND_NOT_READY', 503, 'maintenance'),
  ]) {
    test(
      'server $code pauses work without terminal quarantine or relabeling',
      () async {
        await discover(timelineA);
        await push('review-flashcard', {'id': 'card', 'score': 4}, 'paused');
        await http.runWithClient(
          () async {
            expect(await queue.processQueue(userA), false);
          },
          () => MockClient(
            (_) async => http.Response(jsonEncode({'code': code}), status),
          ),
        );
        final record = (await queue.getQueue()).single;
        expect(record.id, 'paused');
        expect(record.dataTimelineId, timelineA);
        expect(record.lastErrorCategory, category);
        expect(await queue.getFailedActions(), isEmpty);
        expect(timeline.freshlyConfirmed, false);
      },
    );
  }

  test(
    'selected media sharing backend origin receives no backend headers',
    () async {
      await discover(timelineA);
      await http.runWithClient(
        () => backend.getMedia(
          Uri.parse('${ApiConfig.baseUrl}/uploads/selected.png'),
        ),
        () => MockClient((request) async {
          expect(request.headers['X-Client-Protocol'], isNull);
          expect(request.headers['X-Data-Timeline'], isNull);
          return http.Response('', 200);
        }),
      );
    },
  );
  test(
    'corrupt timeline generation exposes verified backup but cannot silently restore authority',
    () async {
      await discover(timelineA);
      await push('review-flashcard', {'id': 'card', 'score': 4}, 'preserved');
      await discover(timelineB);
      final queueBefore = await SyncStorage.backend.read(owner);
      final slots = (await Directory('${directory.path}/queue').list().toList())
          .whereType<File>()
          .where(
            (file) =>
                file.path.contains('timeline_global.') &&
                file.path.endsWith('.json'),
          )
          .toList();
      slots.sort(
        (a, b) =>
            (jsonDecode(a.readAsStringSync())['body']['generation'] as int)
                .compareTo(
                  jsonDecode(b.readAsStringSync())['body']['generation'] as int,
                ),
      );
      await slots.last.writeAsString('{corrupt', flush: true);
      reopen();
      timeline.resetForTesting();
      await expectLater(
        timeline.load(),
        throwsA(
          isA<SyncStorageCorruption>().having(
            (error) => error.previousValid!['lastConfirmedDataTimelineId'],
            'verified backup',
            timelineA,
          ),
        ),
      );
      expect(timeline.lastConfirmedDataTimelineId, isNull);
      await http.runWithClient(
        () async {
          expect(await queue.processQueue(userA), false);
        },
        () => MockClient(
          (_) async => throw StateError('Corrupt metadata cannot dispatch'),
        ),
      );
      expect(await slots.last.readAsString(), '{corrupt');
      expect(await SyncStorage.backend.read(owner), queueBefore);
    },
  );
  test(
    'pending-card compaction cannot touch another owner or adopt B during storage read',
    () async {
      await discover(timelineA);
      await push('create-flashcard', {
        'tempId': 'local_pending',
        'targetWord': 'original',
        'turkishTranslation': 'translation',
        'targetLanguage': 'en',
      }, 'pending-A');
      final original = await SyncStorage.backend.read(owner);
      await login(userB);
      expect(
        () => queue.mutatePendingCard('delete-flashcard', {
          'id': 'local_pending',
        }, ownerNamespace: owner),
        throwsA(isA<TimelineRecoveryRequired>()),
      );
      expect(await SyncStorage.backend.read(owner), original);
      await login();
      final delegate = SyncStorage.backend;
      final paused = PausedOwnerRead(delegate, owner);
      SyncStorage.backend = paused;
      final assertion = expectLater(
        queue.mutatePendingCard('update-flashcard', {
          'id': 'local_pending',
          'targetWord': 'must not adopt B',
        }, ownerNamespace: owner),
        throwsA(isA<TimelineRecoveryRequired>()),
      );
      await paused.started.future;
      await discover(timelineB);
      paused.release.complete();
      await assertion;
      expect(await delegate.read(owner), original);
    },
  );
  test(
    'valid CLOSED B invalidates A authority while both A and B writes stay paused',
    () async {
      await discover(timelineA);
      final staleContext = auth.captureSession();
      await push('review-flashcard', {'id': 'card', 'score': 4}, 'closed-A');
      final original = (await queue.getQueue()).single.toJson();
      expect(
        await timeline.discover(
          fetch: () async => http.Response(
            jsonEncode({
              ...compatibility(timelineB),
              'timelineWriteState': 'CLOSED',
            }),
            200,
          ),
        ),
        TimelineDiscovery.changed,
      );
      expect(timeline.lastConfirmedDataTimelineId, timelineB);
      expect(staleContext.isDataCurrent, false);
      expect(timeline.freshlyConfirmed, true);
      expect(timeline.canDispatch(timelineA), false);
      expect(timeline.canDispatch(timelineB), false);
      await http.runWithClient(
        () async {
          expect(await queue.processQueue(userA), false);
        },
        () =>
            MockClient((_) async => throw StateError('CLOSED cannot dispatch')),
      );
      expect((await queue.getQueue()).single.toJson(), original);
      await discover(timelineB);
      expect(timeline.canDispatch(timelineB), true);
      expect(timeline.canDispatch(timelineA), false);
    },
  );
}
