import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:lingua_ai/screens/coach/ai_coach_screen.dart';
import 'package:lingua_ai/core/localization/language_service.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/services/api_response.dart';
import 'package:lingua_ai/services/auth_api_service.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/ai_coach_api_service.dart';
import 'package:lingua_ai/services/user_api_service.dart';
import 'package:lingua_ai/services/writing_api_service.dart';
import 'package:lingua_ai/services/flashcard_api_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const id = '507f1f77bcf86cd799439011';
  final auth = AuthService();
  const profile = {
    'id': id,
    'email': 'test@example.com',
    'name': 'Test',
    'isGuest': false,
    'targetLanguage': 'de'
  };
  const evaluation = {
    'grammarScore': 85.75,
    'vocabularyScore': 0,
    'clarityScore': 7.25,
    'overallScore': 8.5,
    'feedback': 'Useful feedback',
    'improvedVersion': 'Better text',
    'corrections': <Object>[]
  };
  Future<void> settle() async {
    for (var i = 0; i < 12; i++) {
      await Future<void>.delayed(Duration.zero);
    }
  }

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await auth.init();
    auth.setBackendSession(
        id: id, name: 'Test', email: 'test@example.com', token: 'current');
    await settle();
  });

  test('writing percentages preserve decimals, low values and zero', () {
    final result = WritingFeedback.fromJson(evaluation);
    expect(result.grammarScore, 85.75);
    expect(result.vocabularyScore, 0.0);
    expect(result.clarityScore, 7.25);
    expect(result.overallScore, 8.5);
    expect(result.overallScore, isA<double>());
    expect(WritingFeedback.fromJson({...evaluation, 'overallScore': 80}).overallScore,
        allOf(80.0, isA<double>()));
    expect(result.overallFeedback, 'Useful feedback');
    for (final value in [null, '85', 101, -1, double.nan]) {
      expect(
          () =>
              WritingFeedback.fromJson({...evaluation, 'grammarScore': value}),
          throwsFormatException);
    }
  });

  test(
      'writing service parses the successful HTTP contract without integer assumptions',
      () async {
    await http.runWithClient(() async {
      final result = await WritingApiService()
          .checkWriting(topic: 'Topic', userText: 'Text', targetLanguage: 'de');
      expect(result.grammarScore, 85.75);
      expect(result.overallScore, 8.5);
    },
        () => MockClient(
            (_) async => http.Response(jsonEncode(evaluation), 201)));
  });
  testWidgets(
      'AI current-token 401 clears the session and shows an error without empty chat rollback',
      (tester) async {
    await LanguageService().init();
    await http.runWithClient(() async {
      await tester.pumpWidget(const MaterialApp(home: AiCoachScreen()));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'Hello');
      await tester.tap(find.byIcon(Icons.send_rounded));
      await tester.pumpAndSettle();
      expect(auth.token, isEmpty);
      expect(find.text('Your session has expired. Please sign in again.'),
          findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
        () => MockClient((request) async => http.Response(
            request.method == 'GET' ? '[]' : '{"message":"Unauthorized"}',
            request.method == 'GET' ? 200 : 401)));
  });

  test('auth and profile parse required public identity including isGuest',
      () async {
    await http.runWithClient(() async {
      final api = AuthApiService();
      expect(
          (await api.login('test@example.com', 'password'))['user'], profile);
      expect(
          (await api.register('Test', 'test@example.com', 'password'))['user'],
          profile);
      expect((await api.loginGuest())['user']['isGuest'], true);
      expect(await UserApiService().fetchMe(), profile);
      expect(await UserApiService().updateProfile(name: 'Test'), profile);
    },
        () => MockClient((request) async => http.Response(
            jsonEncode(request.url.path.startsWith('/auth/')
                ? {
                    'user': {
                      ...profile,
                      if (request.url.path.endsWith('/guest')) 'isGuest': true,
                    },
                    'access_token': 'valid'
                  }
                : profile),
            200)));
    expect(() => parsePublicUser({...profile, 'isGuest': null}),
        throwsFormatException);
  });

  for (final entry in {
    400: ApiFailure.client,
    403: ApiFailure.client,
    401: ApiFailure.unauthorized,
    500: ApiFailure.server,
    503: ApiFailure.server
  }.entries) {
    test('AI and profile HTTP ${entry.key} retain their error classification',
        () async {
      final expected = isA<ApiException>()
          .having((e) => e.kind, 'kind', entry.value)
          .having((e) => e.statusCode, 'status', entry.key);
      await http.runWithClient(() async {
        await expectLater(
            AiCoachApiService().checkWriting(
                topic: 'Topic',
                text: 'Text',
                language: 'en',
                targetLanguage: 'de'),
            throwsA(expected));
        await expectLater(
            UserApiService().updateProfile(name: 'Test'), throwsA(expected));
      },
          () => MockClient((_) async => http.Response(
              jsonEncode({
                'message': entry.key >= 500
                    ? 'Writing evaluation is temporarily unavailable. Please try again.'
                    : ['Invalid input']
              }),
              entry.key)));
    });
  }
  test('validation message is retained and internal server detail is hidden',
      () async {
    await http.runWithClient(() async {
      await expectLater(
          UserApiService().updateProfile(name: ''),
          throwsA(isA<ApiException>()
              .having((e) => e.message, 'message', 'name must not be empty')));
    },
        () => MockClient((_) async =>
            http.Response('{"message":["name must not be empty"]}', 400)));
    await http.runWithClient(() async {
      await expectLater(
          AiCoachApiService().sendMessage(message: 'Hi', language: 'en'),
          throwsA(isA<ApiException>().having(
              (e) => e.toString(), 'safe message', isNot(contains('secret')))));
    },
        () => MockClient(
            (_) async => http.Response('{"message":"secret stack"}', 500)));
  });
  test('unreachable backend remains a network failure', () async {
    await http.runWithClient(() async {
      await expectLater(
          AiCoachApiService().sendMessage(message: 'Hi', language: 'en'),
          throwsA(isA<ApiException>()
              .having((e) => e.kind, 'kind', ApiFailure.network)));
      await expectLater(UserApiService().fetchMe(),
          throwsA(isA<ApiException>().having((e) => e.kind, 'kind', ApiFailure.network)));
      await expectLater(WritingApiService().checkWriting(topic: 'Topic', userText: 'Text', targetLanguage: 'en'),
          throwsA(isA<ApiException>().having((e) => e.kind, 'kind', ApiFailure.network)));
    },
        () => MockClient((_) async =>
            throw http.ClientException('private transport detail')));
  });
  test('restored current-token 401 signs out while owner data stays stored',
      () async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
        'linguaai_offline_queue_registered_$id', 'owner-data');
    await http.runWithClient(() async {
      await auth.init();
      await settle();
    },
        () => MockClient(
            (_) async => http.Response('{"message":"Unauthorized"}', 401)));
    expect(auth.isLoggedIn, false);
    expect(auth.token, isEmpty);
    expect(
        prefs.getString('linguaai_offline_queue_registered_$id'), 'owner-data');
  });
  test(
      'stale 401 cannot invalidate a replacement session even for the same owner',
      () async {
    final started = Completer<void>(), response = Completer<http.Response>();
    await http.runWithClient(() async {
      final pending = UserApiService().fetchMe();
      final assertion = expectLater(pending, throwsA(isA<ApiException>()));
      await started.future;
      auth.setBackendSession(
          id: id,
          name: 'Test',
          email: 'test@example.com',
          token: 'replacement');
      response.complete(http.Response('{"message":"Unauthorized"}', 401));
      await assertion;
      await settle();
      expect(auth.token, 'replacement');
      expect(auth.isLoggedIn, true);
    },
        () => MockClient((_) {
              started.complete();
              return response.future;
            }));
  });
  test(
      'backend guest 401 invalidates authentication but local_guest stays intact',
      () async {
    await auth.setGuestSession(
        id: id, email: 'guest-test@guest.lingua.local', token: 'guest-token');
    await http.runWithClient(() async {
      await expectLater(
          UserApiService().fetchMe(), throwsA(isA<ApiException>()));
    }, () => MockClient((_) async => http.Response('{}', 401)));
    expect(auth.token, isEmpty);
    expect(auth.isGuest, false);
    await auth.loginAsGuest();
    final revision = auth.sessionVersion;
    await http.runWithClient(() async {
      await expectLater(
          UserApiService().fetchMe(), throwsA(isA<ApiException>()));
    }, () => MockClient((_) async => http.Response('{}', 401)));
    expect(auth.isGuest, true);
    expect(auth.localStorageNamespace, 'local_guest');
    expect(auth.sessionVersion, revision);
  });
  test(
      'ID-only create/update/review receipts are acknowledgements, never fake cards',
      () async {
    await http.runWithClient(() async {
      final api = FlashcardApiService();
      final results = [
        await api.createFlashcard('word', 'translation', 'de'),
        await api.updateFlashcard('card', 'word', 'translation'),
        await api.reviewCard('card', 4)
      ];
      for (final result in results) {
        expect(result.id, 'card');
        expect(result.card, isNull);
      }
      await api.deleteFlashcard('card');
    }, () => MockClient((_) async => http.Response('{"_id":"card"}', 200)));
    final complete = FlashcardMutationResult.fromJson({
      '_id': 'card',
      'targetWord': 'Wort',
      'turkishTranslation': 'kelime',
      'targetLanguage': 'de'
    });
    expect(complete.card!.targetWord, 'Wort');
  });
}
