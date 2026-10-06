import 'dart:async';
import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/connectivity_service.dart';
import 'package:lingua_ai/services/offline_queue_service.dart';
import 'package:lingua_ai/services/progress_service.dart';
import 'package:lingua_ai/core/localization/target_language_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const a = '507f1f77bcf86cd799439011';
  const b = '507f1f77bcf86cd799439012';
  final auth = AuthService();
  final progress = ProgressService();
  final queue = OfflineQueueService();
  final language = TargetLanguageService();
  late SharedPreferences prefs;
  final serverIds = <String>{};
  var serverXp = 0;
  var uploadFails = false;
  var fetchFails = false;
  var resetFails = false;
  final sent = <Map<String, dynamic>>[];
  final events = <String>[];
  Completer<void>? postStarted;
  Completer<void>? postRelease;
  Completer<void>? getStarted;
  Completer<void>? getRelease;
  Future<void> settle() async {
    for (var i = 0; i < 12; i++) {
      await Future<void>.delayed(Duration.zero);
    }
  }

  Future<void> login(String id) async {
    await auth.setGuestSession(
        id: id, email: 'guest-$id@guest.lingua.local', token: 'test-$id');
    await settle();
  }

  Future<http.Response> transport(http.Request request) async {
    if (request.method == 'POST') {
      final payload = jsonDecode(request.body) as Map<String, dynamic>;
      sent.add(
          {...payload, 'operationId': request.headers['X-Idempotency-Key']});
      postStarted?.complete();
      postStarted = null;
      if (postRelease != null) await postRelease!.future;
      if (uploadFails) return http.Response('{}', 503);
      if (serverIds.add(payload['lessonId'] as String)) {
        serverXp += payload['lessonId'] == 'two' ? 80 : 50;
      }
      events.add('complete');
      return http.Response(
          jsonEncode({
            'data': {
              'lessonId': payload['lessonId'],
              'score': payload['score'],
              'xpEarned': 50,
              'newTotalXp': serverXp
            }
          }),
          201);
    }
    if (request.method == 'DELETE') {
      events.add('reset');
      if (resetFails) return http.Response('{}', 503);
      serverIds.clear();
      serverXp = 0;
      return http.Response('{}', 200);
    }
    // Capture the snapshot before the GET await, to reproduce stale snapshots.
    final body = {
      'stats': {'totalXp': serverXp, 'streak': 0},
      'completedLessons':
          serverIds.map((id) => {'lessonId': id, 'score': 73}).toList()
    };
    getStarted?.complete();
    getStarted = null;
    if (getRelease != null) await getRelease!.future;
    return http.Response(jsonEncode(body), fetchFails ? 503 : 200);
  }

  Future<void> sync() =>
      http.runWithClient(progress.syncWithBackend, () => MockClient(transport));
  Future<void> restart() async {
    final saved = {for (final key in prefs.getKeys()) key: prefs.get(key)!};
    SharedPreferences.setMockInitialValues(saved);
    await auth.init();
    await language.init();
    prefs = await SharedPreferences.getInstance();
    await progress.init();
    await progress.reloadProgress();
    await settle();
  }

  setUpAll(() async {
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
        const MethodChannel('dev.fluttercommunity.plus/connectivity'),
        (call) async => 'none');
    messenger.setMockMethodCallHandler(
        const MethodChannel('dev.fluttercommunity.plus/connectivity_status'),
        (call) async => null);
    await ConnectivityService().init();
    SharedPreferences.setMockInitialValues({});
    await auth.init();
    await language.init();
    await progress.init();
    prefs = await SharedPreferences.getInstance();
  });
  tearDownAll(() => ConnectivityService().dispose());
  setUp(() async {
    await prefs.clear();
    serverIds.clear();
    serverXp = 0;
    uploadFails = false;
    fetchFails = false;
    resetFails = false;
    postStarted = null;
    postRelease = null;
    getStarted = null;
    getRelease = null;
    sent.clear();
    events.clear();
    await login(a);
    await language.setLanguage('en', syncToBackend: false);
    await progress.reloadProgress();
  });

  test(
      'offline original 73 and operation ID survive restart; acknowledgement retains server state',
      () async {
    await progress.completeLesson('one', 50, score: 73);
    final action = (await queue.getQueue()).single;
    expect(action.payload['score'], 73);
    expect(action.payload['targetLanguage'], 'en');
    expect(action.ownerNamespace, 'guest_$a');
    expect(action.createdAt.isUtc, true);
    await restart();
    expect(progress.totalXp, 50);
    expect(progress.isLessonCompleted('one'), true);
    await sync();
    expect(sent.single['score'], 73);
    expect(sent.single['operationId'], action.id);
    expect(await queue.getQueue(), isEmpty);
    expect(progress.totalXp, 50);
    await progress.reloadProgress();
    expect(progress.totalXp, 50);
    expect(progress.isLessonCompleted('one'), true);
  });
  test(
      'failed completion remains pending over refreshed server and avoids duplicate local XP',
      () async {
    await progress.completeLesson('one', 50, score: 73);
    uploadFails = true;
    await sync();
    await sync();
    expect((await queue.getQueue()).single.payload['score'], 73);
    expect(progress.totalXp, 50);
    expect(progress.isLessonCompleted('one'), true);
    // Backend may already have accepted a lost-response completion.
    serverIds.add('one');
    serverXp = 50;
    await sync();
    expect(progress.totalXp, 50);
    expect(await queue.getQueue(), hasLength(1));
  });
  test('acknowledged completion survives failed GET and restart without replay',
      () async {
    await progress.completeLesson('one', 50, score: 73);
    fetchFails = true;
    await sync();
    expect(await queue.getQueue(), isEmpty);
    expect(progress.totalXp, 50);
    await restart();
    expect(progress.totalXp, 50);
    expect(progress.isLessonCompleted('one'), true);
    expect(sent, hasLength(1));
  });
  test('overlapping offline completions both persist with original scores',
      () async {
    await Future.wait([
      progress.completeLesson('one', 50, score: 73),
      progress.completeLesson('two', 80, score: 42)
    ]);
    await settle();
    expect(progress.totalXp, 130);
    expect(progress.completedLessonIds, {'one', 'two'});
    expect((await queue.getQueue()).map((a) => a.payload['score']), [73, 42]);
    await restart();
    expect(progress.totalXp, 130);
    await sync();
    expect(progress.totalXp, 130);
  });
  test('new completion during server GET survives snapshot reconciliation',
      () async {
    getStarted = Completer<void>();
    getRelease = Completer<void>();
    final started = getStarted!;
    final refresh = sync();
    await started.future;
    await progress.completeLesson('one', 50, score: 73);
    getRelease!.complete();
    await refresh;
    expect(progress.totalXp, 50);
    expect(progress.isLessonCompleted('one'), true);
    expect(await queue.getQueue(), hasLength(1));
  });
  test('pending completion never crosses language or owner boundary', () async {
    await progress.completeLesson('one', 50, score: 73);
    await language.setLanguage('de', syncToBackend: false);
    await progress.reloadProgress();
    expect(progress.totalXp, 0);
    expect(progress.completedLessonIds, isEmpty);
    await login(b);
    await progress.reloadProgress();
    expect(progress.totalXp, 0);
    await login(a);
    await language.setLanguage('en', syncToBackend: false);
    await progress.reloadProgress();
    expect(progress.totalXp, 50);
    expect(progress.isLessonCompleted('one'), true);
  });
  test(
      'offline reset cancels obsolete completion across restart and retains later work',
      () async {
    await progress.completeLesson('obsolete', 50, score: 73);
    await progress.resetProgress();
    expect(progress.totalXp, 0);
    await progress.completeLesson('after-reset', 50, score: 42);
    await restart();
    await sync();
    expect(sent.single['lessonId'], 'after-reset');
    expect(events, ['reset', 'complete']);
    expect(progress.totalXp, 50);
    expect(await queue.getQueue(), isEmpty);
  });
  test('failed reset masks old server state and stays queued', () async {
    await progress.completeLesson('obsolete', 50, score: 73);
    await progress.resetProgress();
    serverIds.add('obsolete');
    serverXp = 500;
    resetFails = true;
    await sync();
    expect(progress.totalXp, 0);
    expect(progress.completedLessonIds, isEmpty);
    expect((await queue.getQueue()).single.type, 'reset-progress');
  });
  test(
      'reset runs after in-flight completion and stale response cannot restore progress',
      () async {
    await progress.completeLesson('obsolete', 50, score: 73);
    postStarted = Completer<void>();
    postRelease = Completer<void>();
    final started = postStarted!;
    final drain = sync();
    await started.future;
    await progress.resetProgress();
    final reset = sync();
    postRelease!.complete();
    await Future.wait([drain, reset]);
    expect(events, ['complete', 'reset']);
    expect(progress.totalXp, 0);
    expect(progress.completedLessonIds, isEmpty);
    expect(await queue.getQueue(), isEmpty);
  });
  test(
      'owner-scoped legacy completion without score is retained and never fabricated as 100',
      () async {
    await queue.pushAction('complete-lesson', {'lessonId': 'unknown'},
        ownerNamespace: auth.localStorageNamespace);
    await sync();
    expect(sent, isEmpty);
    expect(await queue.getQueue(), isEmpty);
    expect(await queue.getFailedActions(), hasLength(1));
  });
  test(
      'valid legacy owned score gains cached context without changing action ID',
      () async {
    await prefs.setString(
        'lessons_cache_English',
        jsonEncode([
          {'id': 'legacy', 'targetLanguage': 'English', 'xpReward': 50}
        ]));
    await queue.pushAction(
        'complete-lesson', {'lessonId': 'legacy', 'score': 73},
        ownerNamespace: auth.localStorageNamespace);
    final id = (await queue.getQueue()).single.id;
    await progress.reloadProgress();
    expect(progress.totalXp, 50);
    final migrated = (await queue.getQueue()).single;
    expect(migrated.id, id);
    expect(migrated.payload['score'], 73);
    expect(migrated.payload['targetLanguage'], 'en');
    uploadFails = true;
    await sync();
    expect(progress.isLessonCompleted('legacy'), true);
    await language.setLanguage('de', syncToBackend: false);
    await progress.reloadProgress();
    expect(progress.totalXp, 0);
  });
  test('score zero stays zero; unscored cached IDs do not create uploads',
      () async {
    await prefs.setStringList(
        'progress_guest_${a}_en_completedLessonIds', ['unscored']);
    await progress.reloadProgress();
    await progress.completeLesson('zero', 50, score: 0);
    await sync();
    expect(sent, hasLength(1));
    expect(sent.single['score'], 0);
  });
  test('reset retires registered legacy caches across languages', () async {
    auth.setBackendSession(
        name: 'A', email: 'member@example.com', token: 'test-$a', id: a);
    await settle();
    final legacy = auth.legacyRegisteredStorageNamespace!;
    await prefs.setInt('progress_${legacy}_de_totalXp', 500);
    await prefs.setStringList(
        'progress_${legacy}_de_completedLessonIds', ['old-german']);
    await progress.resetProgress();
    await language.setLanguage('de', syncToBackend: false);
    await progress.reloadProgress();
    expect(progress.totalXp, 0);
    expect(prefs.containsKey('progress_${legacy}_de_totalXp'), false);
  });
}
