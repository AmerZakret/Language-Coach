import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/core/localization/language_service.dart';
import 'package:lingua_ai/core/localization/target_language_service.dart';
import 'package:lingua_ai/screens/coach/ai_coach_screen.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/progress_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const a = '507f1f77bcf86cd799439011';
  const b = '507f1f77bcf86cd799439012';
  final auth = AuthService();
  final languages = TargetLanguageService();
  late SharedPreferences prefs;
  Future<void> settle() async {
    for (var i = 0; i < 12; i++) {
      await Future<void>.value();
    }
  }

  Future<void> login(String id, {String? token}) async {
    auth.setBackendSession(
        id: id, name: id, email: '$id@example.com', token: token ?? 'test-$id');
    await settle();
  }

  http.Response history(String message) => http.Response(
      jsonEncode([
        {'role': 'assistant', 'message': message}
      ]),
      200);
  http.Response progress() => http.Response(
      '{"stats":{"totalXp":0,"streak":0},"completedLessons":[]}', 200);

  setUpAll(() async {
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();
    await auth.init();
    await LanguageService().init();
    await languages.init();
    await ProgressService().init();
  });
  setUp(() async {
    auth.logout();
    await settle();
    await prefs.clear();
    await languages.init();
    await settle();
  });

  for (final boundary in [
    'language',
    'account',
    'token refresh',
    'language ABA'
  ]) {
    testWidgets('AI history ignores late results after $boundary switch',
        (tester) async {
      final old = Completer<http.Response>();
      final current = Completer<http.Response>();
      final requests = <http.Request>[];
      await http.runWithClient(() async {
        await login(a);
        await tester.pumpWidget(const MaterialApp(home: AiCoachScreen()));
        await tester.pump();
        expect(requests, hasLength(1));
        if (boundary == 'language' || boundary == 'language ABA') {
          await languages.setLanguage('de', syncToBackend: false);
          if (boundary == 'language ABA') {
            await languages.setLanguage('en', syncToBackend: false);
          }
        } else {
          await login(boundary == 'account' ? b : a,
              token: 'replacement-token');
        }
        await tester.pump();
        expect(requests.length, greaterThan(1));
        current.complete(history('current history'));
        await tester.pumpAndSettle();
        expect(find.text('current history'), findsOneWidget);
        final stored = {for (final key in prefs.getKeys()) key: prefs.get(key)};
        old.complete(history('stale history'));
        await tester.pumpAndSettle();
        expect(find.text('stale history'), findsNothing);
        expect(find.text('current history'), findsOneWidget);
        expect(
            {for (final key in prefs.getKeys()) key: prefs.get(key)}, stored);
        expect(requests.first.url.queryParameters['targetLanguage'], 'en');
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
          () => MockClient((request) {
                if (!request.url.path.endsWith('/history')) {
                  return Future.value(progress());
                }
                requests.add(request);
                return requests.length == 1 ? old.future : current.future;
              }));
    });
  }

  testWidgets('AI same-language history applies normally', (tester) async {
    await http.runWithClient(() async {
      await login(a);
      await tester.pumpWidget(const MaterialApp(home: AiCoachScreen()));
      await tester.pumpAndSettle();
      expect(find.text('same-language history'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
        () => MockClient((request) async =>
            request.url.path.endsWith('/history')
                ? history('same-language history')
                : progress()));
  });

  testWidgets('AI stale history failure leaves new-language loading active',
      (tester) async {
    final old = Completer<http.Response>(),
        current = Completer<http.Response>();
    await http.runWithClient(() async {
      await login(a);
      await tester.pumpWidget(const MaterialApp(home: AiCoachScreen()));
      await tester.pump();
      await languages.setLanguage('de', syncToBackend: false);
      await tester.pump();
      old.complete(http.Response('{}', 503));
      await tester.pump();
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      current.complete(history('German history'));
      await tester.pumpAndSettle();
      expect(find.text('German history'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
        () => MockClient((request) => !request.url.path.endsWith('/history')
            ? Future.value(progress())
            : request.url.queryParameters['targetLanguage'] == 'en'
                ? old.future
                : current.future));
  });

  testWidgets('AI history response after unmount does not write state',
      (tester) async {
    final pending = Completer<http.Response>();
    await http.runWithClient(() async {
      await login(a);
      await tester.pumpWidget(const MaterialApp(home: AiCoachScreen()));
      await tester.pump();
      await tester.pumpWidget(const SizedBox.shrink());
      pending.complete(history('late history'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    },
        () => MockClient((request) => request.url.path.endsWith('/history')
            ? pending.future
            : Future.value(progress())));
  });
}
