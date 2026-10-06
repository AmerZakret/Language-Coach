import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/core/localization/language_service.dart';
import 'package:lingua_ai/data/dummy_data.dart';
import 'package:lingua_ai/models/lesson.dart';
import 'package:lingua_ai/screens/lessons/lesson_screen.dart';
import 'package:lingua_ai/services/lesson_api_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const jsonHeaders = {'content-type': 'application/json; charset=utf-8'};

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await LanguageService().init();
  });

  final seedIds = <String>{};
  for (final file in Directory('../lingua_ai_backend/src/lessons/data')
      .listSync(recursive: true).whereType<File>().where((file) => file.path.endsWith('.ts'))) {
    seedIds.addAll(RegExp(r"^    id: '([^']+)'", multiLine: true)
        .allMatches(file.readAsStringSync()).map((match) => match[1]!));
  }

  for (final language in Lesson.languageCodes) {
    test('$language fallback IDs are unique, playable, and present in backend seed data', () {
      final lessons = DummyData.getLessons(language);
      expect(lessons, hasLength(6));
      expect(lessons.map((lesson) => lesson.id).toSet(), hasLength(6));
      for (final lesson in lessons) {
        expect(seedIds, contains(lesson.id));
        expect(lesson.targetLanguage, language);
        expect(lesson.questions, isNotEmpty);
      }
    });

    test('$language lesson parsing preserves the API code in summary and detail', () async {
      final lesson = DummyData.getLessons(language).first;
      final summary = lesson.toJson()..remove('questions');
      expect(Lesson.fromJson(summary).targetLanguage, language);
      final detail = lesson.toJson()..['title'] = '${lesson.title} from server';
      await http.runWithClient(() async {
        final result = await LessonApiService().fetchLessonById(lesson.id);
        expect(result.toJson(), detail);
      }, () => MockClient((_) async => http.Response(jsonEncode(detail), 200, headers: jsonHeaders)));
    });
  }

  test('404 remains terminal even when an exact playable fallback and cache exist', () async {
    final lesson = DummyData.getLessons('en').first;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('lessons_cache_en', jsonEncode([lesson.toJson()]));
    await http.runWithClient(() async {
      await expectLater(LessonApiService().fetchLessonById(lesson.id),
          throwsA(isA<LessonNotFoundException>().having((error) => error.id, 'id', lesson.id)));
    }, () => MockClient((_) async => http.Response(
        jsonEncode({'message': 'Lesson not found', 'error': 'Not Found', 'statusCode': 404}), 404)));
  });

  for (final body in [
    {'error': 'Lesson not found', 'id': 'en_b_1'},
    DummyData.getLessons('en').first.toJson()..['questions'] = [],
    DummyData.getLessons('en').first.toJson()..['id'] = 'en_b_2',
    DummyData.getLessons('en').first.toJson()..['targetLanguage'] = 'English',
  ]) {
    test('a malformed 200 detail never becomes a fake or unrelated lesson: ${body.keys}', () async {
      await http.runWithClient(() async {
        await expectLater(LessonApiService().fetchLessonById('en_b_1'), throwsFormatException);
      }, () => MockClient((_) async => http.Response(jsonEncode(body), 200, headers: jsonHeaders)));
    });
  }

  test('cached summaries are skipped offline in favor of the exact playable fallback', () async {
    final lesson = DummyData.getLessons('en')[1];
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('lessons_cache_en', jsonEncode([lesson.toJson()..remove('questions')]));
    await http.runWithClient(() async {
      expect((await LessonApiService().fetchLessonById(lesson.id)).toJson(), lesson.toJson());
      await expectLater(LessonApiService().fetchLessonById('missing'), throwsA(isA<LessonNotFoundException>()));
    }, () => MockClient((_) async => throw const SocketException('offline')));
  });

  test('an exact cached playable detail remains available during transport failure', () async {
    final cached = DummyData.getLessons('en').first.toJson()..['id'] = 'custom-lesson';
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('lessons_cache_en', jsonEncode([cached]));
    await http.runWithClient(() async {
      expect((await LessonApiService().fetchLessonById('custom-lesson')).toJson(), cached);
    }, () => MockClient((_) async => throw const SocketException('offline')));
  });

  for (final response in [
    http.Response('{"message":"Lesson not found","statusCode":404}', 404),
    http.Response('{"error":"Lesson not found","id":"en_b_1"}', 200),
    http.Response(jsonEncode(DummyData.getLessons('en').first.toJson()..['questions'] = []), 200),
  ]) {
    testWidgets('lesson screen safely renders unavailable UI for status ${response.statusCode}', (tester) async {
      final summary = Lesson.fromJson(DummyData.getLessons('en').first.toJson()..remove('questions'));
      await http.runWithClient(() async {
        await tester.pumpWidget(MaterialApp(
          onGenerateRoute: (_) => MaterialPageRoute<void>(
            settings: RouteSettings(arguments: summary),
            builder: (_) => const LessonScreen(),
          ),
        ));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 100));
      }, () => MockClient((_) async => response));
      expect(tester.takeException(), isNull);
      expect(find.text(LanguageService().getString('error_loading')), findsOneWidget);
      expect(find.text(LanguageService().getString('no_questions')), findsOneWidget);
      expect(find.byType(LinearProgressIndicator), findsNothing);
    });
  }
}
