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
import 'package:lingua_ai/services/progress_cache.dart';
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
  final serverScores = <String, int>{};
  var serverXp = 0;
  var serverEpoch = 0;
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
      final lessonId = payload['lessonId'] as String;
      final score = payload['score'] as int;
      if (score > (serverScores[lessonId] ?? -1)) {
        serverScores[lessonId] = score;
      }
      events.add('complete');
      return http.Response(
          jsonEncode({
            'data': {
              'lessonId': payload['lessonId'],
              'score': serverScores[lessonId],
              'targetLanguage': 'en',
              'xpEarned': 50,
              'progressEpoch': serverEpoch,
              'newTotalXp': serverXp
            }
          }),
          201);
    }
    if (request.method == 'DELETE') {
      events.add('reset');
      if (resetFails) return http.Response('{}', 503);
      serverIds.clear();
      serverScores.clear();
      serverXp = 0;
      serverEpoch = 0;
      serverEpoch++;
      return http.Response(jsonEncode({'progressEpoch': serverEpoch}), 200);
    }
    // Capture the snapshot before the GET await, to reproduce stale snapshots.
    final body = {
      'progressEpoch': serverEpoch,
      'stats': {'totalXp': serverXp, 'streak': 0},
      'completedLessons': serverIds
          .map((id) => {'lessonId': id, 'score': serverScores[id] ?? 73})
          .toList()
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
    SharedPreferences.setMockInitialValues({
      for (final prefix in ['registered', 'guest'])
        for (final id in [a, b]) 'progress_epoch_${prefix}_$id': 0
    });
    await auth.init();
    await language.init();
    await progress.init();
    prefs = await SharedPreferences.getInstance();
  });
  tearDownAll(() => ConnectivityService().dispose());
  setUp(() async {
    await prefs.clear();
    for (final prefix in ['registered', 'guest']) {
      for (final id in [a, b]) {
        await prefs.setInt('progress_epoch_${prefix}_$id', 0);
      }
    }
    serverIds.clear();
    serverScores.clear();
    serverXp = 0;
    serverEpoch = 0;
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
    await progress.completeLesson('one', 50, score: 73, lessonLanguage: 'en');
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
    await progress.completeLesson('one', 50, score: 73, lessonLanguage: 'en');
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
    await progress.completeLesson('one', 50, score: 73, lessonLanguage: 'en');
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
      progress.completeLesson('one', 50, score: 73, lessonLanguage: 'en'),
      progress.completeLesson('two', 80, score: 42, lessonLanguage: 'en')
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
    await progress.completeLesson('one', 50, score: 73, lessonLanguage: 'en');
    getRelease!.complete();
    await refresh;
    expect(progress.totalXp, 50);
    expect(progress.isLessonCompleted('one'), true);
    expect(await queue.getQueue(), hasLength(1));
  });
  test('pending completion never crosses language or owner boundary', () async {
    await progress.completeLesson('one', 50, score: 73, lessonLanguage: 'en');
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
      'offline reset cancels obsolete completion; later work waits for acknowledged epoch',
      () async {
    await progress.completeLesson('obsolete', 50,
        score: 73, lessonLanguage: 'en');
    await progress.resetProgress();
    expect(progress.totalXp, 0);
    await expectLater(
        progress.completeLesson('after-reset', 50,
            score: 42, lessonLanguage: 'en'),
        throwsStateError);
    await restart();
    await sync();
    await progress.completeLesson('after-reset', 50,
        score: 42, lessonLanguage: 'en');
    await sync();
    expect(sent.single['lessonId'], 'after-reset');
    expect(sent.single['progressEpoch'], 1);
    expect(events, ['reset', 'complete']);
    expect(progress.totalXp, 50);
    expect(await queue.getQueue(), isEmpty);
  });
  test('failed reset masks old server state and stays queued', () async {
    await progress.completeLesson('obsolete', 50,
        score: 73, lessonLanguage: 'en');
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
    await progress.completeLesson('obsolete', 50,
        score: 73, lessonLanguage: 'en');
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
    await queue.pushAction('complete-lesson',
        {'lessonId': 'legacy', 'score': 73, 'progressEpoch': 0},
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
    await progress.completeLesson('zero', 50, score: 0, lessonLanguage: 'en');
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
    await sync();
    await language.setLanguage('de', syncToBackend: false);
    await progress.reloadProgress();
    expect(progress.totalXp, 0);
    expect(prefs.containsKey('progress_${legacy}_de_totalXp'), false);
  });

  test(
      '6C: terminal completion is retained but contributes no optimistic completion or XP',
      () async {
    await progress.completeLesson('one', 50, score: 73, lessonLanguage: 'en');
    expect(progress.totalXp, 50);
    await http.runWithClient(
        progress.syncWithBackend,
        () => MockClient((request) async => request.method == 'POST'
            ? http.Response('{}', 403)
            : await transport(request)));
    expect(await queue.getQueue(), isEmpty);
    expect(await queue.getFailedActions(), hasLength(1));
    expect(progress.completedLessonIds, isEmpty);
    expect(progress.totalXp, 0);
    await progress.reloadProgress();
    expect(progress.completedLessonIds, isEmpty);
  });
  test(
      '6C: failed reset restores acknowledged progress and never advances epoch; new reset preserves diagnosis',
      () async {
    serverIds.add('one');
    serverScores['one'] = 73;
    serverXp = 50;
    await sync();
    await progress.resetProgress();
    expect(progress.totalXp, 0);
    expect(progress.completedLessonIds, isEmpty);
    expect(
        ProgressSnapshot.read(prefs, auth.localStorageNamespace, 'en').totalXp,
        50);
    fetchFails = true;
    await http.runWithClient(
        progress.syncWithBackend,
        () => MockClient((request) async => request.method == 'DELETE'
            ? http.Response('{}', 403)
            : await transport(request)));
    expect(progress.totalXp, 50);
    expect(progress.completedLessonIds, {'one'});
    expect(await queue.getFailedActions(), hasLength(1));
    expect(prefs.getInt('progress_epoch_${auth.localStorageNamespace}'), 0);
    fetchFails = false;
    await progress.resetProgress();
    await sync();
    expect(await queue.getFailedActions(), hasLength(1));
    expect(prefs.getInt('progress_epoch_${auth.localStorageNamespace}'), 1);
    await progress.completeLesson('two', 80, score: 90, lessonLanguage: 'en');
    await sync();
    expect(serverXp, 80);
    expect(progress.totalXp, 80);
  });
  test(
      '6C: lesson metadata binds English completion and acknowledgement even while German is selected',
      () async {
    await ProgressSnapshot(
            totalXp: 200,
            progressEpoch: 0,
            lessonIds: {'de-owned'},
            lessonScores: {'de-owned': 80})
        .save(prefs, auth.localStorageNamespace, 'de');
    await language.setLanguage('de', syncToBackend: false);
    await progress.completeLesson('one', 50, score: 73, lessonLanguage: 'en');
    expect((await queue.getQueue()).single.payload['targetLanguage'], 'en');
    expect(progress.totalXp, 200);
    await http.runWithClient(
        progress.syncWithBackend,
        () => MockClient((request) async => request.method == 'GET'
            ? http.Response(
                jsonEncode({
                  'progressEpoch': 0,
                  'stats': {'totalXp': 200, 'streak': 0},
                  'completedLessons': [
                    {'lessonId': 'de-owned', 'score': 80}
                  ]
                }),
                200)
            : await transport(request)));
    final owner = auth.localStorageNamespace;
    expect(ProgressSnapshot.read(prefs, owner, 'en').totalXp, 50);
    expect(ProgressSnapshot.read(prefs, owner, 'en').lessonScores['one'], 73);
    expect(ProgressSnapshot.read(prefs, owner, 'de').totalXp, 200);
  });
  test(
      '6C: higher, equal and lower retakes reach max-score backend without duplicated count or XP',
      () async {
    await progress.completeLesson('one', 50, score: 73, lessonLanguage: 'en');
    await sync();
    await progress.completeLesson('one', 50, score: 91, lessonLanguage: 'en');
    expect(progress.totalXp, 50);
    expect(progress.lessonScores['one'], 91);
    expect(progress.completedLessonsCount, 1);
    await sync();
    expect(sent.last['score'], 91);
    expect(serverScores['one'], 91);
    expect(serverXp, 50);
    for (final score in [91, 20]) {
      await progress.completeLesson('one', 50,
          score: score, lessonLanguage: 'en');
      await sync();
      expect(progress.totalXp, 50);
      expect(progress.lessonScores['one'], 91);
      expect(progress.completedLessonsCount, 1);
    }
  });
  test(
      '6C: corrupt cache is unavailable, preserves pending work and reconciles against server',
      () async {
    await prefs.setString(
        ProgressSnapshot.key(auth.localStorageNamespace, 'en'), 'bad JSON');
    await progress.reloadProgress();
    expect(progress.hasAcknowledgedProgress, false);
    await progress.completeLesson('one', 50, score: 73, lessonLanguage: 'en');
    expect(progress.totalXp, 50);
    expect(
        prefs.getString(ProgressSnapshot.key(auth.localStorageNamespace, 'en')),
        'bad JSON');
    serverIds.add('two');
    serverScores['two'] = 80;
    serverXp = 80;
    uploadFails = true;
    await sync();
    expect(progress.hasAcknowledgedProgress, true);
    expect(progress.totalXp, 130);
    expect(progress.completedLessonIds, {'one', 'two'});
    expect(await queue.getQueue(), hasLength(1));
    expect(
        ProgressSnapshot.read(prefs, auth.localStorageNamespace, 'en').totalXp,
        80);
  });
  test(
      '6C: older-epoch queued work is not displayed over a newer acknowledged snapshot',
      () async {
    await progress.completeLesson('one', 50, score: 73, lessonLanguage: 'en');
    await prefs.setInt('progress_epoch_${auth.localStorageNamespace}', 1);
    await ProgressSnapshot(
            totalXp: 80,
            progressEpoch: 1,
            lessonIds: {'two'},
            lessonScores: {'two': 90})
        .save(prefs, auth.localStorageNamespace, 'en');
    await progress.reloadProgress();
    expect(progress.totalXp, 80);
    expect(progress.completedLessonIds, {'two'});
    expect((await queue.getQueue()).single.payload['progressEpoch'], 0);
  });
  test(
      '6C: malformed completion acknowledgement cannot write acknowledged progress or remove pending work',
      () async {
    await progress.completeLesson('one', 50, score: 73, lessonLanguage: 'en');
    await http.runWithClient(
        progress.syncWithBackend,
        () => MockClient((request) async => request.method == 'POST'
            ? http.Response(
                '{"data":{"progressEpoch":0,"newTotalXp":-1,"score":73}}', 201)
            : http.Response('{}', 503)));
    expect(await queue.getQueue(), hasLength(1));
    expect(
        ProgressSnapshot.read(prefs, auth.localStorageNamespace, 'en')
            .available,
        false);
  });
  test(
      '6C: trusted catalog corrects old UI-language metadata without changing operation ID or epoch',
      () async {
    await prefs.setString(
        'lessons_cache_en',
        jsonEncode([
          {'id': 'one', 'targetLanguage': 'en', 'xpReward': 50}
        ]));
    await queue.pushAction(
        'complete-lesson',
        {
          'lessonId': 'one',
          'score': 73,
          'xpReward': 50,
          'targetLanguage': 'de',
          'progressEpoch': 0
        },
        ownerNamespace: auth.localStorageNamespace);
    final id = (await queue.getQueue()).single.id;
    await language.setLanguage('de', syncToBackend: false);
    await progress.reloadProgress();
    expect(progress.totalXp, 0);
    final rebound = (await queue.getQueue()).single;
    expect(rebound.id, id);
    expect(rebound.payload['progressEpoch'], 0);
    expect(rebound.payload['targetLanguage'], 'en');
  });
  test(
      '6C: unverified legacy language cannot appear optimistic; server acknowledgement supplies binding',
      () async {
    await queue.pushAction(
        'complete-lesson',
        {
          'lessonId': 'one',
          'score': 73,
          'xpReward': 50,
          'targetLanguage': 'de',
          'progressEpoch': 0
        },
        ownerNamespace: auth.localStorageNamespace);
    await language.setLanguage('de', syncToBackend: false);
    await progress.reloadProgress();
    expect(progress.completedLessonIds, isEmpty);
    await http.runWithClient(
        progress.syncWithBackend,
        () => MockClient((request) async => request.method == 'GET'
            ? http.Response(
                '{"progressEpoch":0,"stats":{"totalXp":0,"streak":0},"completedLessons":[]}',
                200)
            : await transport(request)));
    expect(
        ProgressSnapshot.read(prefs, auth.localStorageNamespace, 'en').totalXp,
        50);
    expect(
        ProgressSnapshot.read(prefs, auth.localStorageNamespace, 'de').totalXp,
        0);
  });
}
