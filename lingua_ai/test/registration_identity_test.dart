import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/core/localization/language_service.dart';
import 'package:lingua_ai/screens/auth/register_screen.dart';
import 'package:lingua_ai/services/auth_api_service.dart';
import 'package:lingua_ai/services/auth_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const id = '507f1f77bcf86cd799439011';
  const validUser = {'id': id, 'name': 'Test', 'email': 'test@example.com', 'isGuest': false, 'targetLanguage': 'en'};
  final invalidResponses = <String, Object?>{
    'missing token': {'user': validUser},
    'empty token': {'user': validUser, 'access_token': ''},
    'whitespace token': {'user': validUser, 'access_token': '  '},
    'non-string token': {'user': validUser, 'access_token': 123},
    'missing user': {'access_token': 'test-token'},
    'missing ID': {'user': {'name': 'Test'}, 'access_token': 'test-token'},
    'empty ID': {'user': {'id': ''}, 'access_token': 'test-token'},
    'literal guest ID': {'user': {'id': 'guest'}, 'access_token': 'test-token'},
    'email ID': {'user': {'id': 'test@example.com'}, 'access_token': 'test-token'},
    'non-string ID': {'user': {'id': 123}, 'access_token': 'test-token'},
    'invalid wrapper': [],
    'null response': null,
  };

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await AuthService().init();
    await LanguageService().init();
  });

  for (final entry in invalidResponses.entries) {
    test('registration rejects ${entry.key} before any session can be installed', () async {
      final auth = AuthService();
      final revision = auth.sessionVersion;
      await http.runWithClient(() async {
        await expectLater(AuthApiService().register('Test', 'test@example.com', 'test-password'),
            throwsA(isA<FormatException>().having((error) => error.message,
                'message', contains('incomplete authentication session'))));
      }, () => MockClient((_) async => http.Response(jsonEncode(entry.value), 201)));
      expect(auth.isLoggedIn, false);
      expect(auth.currentUserId, isEmpty);
      expect(auth.token, isEmpty);
      expect(auth.sessionVersion, revision);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('token'), isNull);
      expect(prefs.getString('currentUserId'), isNull);
    });
  }

  test('valid registration identity and token are returned unchanged', () async {
    final response = {'user': validUser, 'access_token': 'test-token'};
    await http.runWithClient(() async {
      expect(await AuthApiService().register('Test', 'test@example.com', 'test-password'), response);
    }, () => MockClient((_) async => http.Response(jsonEncode(response), 201)));
  });

  for (final entry in invalidResponses.entries.take(6)) {
    testWidgets('registration screen visibly rejects ${entry.key} without logging in', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: RegisterScreen()));
      final fields = find.byType(TextField);
      await tester.enterText(fields.at(0), 'Test');
      await tester.enterText(fields.at(1), 'test@example.com');
      await tester.enterText(fields.at(2), 'test-password');
      await tester.enterText(fields.at(3), 'test-password');
      final button = find.text(LanguageService().getString('register'));
      await tester.ensureVisible(button);
      await http.runWithClient(() async {
        await tester.tap(button);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
      }, () => MockClient((_) async => http.Response(jsonEncode(entry.value), 201)));
      expect(find.textContaining('incomplete authentication session'), findsOneWidget);
      expect(find.byType(RegisterScreen), findsOneWidget);
      expect(AuthService().isLoggedIn, false);
      expect(AuthService().token, isEmpty);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('token'), isNull);
      expect(prefs.getString('currentUserId'), isNull);
    });
  }
}
