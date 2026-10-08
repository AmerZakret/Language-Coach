import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/services/xp_level.dart';
import 'package:lingua_ai/services/progress_service.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/progress_cache.dart';
import 'package:lingua_ai/core/localization/language_service.dart';
import 'package:lingua_ai/core/localization/target_language_service.dart';
import 'package:lingua_ai/screens/writing/writing_practice_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late SharedPreferences prefs;
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    final auth = AuthService();
    await auth.init();
    await auth.loginAsGuest();
    await LanguageService().init();
    await TargetLanguageService().init();
    prefs = await SharedPreferences.getInstance();
    await ProgressSnapshot(totalXp: 200).save(prefs, 'local_guest', 'en');
  });
  test('display thresholds and names mirror the authoritative backend', () {
    final source =
        File('../lingua_ai_backend/src/common/xp-level.ts').readAsStringSync();
    final bands =
        RegExp(r"minXp: (\d+), level: '([^']+)'").allMatches(source).toList();
    expect(XpLevels.thresholds, bands.map((m) => int.parse(m[1]!)).toList());
    expect(XpLevels.names, bands.map((m) => m[2]!).toList());
    for (var i = 0; i < bands.length; i++) {
      final threshold = XpLevels.thresholds[i];
      for (final xp in [threshold, threshold + 1]) {
        expect(ProgressService.getLevelFromXp(xp), XpLevels.names[i]);
      }
      if (i > 0)
        expect(XpLevels.levelFromXp(threshold - 1), XpLevels.names[i - 1]);
    }
    for (final xp in [2200, 2201, 10000]) {
      expect(XpLevels.info(xp),
          {'level': 'Advanced', 'nextXp': 2200, 'progress': 1.0});
    }
    for (final xp in [-1, 9007199254740992]) {
      expect(() => XpLevels.info(xp), throwsArgumentError);
    }
  });

  testWidgets(
      'successful writing shows feedback without changing acknowledged XP or claiming a reward',
      (tester) async {
    final before = prefs.getString(ProgressSnapshot.key('local_guest', 'en'));
    final requests = <http.Request>[];
    await http.runWithClient(() async {
      await tester.pumpWidget(const MaterialApp(home: WritingPracticeScreen()));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(
          ElevatedButton, LanguageService().getString('suggest_topic')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField),
          'This is a sufficiently long sample. It has two complete sentences.');
      final submit = find.widgetWithText(ElevatedButton,
          LanguageService().getString('check_writing').toUpperCase());
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(requests, hasLength(1));
      expect(find.text('Useful feedback'), findsOneWidget);
      expect(
          prefs.getString(ProgressSnapshot.key('local_guest', 'en')), before);
      expect(find.textContaining('XP'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
    },
        () => MockClient((request) async {
              requests.add(request);
              return http.Response(
                  jsonEncode({
                    'grammarScore': 85,
                    'vocabularyScore': 80,
                    'clarityScore': 90,
                    'overallScore': 85,
                    'feedback': 'Useful feedback',
                    'improvedVersion': 'Better text',
                    'corrections': [],
                  }),
                  200);
            }));
  });

  test('activity screens cannot call the removed client-only XP award API', () {
    for (final path in [
      'lib/screens/writing/writing_practice_screen.dart',
      'lib/screens/pronunciation/pronunciation_practice_screen.dart',
    ]) {
      final source = File(path).readAsStringSync();
      expect(source, isNot(contains('progress_service.dart')));
      expect(source, isNot(contains('addXp')));
      expect(source, isNot(contains('xp_earned_badge')));
      expect(source, isNot(contains('Earned +10')));
    }
  });
}
