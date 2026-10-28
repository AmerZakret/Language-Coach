import 'package:lingua_ai/services/data_timeline.dart';
import 'package:lingua_ai/services/online_intent_service.dart';
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
    await auth.setBackendSession(
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

  Future<void> changeTimeline() async {
    await DataTimeline().discover(fetch: () async => http.Response(jsonEncode({
      'dataTimelineId': '22222222-2222-4222-8222-222222222222',
      'currentProtocolRevision': 2, 'minimumMutationRevision': 1,
      'timelineAwareProtocolRevision': 2, 'timelineWriteState': 'OPEN',
    }), 200));
  }

  setUpAll(() async {
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();
    await auth.init();
    await LanguageService().init();
    await languages.init();
    await ProgressService().init();
  });
  setUp(() async {
    OnlineIntentService.clock = () => DateTime.now().millisecondsSinceEpoch;
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
    'language ABA',
    'timeline'
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
        } else if (boundary == 'timeline') {
          await changeTimeline();
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
  testWidgets('AI replay acknowledgement does not duplicate an already loaded durable pair', (tester) async {
    final pair = [
      {'_id': 'user-message', 'role': 'user', 'message': 'hello'},
      {'_id': 'assistant-message', 'role': 'assistant', 'message': 'reply'},
    ];
    await http.runWithClient(() async {
      await login(a);
      await tester.pumpWidget(const MaterialApp(home: AiCoachScreen()));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'hello');
      await tester.tap(find.byIcon(Icons.send_rounded));
      await tester.pumpAndSettle();
      expect(find.text('hello'), findsOneWidget);
      expect(find.text('reply'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    }, () => MockClient((request) async {
      if (request.url.path.endsWith('/history')) {
        return http.Response(jsonEncode(pair), 200);
      }
      if (request.url.path.endsWith('/chat')) {
        return http.Response(jsonEncode({
          'userMessage': pair[0], 'assistantMessage': pair[1], 'reply': 'reply',
        }), 201);
      }
      return progress();
    }));
  });

  testWidgets('9D AI language ABA recovers the original uncertain intent before a fresh intentional send', (tester) async {
    final keys = <String>[];
    await http.runWithClient(() async {
      await login(a);
      await tester.pumpWidget(const MaterialApp(home: AiCoachScreen()));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'hello');
      await tester.tap(find.byIcon(Icons.send_rounded));
      await tester.pumpAndSettle();
      expect(keys, hasLength(2));
      ScaffoldMessenger.of(tester.element(find.byType(TextField))).hideCurrentSnackBar();
      await tester.pumpAndSettle();
      OnlineIntentService.clock = () => DateTime.now().millisecondsSinceEpoch + 300001;
      await languages.setLanguage('de', syncToBackend: false);
      await languages.setLanguage('en', syncToBackend: false);
      await tester.pumpAndSettle();
      expect(keys, hasLength(3));
      expect(keys.toSet(), hasLength(1));
      await tester.enterText(find.byType(TextField), 'hello');
      await tester.tap(find.byIcon(Icons.send_rounded));
      await tester.pumpAndSettle();
      expect(keys, hasLength(4));
      expect(keys[0], keys[2]); expect(keys[3], isNot(keys[0]));
      OnlineIntentService.clock = () => DateTime.now().millisecondsSinceEpoch;
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    }, () => MockClient((request) async {
      if (request.url.path.endsWith('/history')) {
        return http.Response('[]', 200);
      }
      if (request.url.path.endsWith('/chat')) {
        keys.add(request.headers['X-Idempotency-Key']!);
        return http.Response('{"reply":"reply"}', keys.length <= 2 ? 503 : 201);
      }
      return progress();
    }));
  });

  for (final operation in ['send', 'clear']) {
    for (final boundary in ['language', 'account', 'language ABA', 'timeline']) {
      testWidgets('AI $operation ignores late completion after $boundary', (tester) async {
        final pending = Completer<http.Response>();
        await http.runWithClient(() async {
          await login(a);
          await tester.pumpWidget(const MaterialApp(home: AiCoachScreen())); await tester.pumpAndSettle();
          if (operation == 'send') {
            await tester.enterText(find.byType(TextField), 'old question');
            await tester.tap(find.byIcon(Icons.send_rounded)); await tester.pump();
          } else {
            await tester.tap(find.byIcon(Icons.delete_sweep_rounded)); await tester.pumpAndSettle();
            await tester.tap(find.text(LanguageService().getString('delete')).last); await tester.pump();
          }
          if (boundary == 'account') { await login(b); }
          else if (boundary == 'timeline') { await changeTimeline(); }
          else {
            await languages.setLanguage('de', syncToBackend: false);
            if (boundary == 'language ABA') { await languages.setLanguage('en', syncToBackend: false); }
          }
          await tester.pumpAndSettle(); expect(find.text('current history'), findsOneWidget);
          pending.complete(http.Response(operation == 'send' ? '{"reply":"stale reply"}' : '{}', 200));
          await tester.pumpAndSettle();
          expect(find.text('stale reply'), findsNothing); expect(find.text('current history'), findsOneWidget);
          expect(find.byType(CircularProgressIndicator), findsNothing);
          expect(tester.takeException(), isNull); await tester.pumpWidget(const SizedBox.shrink());
        }, () => MockClient((request) async {
          if (request.url.path.endsWith('/chat') || request.url.path.endsWith('/clear')) { return pending.future; }
          return request.url.path.endsWith('/history') ? history('current history') : progress();
        }));
      });
    }
  }

  testWidgets('10D clear confirmation opened on A cannot authorize a B deletion', (tester) async {
    var clears = 0;
    await http.runWithClient(() async {
      await login(a);
      await tester.pumpWidget(const MaterialApp(home: AiCoachScreen()));
      await tester.pumpAndSettle();
      await tester.tap(find.byIcon(Icons.delete_sweep_rounded));
      await tester.pumpAndSettle();
      await changeTimeline();
      await tester.pumpAndSettle();
      await tester.tap(find.text(LanguageService().getString('delete')).last);
      await tester.pumpAndSettle();
      expect(clears, 0);
      // The fresh B action requires its own dialog confirmation and new intent.
      await tester.tap(find.byIcon(Icons.delete_sweep_rounded));
      await tester.pumpAndSettle();
      expect(clears, 0);
      await tester.tap(find.text(LanguageService().getString('delete')).last);
      await tester.pumpAndSettle();
      expect(clears, 1);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    }, () => MockClient((request) async {
      if (request.url.path.endsWith('/clear')) {
        clears++;
        expect(request.headers['X-Data-Timeline'], '22222222-2222-4222-8222-222222222222');
        return http.Response('{"success":true}', 200);
      }
      return request.url.path.endsWith('/history') ? history('current history') : progress();
    }));
  });

}
