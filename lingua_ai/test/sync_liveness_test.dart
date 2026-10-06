import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/connectivity_service.dart';
import 'package:lingua_ai/services/offline_queue_service.dart';
import 'package:lingua_ai/services/flashcard_api_service.dart';
import 'package:lingua_ai/services/progress_api_service.dart';
import 'package:lingua_ai/services/sync_coordinator.dart';
import 'package:lingua_ai/services/sync_retry_policy.dart';

class ClosingClient extends MockClient {
  bool closed = false;
  ClosingClient(super.handler);
  @override
  void close() {
    closed = true;
    super.close();
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const a = '507f1f77bcf86cd799439011';
  const b = '507f1f77bcf86cd799439012';
  final auth = AuthService();
  var now = DateTime.utc(2026);
  late OfflineQueueService queue;
  Future<void> login(String id, {bool guest = false}) async {
    if (guest) {
      await auth.setGuestSession(
          id: id, email: 'guest-$id@guest.lingua.local', token: 'token-$id');
    } else {
      auth.setBackendSession(
          name: 'Test', email: '$id@example.com', token: 'token-$id', id: id);
      await Future<void>.delayed(Duration.zero);
    }
  }

  OfflineQueueService freshQueue({Duration timeout = replayTimeout}) =>
      OfflineQueueService.forTesting(
          progressApi: ProgressApiService(),
          flashcardApi: FlashcardApiService(),
          now: () => now,
          timeout: timeout);
  Future<void> push(
          [String type = 'complete-lesson', Map<String, dynamic>? payload]) =>
      queue.pushAction(
          type,
          payload ??
              {
                'lessonId': 'one',
                'score': 73,
                'xpReward': 50,
                'targetLanguage': 'en'
              },
          ownerNamespace: auth.localStorageNamespace);
  http.Response success(http.Request request) => http.Response(
      jsonEncode(request.url.path.endsWith('complete-lesson')
          ? {
              'data': {'newTotalXp': 50, 'lessonId': 'one', 'score': 73}
            }
          : {'_id': '507f1f77bcf86cd799439013'}),
      200);
  Future<void> until(bool Function() condition) async {
    for (var i = 0; i < 100 && !condition(); i++) {
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
    expect(condition(), true);
  }

  setUp(() async {
    now = DateTime.utc(2026);
    SharedPreferences.setMockInitialValues({});
    await auth.init();
    await login(a);
    queue = freshQueue();
  });

  test(
      'network online/backend down is explicit; periodic recovery auto-drains without screen activity',
      () async {
    var backendAlive = false;
    final healthRequests = <http.Request>[];
    final mutations = <http.Request>[];
    final health = ConnectivityService.forTesting(
        networkAvailable: () async => true,
        probeInterval: const Duration(milliseconds: 40),
        clientFactory: () => MockClient((request) async {
              healthRequests.add(request);
              return http.Response('{"status":"ok"}', backendAlive ? 200 : 503);
            }));
    final coordinator = SyncCoordinator.forTesting(
        queue: queue, connectivity: health, now: () => now);
    await http.runWithClient(() async {
      await health.init();
      coordinator.start();
      try {
        await push();
        await Future<void>.delayed(const Duration(milliseconds: 20));
        expect(health.networkAvailable, true);
        expect(health.backendReachable, false);
        expect(health.isOffline, true);
        expect(mutations, isEmpty);
        expect(await queue.getQueue(), hasLength(1));
        backendAlive = true;
        await until(() => mutations.length == 1);
        await Future<void>.delayed(const Duration(milliseconds: 20));
      } finally {
        coordinator.stop();
        health.dispose();
      }
    },
        () => MockClient((request) async {
              mutations.add(request);
              return success(request);
            }));
    expect(
        healthRequests.every((request) => request.url.path == '/health'), true);
    expect(
        healthRequests
            .every((request) => request.headers['Authorization'] == null),
        true);
    expect(await queue.getQueue(), isEmpty);
  });

  test(
      'transient failure persists backoff, does not immediately retry, and succeeds with stable ID after restart',
      () async {
    await push();
    final id = (await queue.getQueue()).single.id;
    var calls = 0;
    await http.runWithClient(() async {
      expect(await queue.processQueue(a), false);
      final pending = (await queue.getQueue()).single;
      expect(pending.attemptCount, 1);
      expect(pending.lastErrorCategory, 'backend');
      expect(pending.nextAttemptAt!.difference(pending.lastAttemptAt!),
          const Duration(seconds: 5));
      expect(await queue.processQueue(a), false);
      expect(calls, 1);
      final prefs = await SharedPreferences.getInstance();
      final disk = {for (final key in prefs.getKeys()) key: prefs.get(key)!};
      expect(prefs.getString('linguaai_offline_queue_registered_$a'),
          isNot(contains('secret')));
      SharedPreferences.setMockInitialValues(disk);
      await auth.init();
      queue = freshQueue();
      expect((await queue.getQueue()).single.id, id);
      expect(await queue.processQueue(a), false);
      expect(calls, 1);
      now = now.add(const Duration(seconds: 5));
      expect(await queue.processQueue(a), true);
      expect(await queue.getQueue(), isEmpty);
    },
        () => MockClient((request) async {
              if (request.method == 'GET') {
                return http.Response(
                    jsonEncode(
                        {'id': a, 'name': 'Test', 'email': '$a@example.com'}),
                    200);
              }
              calls++;
              expect(request.headers['X-Idempotency-Key'], id);
              return calls == 1
                  ? http.Response('secret server response', 503)
                  : success(request);
            }));
    expect(calls, 2);
  });
  test(
      'bounded exponential delay and FIFO preserve failed create/review/reset ordering',
      () async {
    await push('create-flashcard', {
      'tempId': 'local_1',
      'targetWord': 'word',
      'turkishTranslation': 'translation',
      'targetLanguage': 'English'
    });
    await push('review-flashcard', {'cardId': 'local_1', 'score': 4});
    var calls = 0;
    await http.runWithClient(() async {
      for (final seconds in [5, 10, 20, 40, 80, 160, 300, 300]) {
        expect(await queue.processQueue(a), false);
        final pending = (await queue.getQueue()).first;
        expect(pending.nextAttemptAt!.difference(pending.lastAttemptAt!),
            Duration(seconds: seconds));
        final before = calls;
        expect(await queue.processQueue(a), false);
        expect(calls, before);
        now = now.add(Duration(seconds: seconds));
      }
      expect(await queue.getQueue(), hasLength(2));
    },
        () => MockClient((request) async {
              calls++;
              expect(request.method, 'POST');
              return http.Response('{}', 429);
            }));
  });
  for (final status in [400, 403, 404, 409, 422]) {
    test(
        'terminal $status quarantines create/dependent review and permits unrelated completion; owner isolated',
        () async {
      await push('create-flashcard', {
        'tempId': 'local_1',
        'targetWord': 'word',
        'turkishTranslation': 'translation',
        'targetLanguage': 'English'
      });
      await push('review-flashcard', {'cardId': 'local_1', 'score': 4});
      await push();
      final calls = <http.Request>[];
      await http.runWithClient(() async {
        expect(await queue.processQueue(a), false);
        expect(await queue.getQueue(), isEmpty);
        final failed = await queue.getFailedActions();
        expect(failed, hasLength(2));
        expect(failed.last.lastErrorCategory, 'dependency');
        expect(failed.first.ownerNamespace, 'registered_$a');
        expect(failed.first.failedAt, isNotNull);
        queue = freshQueue();
        expect(await queue.getFailedActions(), hasLength(2));
        expect(await queue.processQueue(a), true);
        expect(calls, hasLength(2));
        await login(b);
        expect(await queue.getFailedActions(), isEmpty);
        await login(a);
        expect(await queue.getFailedActions(), hasLength(2));
      },
          () => MockClient((request) async {
                calls.add(request);
                return request.url.path.endsWith('/flashcards')
                    ? http.Response('{}', status)
                    : success(request);
              }));
    });
  }
  test(
      'failed reset blocks successor and future completions until a new explicit reset',
      () async {
    await push('reset-progress', {});
    await push();
    var calls = 0;
    await http.runWithClient(() async {
      expect(await queue.processQueue(a), false);
      expect(await queue.getFailedActions(), hasLength(2));
      await push();
      expect(await queue.processQueue(a), false);
      expect(calls, 1);
      await push('reset-progress', {});
      expect(await queue.getFailedActions(), isEmpty);
      expect(await queue.processQueue(a), true);
    },
        () => MockClient((request) async {
              calls++;
              return http.Response('{}', calls == 1 ? 403 : 200);
            }));
  });
  test(
      'overlapping coordinator recovery triggers drain backend guest exactly once',
      () async {
    await login(a, guest: true);
    await push();
    final started = Completer<void>();
    final release = Completer<http.Response>();
    var calls = 0;
    final health = ConnectivityService.forTesting(
        networkAvailable: () async => true,
        clientFactory: () =>
            MockClient((_) async => http.Response('{"status":"ok"}', 200)));
    final coordinator = SyncCoordinator.forTesting(
        queue: queue, connectivity: health, now: () => now);
    await http.runWithClient(() async {
      await health.init();
      coordinator.start();
      try {
        await started.future;
        coordinator.wake();
        coordinator.wake();
        await health.refresh();
        expect(await queue.processQueue(a), false);
        expect(calls, 1);
        release.complete(http.Response('{"data":{"newTotalXp":50}}', 200));
        await Future<void>.delayed(const Duration(milliseconds: 20));
        expect(await queue.getQueue(), isEmpty);
        expect(calls, 1);
      } finally {
        coordinator.stop();
        health.dispose();
      }
    },
        () => MockClient((request) async {
              calls++;
              expect(request.headers['Authorization'], 'Bearer token-$a');
              started.complete();
              return release.future;
            }));
  });
  test(
      'local guest never sends backend work with reachable backend and coordinator',
      () async {
    await auth.loginAsGuest();
    await push();
    var calls = 0;
    final health = ConnectivityService.forTesting(
        networkAvailable: () async => true,
        clientFactory: () =>
            MockClient((_) async => http.Response('{"status":"ok"}', 200)));
    final coordinator =
        SyncCoordinator.forTesting(queue: queue, connectivity: health);
    await http.runWithClient(() async {
      await health.init();
      coordinator.start();
      try {
        await Future<void>.delayed(const Duration(milliseconds: 20));
        expect(calls, 0);
        expect(await queue.getQueue(), hasLength(1));
      } finally {
        coordinator.stop();
        health.dispose();
      }
    },
        () => MockClient((request) async {
              calls++;
              return success(request);
            }));
  });
  test('hung replay times out, closes client and retains retry metadata',
      () async {
    queue = freshQueue(timeout: const Duration(milliseconds: 30));
    await push();
    final response = Completer<http.Response>();
    late ClosingClient client;
    await http.runWithClient(() async {
      expect(await queue.processQueue(a), false);
      expect(client.closed, true);
      expect((await queue.getQueue()).single.lastErrorCategory, 'timeout');
      response.complete(http.Response('{}', 503));
    }, () => client = ClosingClient((request) => response.future));
  });
  test('coordinator waits for an existing service drain without probe churn',
      () async {
    await login(a, guest: true);
    await push();
    final started = Completer<void>();
    final release = Completer<http.Response>();
    var probes = 0;
    var calls = 0;
    final health = ConnectivityService.forTesting(
        networkAvailable: () async => true,
        clientFactory: () => MockClient((_) async {
              probes++;
              return http.Response('{"status":"ok"}', 200);
            }));
    final coordinator = SyncCoordinator.forTesting(
        queue: queue, connectivity: health, now: () => now);
    await http.runWithClient(() async {
      await health.init();
      final externalDrain = queue.processQueue(a);
      await started.future;
      coordinator.start();
      try {
        await Future<void>.delayed(const Duration(milliseconds: 80));
        expect(calls, 1);
        expect(probes, 1);
        release.complete(
            success(http.Request('POST', Uri.parse('/complete-lesson'))));
        expect(await externalDrain, true);
        await Future<void>.delayed(const Duration(milliseconds: 20));
        expect(await queue.getQueue(), isEmpty);
        expect(calls, 1);
      } finally {
        coordinator.stop();
        health.dispose();
      }
    },
        () => MockClient((request) async {
              calls++;
              started.complete();
              return release.future;
            }));
  });
  test('account switch during a drain resumes only the new active owner',
      () async {
    await login(a, guest: true);
    await push();
    final started = Completer<void>();
    final release = Completer<http.Response>();
    final requests = <http.Request>[];
    final health = ConnectivityService.forTesting(
        networkAvailable: () async => true,
        clientFactory: () =>
            MockClient((_) async => http.Response('{"status":"ok"}', 200)));
    final coordinator = SyncCoordinator.forTesting(
        queue: queue, connectivity: health, now: () => now);
    await http.runWithClient(() async {
      await health.init();
      coordinator.start();
      try {
        await started.future;
        final prefs = await SharedPreferences.getInstance();
        final oldKey = 'linguaai_offline_queue_${auth.localStorageNamespace}';
        final oldQueue = prefs.getString(oldKey);
        await login(b, guest: true);
        await push();
        coordinator.wake();
        release.complete(http.Response('{"data":{"newTotalXp":50}}', 200));
        await until(() => requests.length == 2);
        await Future<void>.delayed(const Duration(milliseconds: 20));
        expect(requests.last.headers['Authorization'], 'Bearer token-$b');
        expect(await queue.getQueue(), isEmpty);
        expect(prefs.getString(oldKey), oldQueue);
      } finally {
        coordinator.stop();
        health.dispose();
      }
    },
        () => MockClient((request) async {
              requests.add(request);
              if (requests.length == 1) {
                started.complete();
                return release.future;
              }
              return success(request);
            }));
  });
  test('connectivity-check errors do not stop later health recovery', () async {
    var failCheck = true;
    final health = ConnectivityService.forTesting(
        networkAvailable: () async {
          if (failCheck) throw StateError('Connectivity plugin unavailable');
          return true;
        },
        clientFactory: () =>
            MockClient((_) async => http.Response('{"status":"ok"}', 200)));
    await health.refresh();
    expect(health.networkAvailable, false);
    expect(health.backendReachable, false);
    failCheck = false;
    await health.refresh();
    expect(health.backendReachable, true);
    health.dispose();
  });
  test(
      'health probe itself is bounded; external network availability cannot override timeout',
      () async {
    final response = Completer<http.Response>();
    late ClosingClient client;
    final health = ConnectivityService.forTesting(
        networkAvailable: () async => true,
        probeTimeout: const Duration(milliseconds: 20),
        clientFactory: () => client = ClosingClient((_) => response.future));
    await health.refresh();
    expect(health.networkAvailable, true);
    expect(health.backendReachable, false);
    expect(client.closed, true);
    response.complete(http.Response('{"status":"ok"}', 200));
    health.dispose();
  });
  test('401 stays pending for authentication recovery', () async {
    await push();
    await http.runWithClient(() async {
      await queue.processQueue(a);
      expect(
          (await queue.getQueue()).single.lastErrorCategory, 'authentication');
      expect(await queue.getFailedActions(), isEmpty);
    }, () => MockClient((_) async => http.Response('{}', 401)));
  });
  test(
      'healthy backend transient retry resumes from coordinator timer without another event',
      () async {
    await login(a, guest: true);
    queue = OfflineQueueService.forTesting(
        progressApi: ProgressApiService(), flashcardApi: FlashcardApiService());
    var calls = 0;
    final health = ConnectivityService.forTesting(
        networkAvailable: () async => true,
        clientFactory: () =>
            MockClient((_) async => http.Response('{"status":"ok"}', 200)));
    final coordinator =
        SyncCoordinator.forTesting(queue: queue, connectivity: health);
    await http.runWithClient(() async {
      await health.init();
      coordinator.start();
      try {
        await push();
        await until(() => calls == 1);
        await Future<void>.delayed(const Duration(milliseconds: 100));
        expect(calls, 1);
        await Future<void>.delayed(const Duration(seconds: 5));
        expect(calls, 2);
        expect(await queue.getQueue(), isEmpty);
      } finally {
        coordinator.stop();
        health.dispose();
      }
    },
        () => MockClient((request) async {
              calls++;
              return calls == 1 ? http.Response('{}', 503) : success(request);
            }));
  });
}
