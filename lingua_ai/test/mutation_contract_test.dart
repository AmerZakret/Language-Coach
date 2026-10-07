import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/community_service.dart';
import 'package:lingua_ai/services/flashcard_api_service.dart';
import 'package:lingua_ai/services/offline_queue_service.dart';
import 'package:lingua_ai/services/progress_api_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const ownerId = '507f1f77bcf86cd799439011';
  const cardId = '507f1f77bcf86cd799439012';
  late SharedPreferences prefs;
  final auth = AuthService();
  final api = FlashcardApiService();
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();
    await auth.init();
    auth.setBackendSession(name: 'Test', email: 'test@example.com', token: 'test-token', id: ownerId);
    await Future<void>.delayed(Duration.zero);
  });

  final payloads = <Map<String, String>>[
    {'targetWord': 'word', 'turkishTranslation': 'translation', 'targetLanguage': 'en',
      'nativeLanguage': 'tr', 'nativeTranslation': 'native', 'exampleSentence': '', 'note': ''},
    {'targetWord': 'changed', 'turkishTranslation': 'changed translation'},
    {'note': ''},
    {'nativeLanguage': '', 'nativeTranslation': '', 'exampleSentence': 'example', 'note': 'note'},
  ];
  for (var index = 0; index < payloads.length; index++) {
    test('online and queued update have identical supported fields and key: $index', () async {
      final payload = payloads[index];
      final requests = <http.Request>[];
      final key = 'parity-$index';
      final queue = OfflineQueueService.forTesting(progressApi: ProgressApiService(), flashcardApi: api);
      await http.runWithClient(() async {
        await api.updateFlashcard(cardId, payload['targetWord'], payload['turkishTranslation'],
            targetLanguage: payload['targetLanguage'], nativeLanguage: payload['nativeLanguage'],
            nativeTranslation: payload['nativeTranslation'], exampleSentence: payload['exampleSentence'],
            note: payload['note'], operationId: key);
        await queue.pushAction('update-flashcard', {'id': cardId, ...payload},
            ownerNamespace: auth.localStorageNamespace, operationId: key);
        expect(await queue.processQueue(ownerId), true);
      }, () => MockClient((request) async {
        requests.add(request);
        return http.Response(jsonEncode({'_id': cardId}), 200);
      }));
      expect(requests, hasLength(2));
      expect(jsonDecode(requests[0].body), payload);
      expect(requests[1].body, requests[0].body);
      expect(requests.map((request) => request.headers['X-Idempotency-Key']), [key, key]);
      expect(requests.map((request) => request.headers['Authorization']), ['Bearer test-token', 'Bearer test-token']);
    });
  }

  test('new update wire contract and clears survive a lost response and restart', () async {
    final bodies = <String>[];
    final keys = <String?>[];
    var now = DateTime.utc(2026, 10, 7);
    OfflineQueueService queue() => OfflineQueueService.forTesting(
        progressApi: ProgressApiService(), flashcardApi: api, now: () => now);
    final first = queue();
    await first.pushAction('update-flashcard', {'id': cardId, 'note': '', 'nativeTranslation': 'native'},
        ownerNamespace: auth.localStorageNamespace, operationId: 'lost-update');
    await http.runWithClient(() async {
      expect(await first.processQueue(ownerId), false);
      expect((await first.getQueue()).single.payload['_mutationContract'], 2);
      final saved = {for (final key in prefs.getKeys()) key: prefs.get(key)!};
      SharedPreferences.setMockInitialValues(saved);
      await auth.init();
      now = now.add(const Duration(minutes: 6));
      expect(await queue().processQueue(ownerId), true);
    }, () => MockClient((request) async {
      if (request.method != 'PUT') return http.Response('{}', 200);
      bodies.add(request.body);
      keys.add(request.headers['X-Idempotency-Key']);
      return bodies.length == 1 ? http.Response('lost', 500) : http.Response(jsonEncode({'_id': cardId}), 200);
    }));
    expect(bodies, hasLength(2));
    expect(bodies[0], bodies[1]);
    expect(jsonDecode(bodies[1]), {'note': '', 'nativeTranslation': 'native'});
    expect(keys, ['lost-update', 'lost-update']);
  });

  test('previously attempted legacy updates retain their original receipt payload', () async {
    final queue = OfflineQueueService.forTesting(progressApi: ProgressApiService(), flashcardApi: api);
    await queue.pushAction('update-flashcard', {'id': cardId, 'targetWord': 'word',
      'turkishTranslation': 'translation', 'nativeLanguage': 'tr', 'nativeTranslation': 'native',
      'note': '', 'exampleSentence': ''}, ownerNamespace: auth.localStorageNamespace, operationId: 'legacy-update');
    final key = 'linguaai_offline_queue_${auth.localStorageNamespace}';
    final state = jsonDecode(prefs.getString(key)!);
    state['actions'][0]['attemptCount'] = 1;
    await prefs.setString(key, jsonEncode(state));
    await http.runWithClient(() async {
      expect(await queue.processQueue(ownerId), true);
    }, () => MockClient((request) async {
      expect(jsonDecode(request.body), {'targetWord': 'word', 'turkishTranslation': 'translation'});
      expect(request.headers['X-Idempotency-Key'], 'legacy-update');
      return http.Response(jsonEncode({'_id': cardId}), 200);
    }));
  });

  test('community update serializes empty text as a clear and null as omission', () async {
    final requests = <http.Request>[];
    await http.runWithClient(() async {
      await CommunityService().updatePost(postId: 'image-post', text: '   ');
      await CommunityService().updatePost(postId: 'image-post');
    }, () => MockClient((request) async {
      requests.add(request);
      return http.Response('{"_id":"image-post","text":"","imageUrl":"/image.png"}', 200);
    }));
    expect(requests[0].body, contains('name="text"'));
    expect(requests[0].body.split('\r\n\r\n')[1], startsWith('\r\n--'));
    expect(requests[1].body, isNot(contains('name="text"')));
  });
}
