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
import 'package:lingua_ai/services/sync_storage.dart';
import 'package:lingua_ai/services/sync_storage_io.dart';
import 'data_timeline_test.dart'
    show timelineA, timelineB, userA, owner, compatibility;

class PauseAuthenticationCheckpoint implements SyncStorageBackend {
  final SyncStorageBackend delegate;
  final started = Completer<void>(), release = Completer<void>();
  bool paused = false;
  PauseAuthenticationCheckpoint(this.delegate);
  @override
  bool get durable => delegate.durable;
  @override
  Future<Map<String, dynamic>?> read(String owner) => delegate.read(owner);
  @override
  Future<void> write(String owner, Map<String, dynamic> value) async {
    if (!paused &&
        (value['actions'] as List? ?? [])
            .any((item) => item['lastErrorCategory'] == 'authentication')) {
      paused = true;
      started.complete();
      await release.future;
    }
    await delegate.write(owner, value);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final auth = AuthService(), timeline = DataTimeline();
  late Directory directory;
  late SharedPreferences prefs;
  late OfflineQueueService queue;
  Map<String, dynamic> profile(String name) => {
        'id': userA,
        'name': name,
        'email': '$userA@guest.lingua.local',
        'isGuest': true,
        'targetLanguage': 'en',
      };
  Map<String, dynamic> post() => {
        '_id': 'post',
        'userId': userA,
        'userName': 'Fixture',
        'text': 'original',
        'learningLanguage': 'en',
        'likes': <dynamic>[],
        'likesCount': 0,
        'likedByMe': false,
        'createdAt': '2026-01-01',
        'updatedAt': '2026-01-01',
      };
  Future<void> discover(String id) async {
    await timeline.discover(
        fetch: () async => http.Response(jsonEncode(compatibility(id)), 200));
  }

  Future<void> settle() async {
    for (var i = 0; i < 20; i++) {
      await Future<void>.delayed(Duration.zero);
    }
  }

  Map<String, dynamic> storedProfile() =>
      jsonDecode(prefs.getString(AuthService.profileProjectionKey(owner))!);
  void reopen() {
    SyncStorage.backend =
        FileSyncStorage(() async => Directory('${directory.path}/queue'));
    SyncStorage.intents =
        FileSyncStorage(() async => Directory('${directory.path}/intents'));
    SyncStorage.direct =
        FileSyncStorage(() async => Directory('${directory.path}/direct'));
    queue = OfflineQueueService.forTesting(
        progressApi: ProgressApiService(), flashcardApi: FlashcardApiService());
  }

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    directory = await Directory.systemTemp.createTemp('lingua-corrective-');
    reopen();
    timeline.resetForTesting(confirmed: timelineA);
    await auth.init();
    auth.beforeProfileProjectionWrite = null;
    auth.writeProfileProjectionForTesting = null;
    await auth.setGuestSession(
        id: userA, email: '$userA@guest.lingua.local', token: 'stable-token');
    prefs = await SharedPreferences.getInstance();
  });
  tearDown(() async {
    auth.beforeProfileProjectionWrite = null;
    auth.writeProfileProjectionForTesting = null;
    SyncStorage.backend = PreferencesSyncStorage();
    SyncStorage.intents =
        PreferencesSyncStorage(prefix: 'linguaai_online_intents_');
    SyncStorage.direct =
        PreferencesSyncStorage(prefix: 'linguaai_direct_evidence_');
    if (directory.parent.absolute.path != Directory.systemTemp.absolute.path ||
        !directory.path
            .split(Platform.pathSeparator)
            .last
            .startsWith('lingua-corrective-')) {
      throw StateError('Unsafe fixture cleanup');
    }
    await directory.delete(recursive: true);
  });

  for (final changed in [false, true]) {
    test(
        'B1 file preparation ${changed ? 'crosses A to B without adopting B' : 'stays A and sends its original identity'}',
        () async {
      final image = File('${directory.path}/selected.png');
      await image.writeAsBytes([1, 2, 3]);
      final started = Completer<void>(), release = Completer<void>();
      final service = CommunityService(prepareUpload: (request) async {
        final prepared = await PreparedMultipartMutation.prepare(request);
        started.complete();
        await release.future;
        return prepared;
      });
      final sent = <http.Request>[];
      await http.runWithClient(() async {
        final operation = service.createPost(
            learningLanguage: 'en', text: 'original', imagePath: image.path);
        final assertion =
            changed ? expectLater(operation, throwsStateError) : null;
        await started.future;
        final saved = (await OnlineIntentService.list()).single;
        expect(saved['state'], 'preparing');
        expect(saved['dataTimelineId'], timelineA);
        expect(saved['payload']['fields']['text'], 'original');
        if (changed) await discover(timelineB);
        release.complete();
        if (changed) {
          await assertion;
          expect(sent, isEmpty);
          expect((await OnlineIntentService.list()).single, saved);
          reopen();
          expect((await OnlineIntentService.list()).single, saved);
          await CommunityService().createPost(
              learningLanguage: 'en', text: 'original', imagePath: image.path);
          expect(sent, hasLength(1));
          expect(sent.single.headers['X-Data-Timeline'], timelineB);
          expect(sent.single.headers['X-Idempotency-Key'], isNot(saved['id']));
          expect((await OnlineIntentService.list()).single, saved);
        } else {
          await operation;
          expect(sent.single.headers['X-Data-Timeline'], timelineA);
          expect(sent.single.headers['X-Idempotency-Key'], saved['id']);
          expect(await OnlineIntentService.list(), isEmpty);
        }
      },
          () => MockClient((request) async {
                if (request.method == 'POST') {
                  sent.add(request);
                  return http.Response(jsonEncode(post()), 201);
                }
                return http.Response('{}', 503);
              }));
    });
  }

  test(
      'B2 A 401 paused at checkpoint cannot invalidate B; genuine B 401 still invalidates',
      () async {
    await queue.pushAction('review-flashcard', {'id': 'card', 'score': 4},
        ownerNamespace: owner, operationId: 'A-review');
    final paused = PauseAuthenticationCheckpoint(SyncStorage.backend);
    SyncStorage.backend = paused;
    await http.runWithClient(() async {
      final drain = queue.processQueue(userA);
      await paused.started.future;
      await discover(timelineB);
      final sessionB = auth.captureSession();
      await prefs.setString('B-cache-sentinel', 'retained');
      paused.release.complete();
      expect(await drain, false);
      expect(sessionB.isCurrent, true);
      expect(auth.token, 'stable-token');
      expect(auth.currentUserId, userA);
      expect(prefs.getString('B-cache-sentinel'), 'retained');
      expect(timeline.recoveryRequired, true);
      final actionA = (await queue.getQueue()).single;
      expect(actionA.dataTimelineId, timelineA);
      expect(actionA.id, 'A-review');
      expect(await queue.getFailedActions(), isEmpty);
      await queue.pushAction('review-flashcard', {'id': 'card', 'score': 5},
          ownerNamespace: owner, operationId: 'B-review');
      await queue.processQueue(userA);
      expect(auth.token, isEmpty);
      expect(sessionB.isCurrent, false);
      final journal = await SyncStorage.backend.read(owner);
      expect(journal!['actions'].last['dataTimelineId'], timelineB);
      expect(journal['actions'].last['lastErrorCategory'], 'authentication');
    },
        () => MockClient((request) async =>
            http.Response('{}', request.url.path == '/users/me' ? 503 : 401)));
  });

  test(
      'B3 A save pauses, B save completes, A resumes: restart reads coherent B projection',
      () async {
    final started = Completer<void>(), release = Completer<void>();
    auth.beforeProfileProjectionWrite = (record) async {
      if (record['dataTimelineId'] == timelineA && !started.isCompleted) {
        started.complete();
        await release.future;
      }
    };
    await http.runWithClient(() async {
      final saveA = auth.fetchLatestProfile();
      await started.future;
      await discover(timelineB);
      await auth.fetchLatestProfile();
      expect(storedProfile()['data']['name'], 'profile-B');
      expect(storedProfile()['dataTimelineId'], timelineB);
      release.complete();
      await saveA;
      await settle();
      expect(storedProfile()['data']['name'], 'profile-B');
      // Even old per-field pairs cannot override the atomic projection.
      await prefs.setString('currentUserName', 'stale-A');
      await prefs.setString('profileDataTimelineId', timelineB);
      final snapshot = {
        for (final key in prefs.getKeys()) key: prefs.get(key)!
      };
      SharedPreferences.setMockInitialValues(snapshot);
      await auth.init();
      expect(auth.currentUserName, 'profile-B');
      expect(auth.hasCurrentProfile, true);
    },
        () => MockClient((_) async => http.Response(
            jsonEncode(profile(timeline.lastConfirmedDataTimelineId == timelineA
                ? 'profile-A'
                : 'profile-B')),
            200)));
  });

  test(
      'B3 reverse completion: B save pauses and late A response cannot enter projection',
      () async {
    final requestA = Completer<void>(), responseA = Completer<http.Response>();
    final saveB = Completer<void>(), releaseB = Completer<void>();
    auth.beforeProfileProjectionWrite = (record) async {
      if (record['dataTimelineId'] == timelineB && !saveB.isCompleted) {
        saveB.complete();
        await releaseB.future;
      }
    };
    await http.runWithClient(() async {
      final old = auth.fetchLatestProfile();
      await requestA.future;
      await discover(timelineB);
      await saveB.future;
      responseA.complete(http.Response(jsonEncode(profile('late-A')), 200));
      await old;
      releaseB.complete();
      await auth.fetchLatestProfile();
      expect(storedProfile()['data']['name'], 'profile-B');
      expect(storedProfile()['dataTimelineId'], timelineB);
      final snapshot = {
        for (final key in prefs.getKeys()) key: prefs.get(key)!
      };
      SharedPreferences.setMockInitialValues(snapshot);
      await auth.init();
      expect(auth.currentUserName, 'profile-B');
    },
        () => MockClient((_) async {
              if (timeline.lastConfirmedDataTimelineId == timelineA) {
                requestA.complete();
                return responseA.future;
              }
              return http.Response(jsonEncode(profile('profile-B')), 200);
            }));
  });

  test(
      'B3 failed atomic projection write leaves coherent A and cannot authorize it on B restart',
      () async {
    final old = storedProfile();
    var fail = true;
    auth.writeProfileProjectionForTesting = (_, _) async => false;
    await http.runWithClient(() async {
      await discover(timelineB);
      await auth.fetchLatestProfile();
      expect(storedProfile(), old);
      fail = false;
      final snapshot = {
        for (final key in prefs.getKeys()) key: prefs.get(key)!
      };
      SharedPreferences.setMockInitialValues(snapshot);
      await auth.init();
      expect(auth.hasCurrentProfile, false);
      expect(auth.currentUserName, isNot('Guest User from A'));
      expect(storedProfile()['dataTimelineId'], timelineA);
    },
        () => MockClient((_) async => fail
            ? http.Response(jsonEncode(profile('profile-B')), 200)
            : http.Response('{}', 503)));
  });

  test(
      'AI clear discard survives a second store/timeline restart and cannot revive its ID',
      () async {
    final clear = await OnlineIntentService.prepare(
        'ai-clear', 'en', {'targetLanguage': 'en'});
    reopen();
    await discover(timelineB);
    await http.runWithClient(
        () => OnlineIntentService.discardForReconciliation(clear['id']),
        () =>
            MockClient((_) async => throw StateError('Discard sends no HTTP')));
    reopen();
    timeline.resetForTesting();
    await timeline.load();
    await discover(timelineB);
    expect(await OnlineIntentService.list(), isEmpty);
    await expectLater(
        OnlineIntentService.prepare('ai-clear', 'en', {'targetLanguage': 'en'},
            operationId: clear['id']),
        throwsA(isA<IntentRecoveryRequired>()));
    await expectLater(replayOnlineIntent(clear['id']),
        throwsA(isA<IntentRecoveryRequired>()));
    final fresh = await OnlineIntentService.prepare(
        'ai-clear', 'en', {'targetLanguage': 'en'});
    expect(fresh['id'], isNot(clear['id']));
    expect(fresh['dataTimelineId'], timelineB);
  });
}
