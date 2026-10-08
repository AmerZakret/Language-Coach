import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/progress_service.dart';
import 'package:lingua_ai/services/flashcard_service.dart';
import 'package:lingua_ai/models/flashcard.dart';
import 'package:lingua_ai/core/localization/target_language_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const a = '507f1f77bcf86cd799439011';
  const b = '507f1f77bcf86cd799439012';
  final auth = AuthService();
  final progress = ProgressService();
  final cards = FlashcardService();
  final language = TargetLanguageService();
  late SharedPreferences prefs;
  Future<void> settle() async {
    for (var i = 0; i < 8; i++) {
      await Future<void>.delayed(Duration.zero);
    }
  }

  Future<void> login(String id) async {
    auth.setBackendSession(
        name: id == a ? 'A' : 'B',
        email: '$id@example.com',
        token: 'test-$id',
        id: id);
    await settle();
  }

  Map<String, dynamic> card(String id, [String word = 'current']) => {
        '_id': 'shared-card',
        'userId': id,
        'targetWord': '$word-$id',
        'turkishTranslation': 'translation',
        'targetLanguage': 'English',
      };
  http.Response normal(http.Request request) {
    final id = request.headers['Authorization'] == 'Bearer test-$a' ? a : b;
    final path = request.url.path;
    Object body = {};
    if (path.endsWith('/users/me')) {
      body = {'id': id, 'name': 'refreshed', 'email': '$id@example.com', 'isGuest': false, 'targetLanguage': 'en'};
    } else if (path.endsWith('/all')) {
      body = [card(id)];
    } else if (path.contains('/flashcards') && request.method != 'DELETE') {
      body = card(id);
    } else if (path.contains('/progress/') && request.method == 'GET') {
      body = {
        'progressEpoch': 0,
        'stats': {'totalXp': id == a ? 10 : 20, 'streak': 2},
        'completedLessons': [
          {'lessonId': 'current-$id'}
        ]
      };
    }
    return http.Response(jsonEncode(body), 200);
  }

  setUpAll(() async {
    SharedPreferences.setMockInitialValues({});
    await auth.init();
    await language.init();
    await progress.init();
    await cards.init();
    prefs = await SharedPreferences.getInstance();
  });
  setUp(() async {
    await prefs.clear();
    await auth.loginAsGuest();
    await language.setLanguage('en', syncToBackend: false);
    await settle();
  });

  Future<void> race(
      {required bool Function(http.Request) match,
      required Future<void> Function() operation,
      required Object response,
      bool failure = false,
      bool languageSwitch = false}) async {
    final started = Completer<void>();
    final release = Completer<http.Response>();
    final requests = <http.Request>[];
    var armed = false;
    await http.runWithClient(() async {
      await login(a);
      armed = true;
      final pending = operation();
      await started.future;
      if (languageSwitch) {
        await language.setLanguage('de', syncToBackend: false);
        await settle();
      } else {
        auth.logout();
        await login(b);
      }
      final owner = auth.localStorageNamespace;
      final lang = language.currentLanguage;
      final xpKey = 'progress_${owner}_${lang}_totalXp';
      final cardKey = 'flashcards_${owner}_${lang}_list';
      final savedXp = prefs.get(xpKey);
      final savedCards = prefs.get(cardKey);
      final xp = progress.totalXp;
      final words = cards.allCards.map((c) => c.targetWord).toList();
      var notifications = 0;
      void listener() {
        notifications++;
      }

      progress.addListener(listener);
      cards.addListener(listener);
      language.addListener(listener);
      final beforeRequests = requests.length;
      release
          .complete(http.Response(jsonEncode(response), failure ? 500 : 200));
      await pending;
      await settle();
      expect(auth.currentUserId, languageSwitch ? a : b);
      expect(progress.totalXp, xp);
      expect(cards.allCards.map((c) => c.targetWord).toList(), words);
      expect(prefs.get(xpKey), savedXp);
      expect(prefs.get(cardKey), savedCards);
      expect(notifications, 0);
      expect(requests.length, beforeRequests,
          reason: 'No stale follow-up requests');
      progress.removeListener(listener);
      cards.removeListener(listener);
      language.removeListener(listener);
    },
        () => MockClient((request) async {
              requests.add(request);
              if (armed &&
                  request.headers['Authorization'] == 'Bearer test-$a' &&
                  match(request)) {
                if (!started.isCompleted) started.complete();
                return release.future;
              }
              return normal(request);
            }));
  }

  test('stale profile response cannot overwrite B identity or persisted auth',
      () async {
    final started = Completer<void>();
    final release = Completer<http.Response>();
    await http.runWithClient(() async {
      await login(a);
      final pending = auth.fetchLatestProfile();
      await started.future;
      auth.logout();
      await login(b);
      final version = auth.sessionVersion;
      release.complete(http.Response(
          jsonEncode({'id': a, 'name': 'stale A', 'email': 'a@example.com', 'isGuest': false, 'targetLanguage': 'en'}),
          200));
      await pending;
      expect(auth.currentUserId, b);
      expect(auth.currentUserName, 'B');
      expect(auth.token, 'test-$b');
      expect(auth.isLoggedIn, true);
      expect(auth.isGuest, false);
      expect(prefs.getString('currentUserId'), b);
      expect(prefs.getString('token'), 'test-$b');
      await auth.fetchLatestProfile();
      expect(auth.currentUserName, 'refreshed');
      expect(auth.sessionVersion, version,
          reason: 'Profile refresh preserves generation');
    },
        () => MockClient((request) async {
              if (request.url.path.endsWith('/users/me') &&
                  request.headers['Authorization'] == 'Bearer test-$a') {
                started.complete();
                return release.future;
              }
              return normal(request);
            }));
  });
  test(
      'stale progress fetch cannot replace B progress/cache or upload A completions',
      () => race(
            match: (r) =>
                r.method == 'GET' && r.url.path.contains('/progress/'),
            operation: progress.syncWithBackend,
            response: {
              'stats': {'totalXp': 999},
              'completedLessons': []
            },
          ));
  for (final failure in [false, true]) {
    test(
        'stale lesson completion blocks refetch and local fallback (failure: $failure)',
        () => race(
              match: (r) => r.url.path.endsWith('/complete-lesson'),
              operation: () => progress.completeLesson('new-lesson', 999),
              response: {},
              failure: failure,
            ));
  }
  test(
      'stale card fetch cannot replace B cards/cache',
      () => race(
            match: (r) => r.url.path.endsWith('/flashcards/all'),
            operation: cards.syncWithBackend,
            response: [card(a, 'stale')],
          ));
  final operations = <String, Future<void> Function()>{
    'create': () => cards.createFlashcard('new', 'translation'),
    'update': () => cards.updateFlashcard('shared-card', 'new', 'translation'),
    'delete': () => cards.deleteFlashcard('shared-card'),
    'review': () => cards.reviewCard(Flashcard.fromJson(card(a)), 4),
  };
  for (final entry in operations.entries) {
    test(
        'stale ${entry.key} card response leaves B cards/cache unchanged',
        () => race(
              match: (r) =>
                  r.url.path.contains('/flashcards') &&
                  !r.url.path.endsWith('/all'),
              operation: entry.value,
              response: card(a, 'stale'),
            ));
  }
  test(
      'stale failed card mutation does not create a B local fallback',
      () => race(
            match: (r) =>
                r.method == 'POST' && r.url.path.endsWith('/flashcards'),
            operation: operations['create']!,
            response: {},
            failure: true,
          ));
  test(
      'old-language progress response is discarded',
      () => race(
            match: (r) =>
                r.method == 'GET' &&
                r.url.path.contains('/progress/') &&
                r.url.queryParameters['targetLanguage'] == 'en',
            operation: progress.syncWithBackend,
            response: {
              'stats': {'totalXp': 999},
              'completedLessons': []
            },
            languageSwitch: true,
          ));
  test(
      'target-language update cannot trigger B reload after A response',
      () => race(
            match: (r) => r.url.path.endsWith('/users/profile'),
            operation: () => language.setLanguage('en'),
            response: {'id': a, 'name': 'A', 'email': 'a@example.com', 'isGuest': false, 'targetLanguage': 'en'},
          ));
  test('pending restoration cannot replace a newly established B session',
      () async {
    await http.runWithClient(() async {
      final restoring = auth.init();
      await login(b);
      await restoring;
      expect(auth.currentUserId, b);
      expect(auth.token, 'test-$b');
      expect(prefs.getString('currentUserId'), b);
    }, () => MockClient((request) async => normal(request)));
  });
  test(
      'interrupted guest persistence cannot mix guest A fields with B credentials',
      () async {
    await http.runWithClient(() async {
      final savingA = auth.setGuestSession(
          id: a, email: 'guest-a@guest.lingua.local', token: 'test-$a');
      await login(b);
      await savingA;
      expect(auth.currentUserId, b);
      expect(prefs.getString('currentUserId'), b);
      expect(prefs.getString('currentUserEmail'), '$b@example.com');
      expect(prefs.getString('token'), 'test-$b');
      expect(prefs.getBool('isGuest'), false);
    }, () => MockClient((request) async => normal(request)));
  });
  test(
      'old-language card fetch cannot overwrite the new language cache',
      () => race(
            match: (r) =>
                r.url.path.endsWith('/flashcards/all') &&
                r.url.query.contains('targetLanguage=en'),
            operation: cards.syncWithBackend,
            response: [card(a, 'stale')],
            languageSwitch: true,
          ));
  test(
      'older target-language update cannot trigger reload after newer language choice',
      () => race(
            match: (r) => r.url.path.endsWith('/users/profile'),
            operation: () => language.setLanguage('en'),
            response: {'id': a, 'name': 'A', 'email': 'a@example.com', 'isGuest': false, 'targetLanguage': 'en'},
            languageSwitch: true,
          ));
  test('current session progress and card requests still apply normally',
      () async {
    await http.runWithClient(() async {
      await login(b);
      await progress.syncWithBackend();
      expect(progress.totalXp, 20);
      await cards.createFlashcard('new', 'translation');
      expect(cards.allCards, hasLength(2));
      expect(prefs.getString('flashcards_registered_${b}_en_list'),
          contains('current-$b'));
    }, () => MockClient((request) async => normal(request)));
  });
}
