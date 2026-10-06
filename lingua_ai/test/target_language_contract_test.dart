import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/core/localization/language_service.dart';
import 'package:lingua_ai/core/localization/target_language.dart';
import 'package:lingua_ai/core/localization/target_language_service.dart';
import 'package:lingua_ai/screens/pronunciation/pronunciation_practice_screen.dart';
import 'package:lingua_ai/services/pronunciation_service.dart';
import 'package:lingua_ai/services/flashcard_api_service.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/offline_queue_service.dart';
import 'package:lingua_ai/services/progress_api_service.dart';
import 'package:lingua_ai/services/lesson_api_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const locales = {
    'en': 'en-US',
    'de': 'de-DE',
    'es': 'es-ES',
    'fr': 'fr-FR',
    'ar': 'ar-SA'
  };

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await AuthService().init();
    await LanguageService().init();
    await TargetLanguageService().init();
  });
  for (final entry in TargetLanguage.names.entries) {
    test(
        '${entry.key} and ${entry.value} normalize correctly, including the former code bug',
        () {
      for (final input in [
        entry.key,
        entry.value,
        ' ${entry.value.toUpperCase()} '
      ]) {
        expect(TargetLanguage.code(input), entry.key);
        expect(TargetLanguageService.toShortCode(input), entry.key);
        expect(TargetLanguageService.toFullName(input), entry.value);
        expect(TargetLanguage.ttsLocale(input), locales[entry.key]);
      }
    });

    test(
        '${entry.key} assessment sends the code for code and legacy full-name inputs',
        () async {
      final directory =
          await Directory.systemTemp.createTemp('pronunciation-language-test-');
      final audio = File('${directory.path}/audio.wav');
      await audio.writeAsBytes([1, 2, 3]);
      try {
        await http.runWithClient(() async {
          for (final input in [entry.key, entry.value]) {
            final result = await PronunciationService().assessPronunciation(
                audioPath: audio.path,
                targetText: 'word',
                targetLanguage: input);
            expect(result.targetLanguage, entry.key);
          }
        },
            () => MockClient((request) async {
                  expect(
                      request.body,
                      contains(
                          'name="targetLanguage"\r\n\r\n${entry.key}\r\n'));
                  return http.Response(
                      jsonEncode({
                        'targetText': 'word',
                        'targetLanguage': entry.key,
                        'recognizedText': 'word',
                        'pronunciationScore': 100,
                        'result': 'correct',
                        'aiFeedback': 'Good',
                        'provider': 'fixture'
                      }),
                      201);
                }));
      } finally {
        await directory.delete(recursive: true);
      }
    });

    testWidgets(
        '${entry.key} pronunciation screen selects the actual TTS locale',
        (tester) async {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('targetLanguage', entry.key);
      await TargetLanguageService().init();
      final calls = <MethodCall>[];
      final messenger = tester.binding.defaultBinaryMessenger;
      messenger.setMockMethodCallHandler(const MethodChannel('flutter_tts'),
          (call) async {
        calls.add(call);
        return 1;
      });
      messenger.setMockMethodCallHandler(
          const MethodChannel('com.llfbandit.record'), (_) async => null);
      await tester
          .pumpWidget(const MaterialApp(home: PronunciationPracticeScreen()));
      await tester.enterText(find.byType(TextField).first, 'word');
      await tester.pump();
      await tester.ensureVisible(find.byIcon(Icons.volume_up_rounded));
      await tester.tap(find.byIcon(Icons.volume_up_rounded));
      await tester.pumpAndSettle();
      expect(
          calls.where((call) => call.method == 'setLanguage').single.arguments,
          locales[entry.key]);
      expect(calls.where((call) => call.method == 'speak'), isNotEmpty);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      messenger.setMockMethodCallHandler(
          const MethodChannel('flutter_tts'), null);
      messenger.setMockMethodCallHandler(
          const MethodChannel('com.llfbandit.record'), null);
    });
  }

  test('unknown target values cannot silently become English', () {
    for (final value in ['unknown', 'Italian', 'tr', '', 'Turkish']) {
      expect(TargetLanguage.tryCode(value), isNull);
      expect(() => TargetLanguageService.toShortCode(value),
          throwsFormatException);
      expect(() => TargetLanguage.ttsLocale(value), throwsFormatException);
    }
  });

  test('unknown lesson language cannot enter an English fallback', () async {
    await expectLater(
        LessonApiService().fetchLessons('unknown'), throwsFormatException);
    await http.runWithClient(() async {
      final lessons = await LessonApiService().fetchLessons('German');
      expect(lessons, isNotEmpty);
      expect(lessons.every((lesson) => lesson.targetLanguage == 'de'), true);
    }, () => MockClient((_) async => throw const SocketException('offline')));
  });

  test(
      'legacy saved full name becomes the selected code without changing its display label',
      () async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('targetLanguage', 'German');
    await TargetLanguageService().init();
    expect(TargetLanguageService().currentLanguage, 'de');
    expect(
        TargetLanguageService.toFullName(
            TargetLanguageService().currentLanguage),
        'German');
  });

  test(
      'new queue requests normalize aliases while previously attempted requests preserve receipt inputs',
      () async {
    final auth = AuthService();
    auth.setBackendSession(
        name: 'Test',
        email: 'test@example.com',
        token: 'token',
        id: '507f1f77bcf86cd799439011');
    await Future<void>.delayed(Duration.zero);
    final prefs = await SharedPreferences.getInstance();
    final queue = OfflineQueueService.forTesting(
        progressApi: ProgressApiService(), flashcardApi: FlashcardApiService());
    await queue.pushAction(
        'create-flashcard',
        {
          'targetWord': 'word',
          'turkishTranslation': 'translation',
          'targetLanguage': 'German'
        },
        ownerNamespace: auth.localStorageNamespace,
        operationId: 'old-create');
    final storageKey = 'linguaai_offline_queue_${auth.localStorageNamespace}';
    final state = jsonDecode(prefs.getString(storageKey)!);
    state['actions'][0]['attemptCount'] = 1;
    await prefs.setString(storageKey, jsonEncode(state));
    await queue.pushAction(
        'update-flashcard', {'id': 'card', 'targetLanguage': 'German'},
        ownerNamespace: auth.localStorageNamespace, operationId: 'new-update');
    final languages = <String>[];
    await http.runWithClient(() async {
      expect(await queue.processQueue(auth.currentUserId), true);
    },
        () => MockClient((request) async {
              languages
                  .add(jsonDecode(request.body)['targetLanguage'] as String);
              return http.Response('{"_id":"card","targetLanguage":"de"}', 200);
            }));
    expect(languages, ['German', 'de']);
  });
}
