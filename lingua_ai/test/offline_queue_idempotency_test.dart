import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/flashcard_api_service.dart';
import 'package:lingua_ai/services/progress_api_service.dart';
import 'package:lingua_ai/services/offline_queue_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const userId = '507f1f77bcf86cd799439011';
  final auth = AuthService();
  var now = DateTime.utc(2026);
  OfflineQueueService queue() => OfflineQueueService.forTesting(
      progressApi: ProgressApiService(), flashcardApi: FlashcardApiService(), now: () => now);

  for (final type in [
    'create-flashcard', 'update-flashcard', 'delete-flashcard',
    'review-flashcard', 'complete-lesson',
  ]) {
    test('$type retry sends the same durable action ID after restart', () async {
      SharedPreferences.setMockInitialValues({});
      await auth.init();
      await auth.setGuestSession(
          id: userId, email: 'guest-test@guest.lingua.local', token: 'test-token');
      final original = queue();
      await original.pushAction(type, {
        'tempId': 'local_123', 'id': '507f1f77bcf86cd799439012',
        'targetWord': 'word', 'turkishTranslation': 'translation',
        'targetLanguage': 'English', 'lessonId': 'lesson-1', 'score': 4,
      }, ownerNamespace: auth.localStorageNamespace);
      final operationId = (await original.getQueue()).single.id;
      final requests = <http.Request>[];
      await http.runWithClient(() async {
        expect(await original.processQueue(userId), false);
        final prefs = await SharedPreferences.getInstance();
        final disk = {for (final key in prefs.getKeys()) key: prefs.get(key)!};
        SharedPreferences.setMockInitialValues(disk);
        await auth.init();
        now = now.add(const Duration(minutes: 6));
        final restarted = queue();
        expect((await restarted.getQueue()).single.id, operationId);
        expect(await restarted.processQueue(userId), true);
        expect(await restarted.getQueue(), isEmpty);
      }, () => MockClient((request) async {
        requests.add(request);
        // The first response is lost after dispatch; the retry receives success.
        if (requests.length == 1) return http.Response('Response lost', 500);
        return http.Response(jsonEncode({'_id': '507f1f77bcf86cd799439012'}), 200);
      }));
      expect(requests, hasLength(2));
      expect(requests.map((r) => r.headers['X-Idempotency-Key']),
          [operationId, operationId]);
      expect(requests.map((r) => r.headers['Authorization']),
          ['Bearer test-token', 'Bearer test-token']);
    });
  }
}
