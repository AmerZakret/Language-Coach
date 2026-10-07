import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/services/api_response.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/community_service.dart';
import 'package:lingua_ai/services/flashcard_api_service.dart';
import 'package:lingua_ai/services/progress_api_service.dart';
import 'package:lingua_ai/services/pronunciation_service.dart';
import 'package:lingua_ai/services/sync_retry_policy.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const a = '507f1f77bcf86cd799439011';
  const b = '507f1f77bcf86cd799439012';
  final auth = AuthService();
  final progress = ProgressApiService();
  final cards = FlashcardApiService();
  final community = CommunityService();
  late Directory temporary;
  late String audioPath;
  late SharedPreferences prefs;
  Future<void> settle() async {
    for (var i = 0; i < 12; i++) {
      await Future<void>.delayed(Duration.zero);
    }
  }

  Future<void> login(String id, {String? token}) async {
    auth.setBackendSession(
        id: id, name: id, email: '$id@example.com', token: token ?? 'test-$id');
    await settle();
  }

  setUpAll(() async {
    temporary = await Directory.systemTemp.createTemp('direct-session-test-');
    audioPath = '${temporary.path}/audio.wav';
    await File(audioPath).writeAsBytes([1, 2, 3]);
  });
  tearDownAll(() => temporary.delete(recursive: true));
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await auth.init();
    prefs = await SharedPreferences.getInstance();
    await login(a);
  });

  final requests = <String, Future<Object?> Function()>{
    'progress fetch': () => progress.getProgress(a, 'en'),
    'progress complete': () =>
        progress.completeLesson(a, 'lesson', 80, progressEpoch: 0),
    'progress reset': () => progress.resetProgress(a,
        expectedEpoch: 0, operationId: 'session-reset'),
    'flashcard create': () =>
        cards.createFlashcard('word', 'translation', 'en'),
    'flashcard update': () =>
        cards.updateFlashcard('card', 'word', 'translation'),
    'flashcard delete': () => cards.deleteFlashcard('card'),
    'flashcard due': () => cards.getDueCards(),
    'flashcard all': () => cards.getAllCards(),
    'flashcard review': () => cards.reviewCard('card', 4),
    'pronunciation assess': () => PronunciationService().assessPronunciation(
        audioPath: audioPath, targetText: 'Hello', targetLanguage: 'en'),
    'community fetch': () => community.fetchPosts(),
    'community create': () =>
        community.createPost(learningLanguage: 'en', text: 'Hello'),
    'community update': () =>
        community.updatePost(postId: 'post', text: 'Hello'),
    'community delete': () => community.deletePost(postId: 'post'),
    'community like': () => community.toggleLike(postId: 'post'),
  };
  final unauthorized = isA<ApiException>()
      .having((e) => e.kind, 'kind', ApiFailure.unauthorized)
      .having((e) => e.statusCode, 'status', 401);

  for (final entry in requests.entries) {
    test('${entry.key}: current 401 invalidates auth and preserves owner work',
        () async {
      final ownerData = {
        'linguaai_offline_queue_registered_$a': jsonEncode({
          'actions': [
            {
              'operationId': 'pending',
              'type': 'complete-lesson',
              'ownerNamespace': 'registered_$a'
            }
          ]
        }),
        'flashcards_registered_${a}_en_list': '["cached card"]',
        'progress_registered_${a}_en_totalXp': '120',
        'linguaai_offline_queue_registered_$b': 'other owner pending work',
        'community_posts_All': '{"items":[]}',
      };
      for (final data in ownerData.entries) {
        await prefs.setString(data.key, data.value);
      }
      final revision = auth.sessionVersion;
      await http.runWithClient(() async {
        await expectLater(entry.value(), throwsA(unauthorized));
      },
          () => MockClient((request) async {
                expect(request.headers['Authorization'], 'Bearer test-$a');
                return http.Response('{"message":"Unauthorized"}', 401);
              }));
      await settle();
      expect(auth.isLoggedIn, false);
      expect(auth.token, isEmpty);
      expect(auth.sessionVersion, revision + 1);
      expect(prefs.getString('token'), isNull);
      for (final data in ownerData.entries) {
        expect(prefs.getString(data.key), data.value);
      }
    });

    test('${entry.key}: stale 401 preserves the newer account', () async {
      final started = Completer<void>();
      final response = Completer<http.Response>();
      await http.runWithClient(() async {
        final assertion = expectLater(entry.value(), throwsA(unauthorized));
        await started.future;
        await login(b);
        final revision = auth.sessionVersion;
        response.complete(http.Response('{}', 401));
        await assertion;
        await settle();
        expect(auth.currentUserId, b);
        expect(auth.token, 'test-$b');
        expect(auth.isLoggedIn, true);
        expect(auth.sessionVersion, revision);
      },
          () => MockClient((request) {
                expect(request.headers['Authorization'], 'Bearer test-$a');
                started.complete();
                return response.future;
              }));
    });

    test('${entry.key}: local_guest 401 does not change the local session',
        () async {
      await auth.loginAsGuest();
      final revision = auth.sessionVersion;
      await prefs.setString(
          'linguaai_offline_queue_local_guest', 'local pending work');
      await http.runWithClient(() async {
        await expectLater(entry.value(), throwsA(unauthorized));
      },
          () => MockClient((request) async {
                expect(request.headers.containsKey('Authorization'), false);
                return http.Response('{}', 401);
              }));
      expect(auth.isGuest, true);
      expect(auth.localStorageNamespace, 'local_guest');
      expect(auth.token, isEmpty);
      expect(auth.sessionVersion, revision);
      expect(prefs.getString('linguaai_offline_queue_local_guest'),
          'local pending work');
    });
  }

  for (final name in [
    'progress fetch',
    'flashcard all',
    'pronunciation assess',
    'community like'
  ]) {
    test(
        '$name: validation, server and transport errors retain their classification',
        () async {
      for (final status in [400, 503]) {
        await http.runWithClient(() async {
          await expectLater(
              requests[name]!(),
              throwsA(isA<ApiException>()
                  .having((e) => e.kind, 'kind',
                      status == 400 ? ApiFailure.client : ApiFailure.server)
                  .having(
                      (e) => SyncFailure.classify(e).category,
                      'retry category',
                      status == 400 ? 'validation' : 'backend')));
        },
            () => MockClient((_) async =>
                http.Response('{"message":"Invalid input"}', status)));
      }
      await http.runWithClient(() async {
        await expectLater(
            requests[name]!(),
            throwsA(isA<ApiException>()
                .having((e) => e.kind, 'kind', ApiFailure.network)));
      },
          () => MockClient(
              (_) async => throw http.ClientException('transport failure')));
      expect(auth.isLoggedIn, true);
    });
  }
}
