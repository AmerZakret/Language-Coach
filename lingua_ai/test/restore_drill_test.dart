import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/community_service.dart';
import 'package:lingua_ai/services/data_timeline.dart';
import 'package:lingua_ai/services/mutation_request.dart';
import 'package:lingua_ai/services/offline_queue_service.dart';
import 'package:lingua_ai/services/online_intent_service.dart';
import 'package:lingua_ai/services/online_intent_dispatch.dart';
import 'package:lingua_ai/services/progress_api_service.dart';
import 'package:lingua_ai/services/flashcard_api_service.dart';
import 'package:lingua_ai/services/progress_cache.dart';
import 'package:lingua_ai/services/sync_storage.dart';
import 'package:lingua_ai/services/sync_storage_io.dart';
import 'data_timeline_test.dart'
    show timelineA, timelineB, userA, owner, compatibility;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final timeline = DataTimeline(), auth = AuthService();
  late Directory root;
  late OfflineQueueService queue;
  late SharedPreferences prefs;
  void reopen() {
    SyncStorage.backend =
        FileSyncStorage(() async => Directory('${root.path}/queue'));
    SyncStorage.intents =
        FileSyncStorage(() async => Directory('${root.path}/intents'));
    SyncStorage.direct =
        FileSyncStorage(() async => Directory('${root.path}/direct'));
    queue = OfflineQueueService.forTesting(
        progressApi: ProgressApiService(), flashcardApi: FlashcardApiService());
  }

  Future<void> discover(String id) async {
    await timeline.discover(
        fetch: () async => http.Response(jsonEncode(compatibility(id)), 200));
  }

  Map<String, dynamic> payload(String kind) => kind == 'ai-clear'
      ? {'targetLanguage': 'en'}
      : {
          'fields': {'learningLanguage': 'en', 'text': 'synthetic draft'},
          'files': <dynamic>[]
        };
  Future<Map<String, dynamic>> create(String kind) async {
    if (kind != 'progress') {
      return OnlineIntentService.prepare(kind, 'en', payload(kind));
    }
    await queue.pushAction(
        'complete-lesson', {'lessonId': 'one', 'score': 80, 'progressEpoch': 5},
        ownerNamespace: owner);
    return (await queue.getQueue()).last.toJson();
  }

  Future<List<Map<String, dynamic>>> records(String kind) async =>
      kind == 'progress'
          ? (await queue.getQueue()).map((item) => item.toJson()).toList()
          : OnlineIntentService.list();
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    root = await Directory.systemTemp.createTemp('restore-10e-client-');
    reopen();
    timeline.resetForTesting(confirmed: timelineA);
    await auth.init();
    await auth.setGuestSession(
        id: userA, email: '$userA@guest.lingua.local', token: 'synthetic');
    prefs = await SharedPreferences.getInstance();
  });
  tearDown(() async {
    SyncStorage.backend = PreferencesSyncStorage();
    SyncStorage.intents =
        PreferencesSyncStorage(prefix: 'linguaai_online_intents_');
    SyncStorage.direct =
        PreferencesSyncStorage(prefix: 'linguaai_direct_evidence_');
    timeline.resetForTesting();
    if (root.parent.absolute.path != Directory.systemTemp.absolute.path ||
        !root.path
            .split(Platform.pathSeparator)
            .last
            .startsWith('restore-10e-client-')) {
      throw StateError('Unsafe fixture cleanup');
    }
    await root.delete(recursive: true);
  });
  for (final kind in ['ai-clear', 'community-create', 'progress']) {
    test(
        '10E $kind native two-slot restart preserves A under B and explicit B uses new ID',
        () async {
      await http.runWithClient(() async {
        await discover(timelineA);
        await ProgressSnapshot(totalXp: 73, progressEpoch: 5)
            .save(prefs, owner, 'en');
        final old = await create(kind);
        reopen();
        timeline.resetForTesting();
        await timeline.load();
        expect(timeline.lastConfirmedDataTimelineId, timelineA);
        expect(timeline.freshlyConfirmed, false);
        expect((await records(kind)).single, old);
        await discover(timelineB);
        if (kind == 'progress') {
          expect(await queue.processQueue(userA), false);
        } else {
          await expectLater(replayOnlineIntent(old['id']),
              throwsA(isA<TimelineRecoveryRequired>()));
        }
        expect((await records(kind)).single, old);
        expect(ProgressSnapshot.read(prefs, owner, 'en').available, false);
        final fresh = await create(kind);
        expect(fresh['id'], isNot(old['id']));
        expect(fresh['dataTimelineId'], timelineB);
        expect((await records(kind)).first, old);
      },
          () => MockClient((request) async {
                expect(request.method, 'GET',
                    reason:
                        'Only profile refresh may reach HTTP; A never drains');
                return http.Response('{}', 503);
              }));
    });
    for (final status in [200, 401]) {
      test(
          '10E in-flight $kind A HTTP $status is ignored after restored B discovery',
          () async {
        final started = Completer<void>(),
            response = Completer<http.Response>();
        await http.runWithClient(() async {
          await discover(timelineA);
          final old = await create(kind);
          final operation = kind == 'progress'
              ? queue.processQueue(userA)
              : replayOnlineIntent(old['id']);
          final checked = kind == 'progress'
              ? expectLater(operation, completion(false))
              : expectLater(
                  operation, throwsA(isA<TimelineRecoveryRequired>()));
          await started.future;
          await discover(timelineB);
          final sessionB = auth.captureSession();
          response.complete(http.Response(
              jsonEncode(
                  {'success': true, '_id': 'late-A', 'progressEpoch': 5}),
              status));
          await checked;
          expect(sessionB.isDataCurrent, true);
          expect(auth.token, 'synthetic');
          expect(timeline.recoveryRequired, true);
          expect((await records(kind)).single['dataTimelineId'], timelineA);
          if (kind != 'progress') {
            expect((await records(kind)).single['state'], 'pending');
          }
        },
            () => MockClient((request) {
                  if (request.method == 'GET') {
                    return Future.value(http.Response('{}', 503));
                  }
                  expect(request.headers['X-Data-Timeline'], timelineA);
                  started.complete();
                  return response.future;
                }));
      });
    }
  }
  for (var repeat = 1; repeat <= 10; repeat++) {
    test(
        '10E Community file preparation A to B repeat $repeat preserves original durable evidence',
        () async {
      final image = File('${root.path}/selected.png');
      await image.writeAsBytes([1, 2, 3]);
      final started = Completer<void>(), release = Completer<void>();
      final service = CommunityService(prepareUpload: (request) async {
        final prepared = await PreparedMultipartMutation.prepare(request);
        started.complete();
        await release.future;
        return prepared;
      });
      var sent = 0;
      String? sentId;
      await http.runWithClient(() async {
        await discover(timelineA);
        final operation = service.createPost(
            learningLanguage: 'en', text: 'draft-A', imagePath: image.path);
        final checked = expectLater(operation, throwsStateError);
        await started.future;
        final old = (await OnlineIntentService.list()).single;
        expect(old['dataTimelineId'], timelineA);
        expect(old['state'], 'preparing');
        await discover(timelineB);
        release.complete();
        await checked;
        expect(sent, 0);
        reopen();
        expect((await OnlineIntentService.list()).single, old);
        await CommunityService().createPost(
            learningLanguage: 'en', text: 'draft-A', imagePath: image.path);
        expect(sent, 1);
        expect(sentId, isNot(old['id']));
        expect((await OnlineIntentService.list()).single, old);
      },
          () => MockClient((request) async {
                if (request.method == 'GET') return http.Response('{}', 503);
                sent++;
                sentId = request.headers['X-Idempotency-Key'];
                expect(request.headers['X-Data-Timeline'], timelineB);
                return http.Response(
                    jsonEncode({
                      '_id': 'new-B',
                      'userId': userA,
                      'userName': 'Synthetic',
                      'learningLanguage': 'en',
                      'text': 'draft-A',
                      'likes': [],
                      'createdAt': '2026-01-01',
                      'updatedAt': '2026-01-01'
                    }),
                    201);
              }));
    });
  }
  test(
      '10E native legacy queue and clear survive restart/first B confirmation unverified',
      () async {
    final action = OfflineQueueAction(
        id: 'legacy-progress',
        type: 'complete-lesson',
        ownerNamespace: owner,
        payload: {'lessonId': 'one', 'score': 80, 'progressEpoch': 5},
        clientProtocolRevision: 1,
        createdAt: DateTime.utc(2020));
    await SyncStorage.backend.write(owner, {
      'schemaVersion': 2,
      'ownerNamespace': owner,
      'actions': [action.toJson()],
      'failedActions': [],
      'tempIds': {},
      'startedCreates': [],
      'progressRevision': 'old',
      'progressEpoch': 5
    });
    final clear = {
      'schemaVersion': 1,
      'id': 'legacy-clear',
      'ownerNamespace': owner,
      'protocol': 1,
      'kind': 'ai-clear',
      'language': 'en',
      'payload': {'targetLanguage': 'en'},
      'state': 'pending',
      'attempts': 0,
      'nextAttemptAt': 0
    };
    await SyncStorage.intents.write(owner, {
      'schemaVersion': 1,
      'ownerNamespace': owner,
      'intents': [clear]
    });
    reopen();
    timeline.resetForTesting();
    await http.runWithClient(() async {
      await timeline.load();
      await discover(timelineB);
      expect(await queue.processQueue(userA), false);
      await expectLater(replayOnlineIntent(clear['id'] as String),
          throwsA(isA<TimelineRecoveryRequired>()));
      expect((await queue.getQueue()).single.toJson(), action.toJson());
      expect((await OnlineIntentService.list()).single, clear);
      expect((await queue.getQueue()).single.timelineProvenance,
          TimelineProvenance.legacyUnverified);
    },
        () => MockClient((request) async {
              expect(request.method, 'GET');
              return http.Response('{}', 503);
            }));
  });
}
