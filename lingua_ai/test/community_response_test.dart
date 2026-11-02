import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/core/localization/language_service.dart';
import 'package:lingua_ai/core/localization/target_language_service.dart';
import 'package:lingua_ai/screens/community/community_screen.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/community_feed_cache.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const a = '507f1f77bcf86cd799439011', b = '507f1f77bcf86cd799439012';
  final auth = AuthService();
  late SharedPreferences prefs;
  Future<void> login(String id) async {
    await auth.setBackendSession(
        id: id, name: id, email: '$id@example.test', token: 'token-$id');
    for (var i = 0; i < 20; i++) {
      await Future<void>.value();
    }
  }

  http.Response feed(String id, String text) => http.Response(
      jsonEncode({
        'items': [
          {
            '_id': 'post',
            'userId': id,
            'userName': id,
            'learningLanguage': 'en',
            'text': text,
            'likes': [],
            'likesCount': 0,
            'likedByMe': false,
            'createdAt': '2026-01-01',
            'updatedAt': '2026-01-01',
          }
        ],
        'page': 1,
        'limit': 50,
        'total': 1,
        'hasMore': false
      }),
      200);

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await auth.init();
    prefs = await SharedPreferences.getInstance();
    await LanguageService().init();
    await TargetLanguageService().init();
    await login(a);
  });

  for (final boundary in ['account', 'language', 'language ABA', 'unmount']) {
    testWidgets('Community ignores late UI/cache response after $boundary',
        (tester) async {
      final old = Completer<http.Response>();
      var calls = 0;
      await http.runWithClient(() async {
        await tester.pumpWidget(const MaterialApp(home: CommunityScreen()));
        await tester.pump();
        expect(calls, 1);
        if (boundary == 'account') {
          await login(b);
          await tester.pumpAndSettle();
        } else if (boundary == 'unmount') {
          await tester.pumpWidget(const SizedBox.shrink());
        } else {
          await tester.tap(
              find.textContaining(LanguageService().getString('lang_german')));
          await tester.pumpAndSettle();
          if (boundary == 'language ABA') {
            await tester
                .tap(find.text(LanguageService().getString('all_languages')));
            await tester.pumpAndSettle();
          }
        }
        final stored = {for (final key in prefs.getKeys()) key: prefs.get(key)};
        old.complete(feed(a, 'stale personalized post'));
        await tester.pumpAndSettle();
        expect(find.text('stale personalized post'), findsNothing);
        expect(
            {for (final key in prefs.getKeys()) key: prefs.get(key)}, stored);
        if (boundary != 'unmount') {
          expect(find.text('current personalized post'), findsOneWidget);
        }
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
          () => MockClient((request) async {
                if (!request.url.path.contains('/community/posts')) {
                  return http.Response('{}', 200);
                }
                calls++;
                if (calls == 1) return await old.future;
                return feed(b, 'current personalized post');
              }));
    });
  }

  testWidgets(
      'account switch clears identity-bound Community draft and local_guest makes no request',
      (tester) async {
    var calls = 0;
    await http.runWithClient(() async {
      await tester.pumpWidget(const MaterialApp(home: CommunityScreen()));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).first, 'A draft');
      await auth.loginAsGuest();
      await tester.pumpAndSettle();
      expect(find.text('A draft'), findsNothing);
      expect(find.text('old personalized post'), findsNothing);
      expect(calls, 1);
      expect(CommunityFeedCache.read(prefs, CommunityQuery('local_guest')),
          isNull);
      expect(CommunityFeedCache.read(prefs, CommunityQuery('registered_$a')),
          isNotNull);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
        () => MockClient((request) async {
              if (!request.url.path.contains('/community/posts')) {
                return http.Response('{}', 200);
              }
              calls++;
              return feed(a, 'old personalized post');
            }));
  });
}
