import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/models/flashcard.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/flashcard_service.dart';
import 'package:lingua_ai/services/offline_queue_service.dart';
import 'package:lingua_ai/services/progress_service.dart';
import 'package:lingua_ai/core/localization/target_language_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const userId = '507f1f77bcf86cd799439011';
  const cardId = '507f1f77bcf86cd799439012';
  final auth = AuthService();
  final cards = FlashcardService();
  final queue = OfflineQueueService();
  late SharedPreferences prefs;
  final card = Flashcard.fromJson({
    '_id': cardId, 'userId': userId, 'targetWord': 'word',
    'turkishTranslation': 'translation', 'targetLanguage': 'en',
  });
  Future<void> settle() async {
    for (var i = 0; i < 8; i++) {
      await Future<void>.delayed(Duration.zero);
    }
  }
  setUpAll(() async {
    SharedPreferences.setMockInitialValues({});
    await auth.init();
    await TargetLanguageService().init();
    await ProgressService().init();
    await cards.init();
    prefs = await SharedPreferences.getInstance();
  });
  setUp(() async {
    await prefs.clear();
    await auth.setGuestSession(
        id: userId, email: 'guest-test@guest.lingua.local', token: 'test-token');
    await TargetLanguageService().setLanguage('en', syncToBackend: false);
    await settle();
    await prefs.setString('flashcards_guest_${userId}_en_list', jsonEncode([card.toJson()]));
    await cards.reloadFlashcards();
  });

  for (final type in ['create', 'update', 'delete', 'review']) {
    test('online $type lost response carries its original key into queued retry', () async {
      final requests = <http.Request>[];
      await http.runWithClient(() async {
        switch (type) {
          case 'create': await cards.createFlashcard('word', 'translation'); break;
          case 'update': await cards.updateFlashcard(cardId, 'edited', 'translation'); break;
          case 'delete': await cards.deleteFlashcard(cardId); break;
          case 'review': await cards.reviewCard(card, 4); break;
        }
        await settle();
        final action = (await queue.getQueue()).single;
        expect(action.id, requests.single.headers['X-Idempotency-Key']);
        expect(await queue.processQueue(userId), true);
        expect(await queue.getQueue(), isEmpty);
      }, () => MockClient((request) async {
        requests.add(request);
        if (requests.length == 1) return http.Response('Response lost', 500);
        return http.Response(jsonEncode(card.toJson()), 200);
      }));
      expect(requests, hasLength(2));
      expect(requests[1].headers['X-Idempotency-Key'], requests[0].headers['X-Idempotency-Key']);
      expect(requests[1].body, requests[0].body);
    });
  }

  test('ambiguous online create remains unchanged while later edits/reviews/delete stay dependent', () async {
    final requests = <http.Request>[];
    await http.runWithClient(() async {
      await cards.createFlashcard('original', 'translation');
      await settle();
      final pending = cards.allCards.singleWhere((c) => c.id.startsWith('local_'));
      await cards.updateFlashcard(pending.id, 'latest', 'translation');
      await cards.reviewCard(cards.allCards.singleWhere((c) => c.id == pending.id), 4);
      await cards.deleteFlashcard(pending.id);
      await settle();
      final actions = await queue.getQueue();
      expect(actions.map((a) => a.type),
          ['create-flashcard', 'update-flashcard', 'review-flashcard', 'delete-flashcard']);
      expect(actions.first.payload['targetWord'], 'original');
      expect(actions.first.id, requests.single.headers['X-Idempotency-Key']);
      // The drain re-reads the persisted queue record and its started flag.
      expect(await queue.processQueue(userId), true);
      expect(await queue.getQueue(), isEmpty);
    }, () => MockClient((request) async {
      requests.add(request);
      if (requests.length == 1) return http.Response('Response lost', 500);
      return http.Response(jsonEncode(card.toJson()), 200);
    }));
    expect(requests, hasLength(5));
    expect(requests[1].body, requests[0].body);
    expect(jsonDecode(requests[2].body)['targetWord'], 'latest');
    expect(requests.last.method, 'DELETE');
    expect(requests.last.url.path, endsWith('/$cardId'));
  });
}
