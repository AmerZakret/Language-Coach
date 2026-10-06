import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/ai_coach_api_service.dart';
import 'package:lingua_ai/services/flashcard_api_service.dart';
import 'package:lingua_ai/services/pronunciation_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const id = '507f1f77bcf86cd799439011';
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await AuthService().init();
    await AuthService().setGuestSession(
        id: id, email: 'guest-test@guest.lingua.local', token: 'guest-test-token');
  });

  test('body/query identity is absent while guest bearer token and create key are preserved', () async {
    final requests = <http.Request>[];
    await http.runWithClient(() async {
      final cards = FlashcardApiService();
      await cards.createFlashcard('word', 'translation', 'en', operationId: 'stable-create');
      await cards.getAllCards(targetLanguage: 'en');
      await cards.getDueCards(targetLanguage: 'en');
      final coach = AiCoachApiService();
      await coach.sendMessage(message: 'Hello', language: 'en', targetLanguage: 'en');
      await coach.checkWriting(topic: 'Greetings', text: 'Hello', language: 'en', targetLanguage: 'en');
      await coach.getHistory(targetLanguage: 'en');
      await coach.clearHistory(targetLanguage: 'en');
    }, () => MockClient((request) async {
      requests.add(request);
      return http.Response(request.method == 'GET' ? '[]' : '{}', 200);
    }));
    expect(requests, hasLength(7));
    for (final request in requests) {
      expect(request.headers['Authorization'], 'Bearer guest-test-token');
      expect(request.url.queryParameters, isNot(contains('userId')));
      if (request.body.isNotEmpty) {
        expect(jsonDecode(request.body) as Map, isNot(contains('userId')));
      }
    }
    expect(requests.first.headers['X-Idempotency-Key'], 'stable-create');
    expect(requests.last.url.path, '/ai-coach/clear');
  });

  test('pronunciation multipart does not submit a guest alias or user ID', () async {
    final directory = await Directory.systemTemp.createTemp('phase5a_audio_');
    final audio = File('${directory.path}/audio.wav');
    try {
      await audio.writeAsBytes([1, 2, 3]);
      await http.runWithClient(() async {
        await PronunciationService().assessPronunciation(
            audioPath: audio.path, targetText: 'Hello', targetLanguage: 'en');
      }, () => MockClient((request) async {
        expect(request.headers['Authorization'], 'Bearer guest-test-token');
        expect(request.body, isNot(contains('name="userId"')));
        expect(request.body, contains('name="audio"'));
        expect(request.body, contains('name="targetLanguage"'));
        return http.Response('{}', 201);
      }));
    } finally {
      await audio.delete();
      await directory.delete();
    }
  });
}
