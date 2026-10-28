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
import 'package:lingua_ai/services/client_compatibility.dart';
import 'package:lingua_ai/services/community_service.dart';
import 'package:lingua_ai/services/data_timeline.dart';
import 'package:lingua_ai/services/offline_queue_service.dart';
import 'package:lingua_ai/services/online_intent_service.dart';
import 'package:lingua_ai/services/online_intent_dispatch.dart';
import 'package:lingua_ai/services/progress_api_service.dart';
import 'package:lingua_ai/services/flashcard_api_service.dart';
import 'package:lingua_ai/services/user_api_service.dart';
import 'package:lingua_ai/services/sync_storage.dart';
import 'data_timeline_test.dart'
    show timelineA, timelineB, userA, owner, compatibility;

const responses = [
  (409, 'SERVER_TIMELINE_CHANGED', 'timeline'),
  (428, 'SERVER_TIMELINE_REQUIRED', 'provenance'),
  (426, 'CLIENT_PROTOCOL_UNSUPPORTED', 'paused'),
  (503, 'BACKEND_NOT_READY', 'maintenance'),
  (401, 'UNAUTHORIZED', 'authentication'),
];

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final auth = AuthService(), timeline = DataTimeline();
  late OfflineQueueService queue;
  late SharedPreferences prefs;
  Future<void> discoverB() async {
    await timeline.discover(
        fetch: () async =>
            http.Response(jsonEncode(compatibility(timelineB)), 200));
  }

  setUp(() async {
    ClientCompatibility().resetForTesting();
    SharedPreferences.setMockInitialValues({});
    SyncStorage.backend = PreferencesSyncStorage();
    SyncStorage.intents =
        PreferencesSyncStorage(prefix: 'linguaai_online_intents_');
    SyncStorage.direct =
        PreferencesSyncStorage(prefix: 'linguaai_direct_evidence_');
    await auth.init();
    await auth.setGuestSession(
        id: userA, email: '$userA@guest.lingua.local', token: 'fixture-token');
    prefs = await SharedPreferences.getInstance();
    queue = OfflineQueueService.forTesting(
        progressApi: ProgressApiService(), flashcardApi: FlashcardApiService());
  });
  tearDown(() => ClientCompatibility().resetForTesting());

  for (final collection in ['queue', 'intent']) {
    for (final (status, code, category) in responses) {
      test(
          'actual HTTP $status $code preserves $collection provenance and independent auth behavior',
          () async {
        String id;
        if (collection == 'queue') {
          id = 'queue-operation';
          await queue.pushAction('review-flashcard', {'id': 'card', 'score': 4},
              ownerNamespace: owner, operationId: id);
        } else {
          id = (await OnlineIntentService.prepare(
              'ai-clear', 'en', {'targetLanguage': 'en'}))['id'];
        }
        Object? error;
        var requests = 0;
        await http.runWithClient(() async {
          if (collection == 'queue') {
            expect(await queue.processQueue(userA), false);
          } else {
            try {
              await replayOnlineIntent(id);
            } catch (caught) {
              error = caught;
            }
            expect(error, isNotNull);
          }
        },
            () => MockClient((request) async {
                  requests++;
                  expect(request.headers['X-Data-Timeline'], timelineA);
                  expect(request.headers['X-Client-Protocol'], '2');
                  return http.Response(jsonEncode({'code': code}), status,
                      headers: status == 503 ? {'retry-after': '30'} : {});
                }));
        expect(requests, 1);
        final stored = collection == 'queue'
            ? (await SyncStorage.backend.read(owner))!['actions'].single
            : (await SyncStorage.intents.read(owner))!['intents'].single;
        expect(stored['id'], id);
        expect(stored['dataTimelineId'], timelineA);
        if (collection == 'queue') {
          expect((await SyncStorage.backend.read(owner))!['failedActions'],
              isEmpty);
          if (status != 426) expect(stored['lastErrorCategory'], category);
        } else {
          expect(stored['state'], 'pending');
          if (status != 401) expect(stored['category'], category);
          if ([409, 428, 503].contains(status)) {
            final failure = error as TimelineRecoveryRequired;
            expect(failure.statusCode, status);
            expect(failure.code, code);
            expect(
                failure.kind,
                status == 409
                    ? TimelineFailure.reconciliation
                    : status == 428
                        ? TimelineFailure.provenance
                        : TimelineFailure.maintenance);
          }
        }
        expect(auth.token, status == 401 ? isEmpty : 'fixture-token');
        expect(ClientCompatibility().updateRequired, status == 426);
        if (status == 503) {
          if (collection == 'queue') {
            expect(
                DateTime.parse(stored['nextAttemptAt'])
                    .difference(DateTime.now())
                    .inSeconds,
                greaterThanOrEqualTo(28));
          } else {
            expect(stored['nextAttemptAt'],
                greaterThanOrEqualTo(OnlineIntentService.clock() + 28000));
          }
        }
      });
    }
  }

  for (final domain in ['Community', 'AI', 'progress', 'profile']) {
    for (final status in [200, 409, 428, 426, 503, 401]) {
      test(
          'in-flight A $domain HTTP $status cannot change B auth cache recovery or evidence',
          () async {
        final started = Completer<void>(),
            response = Completer<http.Response>();
        String? id;
        if (domain == 'progress') {
          id = 'completion-A';
          await queue.pushAction('complete-lesson',
              {'lessonId': 'lesson', 'score': 73, 'progressEpoch': 5},
              ownerNamespace: owner, operationId: id);
        } else if (domain == 'AI') {
          id = (await OnlineIntentService.prepare('ai-send', 'en', {
            'message': 'hello',
            'language': 'en',
            'targetLanguage': 'en'
          }))['id'];
        }
        await http.runWithClient(() async {
          final Future<dynamic> operation = domain == 'progress'
              ? queue.processQueue(userA)
              : domain == 'AI'
                  ? replayOnlineIntent(id!)
                  : domain == 'Community'
                      ? CommunityService().updatePost(
                          postId: 'post', expectedRevision: 5, text: 'A')
                      : UserApiService().updateProfile(name: 'A');
          final assertion = domain == 'progress'
              ? expectLater(operation, completion(false))
              : expectLater(
                  operation, throwsA(isA<TimelineRecoveryRequired>()));
          await started.future;
          await discoverB();
          final sessionB = auth.captureSession();
          await prefs.setString('B-cache', 'coherent-B');
          final code =
              responses.where((item) => item.$1 == status).firstOrNull?.$2;
          response.complete(http.Response(
              jsonEncode(status == 200
                  ? {'reply': 'late', '_id': 'post'}
                  : {'code': code}),
              status));
          await assertion;
          expect(sessionB.isCurrent, true);
          expect(auth.token, 'fixture-token');
          expect(prefs.getString('B-cache'), 'coherent-B');
          expect(timeline.recoveryRequired, true);
          expect(ClientCompatibility().updateRequired, false);
          final record = domain == 'progress'
              ? (await SyncStorage.backend.read(owner))!['actions'].single
              : domain == 'AI'
                  ? (await SyncStorage.intents.read(owner))!['intents'].single
                  : (await SyncStorage.direct.read(owner))!['records'].single;
          expect(record['dataTimelineId'], timelineA);
          if (id != null) expect(record['id'], id);
          if (domain == 'AI') expect(record['state'], 'pending');
          if (domain == 'progress') {
            expect((await queue.getFailedActions()), isEmpty);
          }
        },
            () => MockClient((request) {
                  if (request.url.path == '/users/me') {
                    return Future.value(http.Response('{}', 503));
                  }
                  if (!started.isCompleted) started.complete();
                  return response.future;
                }));
      });
    }
  }

  test(
      'all 15 public durable writers persist provenance before HTTP and stable A retries cannot adopt B',
      () async {
    const routes = [
      ('POST', '/auth/register'),
      ('POST', '/auth/guest'),
      ('PATCH', '/users/profile'),
      ('POST', '/progress/:userId/complete-lesson'),
      ('DELETE', '/progress/:userId'),
      ('POST', '/flashcards'),
      ('PUT', '/flashcards/:id'),
      ('DELETE', '/flashcards/:id'),
      ('PUT', '/flashcards/:id/review'),
      ('POST', '/community/posts'),
      ('PUT', '/community/posts/:id'),
      ('DELETE', '/community/posts/:id'),
      ('POST', '/community/posts/:id/like'),
      ('POST', '/ai-coach/chat'),
      ('DELETE', '/ai-coach/clear'),
    ];
    final source = await File(
            '../lingua_ai_backend/src/compatibility/protocol-contract.ts')
        .readAsString();
    final fenced = RegExp(r"\['(POST|PUT|PATCH|DELETE)', '([^']+)', 'FENCED'\]")
        .allMatches(source)
        .map((match) => '${match[1]} ${match[2]}')
        .toSet();
    expect(routes.map((route) => '${route.$1} ${route.$2}').toSet(), fenced);
    Future<http.Response> dispatch(String method, String path, int index) {
      final url = Uri.parse(
          '${ApiConfig.baseUrl}${path.replaceAll(':userId', userA).replaceAll(':id', 'resource')}');
      final headers = {'X-Idempotency-Key': 'inventory-$index'};
      switch (method) {
        case 'POST':
          return backend.post(url, headers: headers, body: '{}');
        case 'PUT':
          return backend.put(url, headers: headers, body: '{}');
        case 'PATCH':
          return backend.patch(url, headers: headers, body: '{}');
        default:
          return backend.delete(url, headers: headers, body: '{}');
      }
    }

    var requests = 0;
    await http.runWithClient(() async {
      for (var i = 0; i < routes.length; i++) {
        await dispatch(routes[i].$1, routes[i].$2, i);
      }
      expect(requests, 15);
      final before = (await SyncStorage.direct.read(owner))!['records'];
      expect(before, hasLength(15));
      await discoverB();
      for (var i = 0; i < routes.length; i++) {
        await expectLater(dispatch(routes[i].$1, routes[i].$2, i),
            throwsA(isA<TimelineRecoveryRequired>()));
      }
      expect(requests, 15);
      expect((await SyncStorage.direct.read(owner))!['records'], before);
    },
        () => MockClient((request) async {
              if (request.url.path == '/users/me') {
                return http.Response('{}', 503);
              }
              requests++;
              final id = request.headers['X-Idempotency-Key'];
              final record =
                  ((await SyncStorage.direct.read(owner))!['records'] as List)
                      .singleWhere((item) => item['id'] == id);
              expect(record['ownerNamespace'], owner);
              expect(record['dataTimelineId'], timelineA);
              expect(request.headers['X-Data-Timeline'], timelineA);
              expect(request.headers['X-Client-Protocol'], '2');
              return http.Response('{}', 503);
            }));
  });
}
