import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/offline_queue_service.dart';
import 'package:lingua_ai/services/progress_api_service.dart';
import 'package:lingua_ai/services/flashcard_api_service.dart';
import 'package:lingua_ai/models/flashcard.dart';

class RecordedDispatch {
  final String type;
  final String owner = AuthService().localStorageNamespace;
  final String token = AuthService().token;
  RecordedDispatch(this.type);
}

class FakeProgressApi extends ProgressApiService {
  final List<RecordedDispatch> calls = [];
  Completer<void>? started;
  Completer<void>? release;
  @override
  Future<Map<String, dynamic>> completeLesson(
      String userId, String lessonId, int score, {String? operationId}) async {
    calls.add(RecordedDispatch('complete-lesson'));
    expect(userId, AuthService().currentUserId);
    started?.complete();
    started = null;
    if (release != null) await release!.future;
    return {};
  }
}

class FakeFlashcardApi extends FlashcardApiService {
  final List<RecordedDispatch> calls = [];
  Flashcard record(String type) {
    calls.add(RecordedDispatch(type));
    return Flashcard.fromJson({'_id': 'server-card'});
  }

  @override
  Future<Flashcard> createFlashcard(String targetWord,
          String turkishTranslation, String targetLanguage,
          {String? nativeLanguage,
          String? nativeTranslation,
          String? exampleSentence,
          String? note,
          String? operationId, bool preserveLegacyLanguage = false}) async =>
      record('create-flashcard');
  @override
  Future<Flashcard> updateFlashcard(
          String cardId, String? targetWord, String? turkishTranslation,
          {String? targetLanguage,
          String? nativeLanguage,
          String? nativeTranslation,
          String? exampleSentence,
          String? note,
          String? operationId, bool preserveLegacyLanguage = false}) async =>
      record('update-flashcard');
  @override
  Future<void> deleteFlashcard(String cardId, {String? operationId}) async {
    record('delete-flashcard');
  }

  @override
  Future<Flashcard> reviewCard(String cardId, int score, {String? operationId}) async =>
      record('review-flashcard');
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const a = '507f1f77bcf86cd799439011';
  const b = '507f1f77bcf86cd799439012';
  final auth = AuthService();
  late SharedPreferences prefs;
  late FakeProgressApi progress;
  late FakeFlashcardApi cards;
  late OfflineQueueService queue;
  String key(String owner) =>
      'linguaai_offline_queue_${Uri.encodeComponent(owner)}';

  Future<void> login(String id, {bool guest = false}) async {
    if (guest) {
      await auth.setGuestSession(
          id: id, email: 'guest-$id@guest.lingua.local', token: 'test-$id');
    } else {
      auth.setBackendSession(
          name: 'Test', email: '$id@example.com', token: 'test-$id', id: id);
      await Future<void>.delayed(Duration.zero);
    }
  }

  Future<void> enqueue([String type = 'complete-lesson']) => queue.pushAction(
      type,
      {
        'lessonId': 'lesson',
        'score': 4,
        'cardId': 'card',
        'targetWord': 'word',
        'turkishTranslation': 'translation',
        'targetLanguage': 'English',
      },
      ownerNamespace: auth.localStorageNamespace);

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await auth.init();
    prefs = await SharedPreferences.getInstance();
    progress = FakeProgressApi();
    cards = FakeFlashcardApi();
    queue = OfflineQueueService.forTesting(
        progressApi: progress, flashcardApi: cards);
  });

  test(
      'registered queues survive logout, stay separate, and resume only for their owner',
      () async {
    await login(a);
    await enqueue();
    final savedA = prefs.getString(key('registered_$a'));
    auth.logout();
    await login(b);
    expect(await queue.getQueue(), isEmpty);
    expect(await queue.processQueue(a), false);
    await enqueue();
    expect(await queue.processQueue(b), true);
    expect(progress.calls.single.owner, 'registered_$b');
    expect(prefs.getString(key('registered_$a')), savedA);
    auth.logout();
    await login(a);
    expect((await queue.getQueue()).single.ownerNamespace, 'registered_$a');
    expect(await queue.processQueue(a), true);
    expect(progress.calls.last.owner, 'registered_$a');
    expect(await queue.getQueue(), isEmpty);
  });

  test(
      'guest A/B, registered, and local-only guest queues never merge; guest restart is stable',
      () async {
    await auth.loginAsGuest();
    await enqueue();
    final local = prefs.getString(key('local_guest'));
    expect(await queue.processQueue('guest'), false);
    await login(a, guest: true);
    await enqueue();
    final savedA = prefs.getString(key('guest_$a'));
    await auth.init();
    expect((await queue.getQueue()).single.ownerNamespace, 'guest_$a');
    auth.logout();
    await login(b, guest: true);
    expect(await queue.getQueue(), isEmpty);
    await enqueue();
    expect(await queue.processQueue(b), true);
    expect(prefs.getString(key('guest_$a')), savedA);
    await login(a);
    expect(await queue.getQueue(), isEmpty);
    expect(prefs.getString(key('local_guest')), local);
    await login(a, guest: true);
    expect(await queue.processQueue(a), true);
    expect(progress.calls.map((c) => c.owner), ['guest_$b', 'guest_$a']);
  });

  for (final returnToSameAccount in [false, true]) {
    test(
        'active drain stops after session switch (same account: $returnToSameAccount)',
        () async {
      await login(a);
      await enqueue();
      await enqueue();
      final started = Completer<void>();
      progress.started = started;
      progress.release = Completer<void>();
      final drain = queue.processQueue(a);
      await started.future;
      final savedA = prefs.getString(key('registered_$a'));
      auth.logout();
      await login(returnToSameAccount ? a : b);
      progress.release!.complete();
      expect(await drain, false);
      expect(progress.calls, hasLength(1));
      expect(progress.calls.single.owner, 'registered_$a');
      expect(progress.calls.single.token, 'test-$a');
      expect(prefs.getString(key('registered_$a')), savedA);
      if (!returnToSameAccount) expect(await queue.getQueue(), isEmpty);
      await login(a);
      progress.release = null;
      expect(await queue.processQueue(a), true);
      expect(progress.calls, hasLength(3));
    });
  }

  test('all five operation types dispatch only with their owner session',
      () async {
    await login(a);
    for (final type in [
      'complete-lesson',
      'create-flashcard',
      'update-flashcard',
      'delete-flashcard',
      'review-flashcard'
    ]) {
      await enqueue(type);
    }
    expect(await queue.processQueue(b), false);
    expect([...progress.calls, ...cards.calls], isEmpty);
    expect(await queue.processQueue(a), true);
    final calls = [...progress.calls, ...cards.calls];
    expect(calls, hasLength(5));
    expect(
        calls.every((c) => c.owner == 'registered_$a' && c.token == 'test-$a'),
        true);
  });

  test('action envelopes contain exactly ownership schema fields', () async {
    await login(a);
    await enqueue();
    final action = (await queue.getQueue()).single;
    expect(action.toJson().keys.toSet(), {
      'id',
      'type',
      'ownerNamespace',
      'payload',
      'createdAt',
      'schemaVersion'
    });
    expect(action.id, isNotEmpty);
    expect(action.schemaVersion, 1);
    expect(action.createdAt.isUtc, true);
  });

  test('wrong envelope owner fails closed without touching either queue',
      () async {
    await login(a);
    await enqueue();
    final raw = (await queue.getQueue()).single.toJson();
    raw['ownerNamespace'] = 'registered_$b';
    final tampered = [json.encode(raw)];
    await prefs.setStringList(key('registered_$a'), tampered);
    expect(await queue.processQueue(a), false);
    expect(progress.calls, isEmpty);
    expect(prefs.getStringList(key('registered_$a')), tampered);
  });

  test(
      'enqueue retains captured owner even if session changes during persistence',
      () async {
    await login(a);
    final write = enqueue();
    auth.logout();
    await login(b);
    await write;
    expect(await queue.getQueue(), isEmpty);
    expect(
        (json.decode(prefs.getString(key('registered_$a'))!)['actions']
            as List),
        hasLength(1));
  });

  test('legacy ownerless and malformed queues are quarantined as raw snapshots',
      () async {
    await login(b);
    final legacy = [
      json.encode({
        'id': 'old',
        'type': 'complete-lesson',
        'payload': {'userId': a}
      }),
      '{invalid'
    ];
    await prefs.setStringList('linguaai_offline_queue', legacy);
    expect(await queue.getQueue(), isEmpty);
    expect(prefs.containsKey('linguaai_offline_queue'), false);
    expect(prefs.getStringList('linguaai_offline_queue_legacy_unowned'),
        [json.encode(legacy)]);
    await prefs.setString('linguaai_offline_queue', '{malformed-global');
    expect(await queue.getQueue(), isEmpty);
    expect(prefs.getStringList('linguaai_offline_queue_legacy_unowned'),
        [json.encode(legacy), json.encode('{malformed-global')]);
    expect(progress.calls, isEmpty);
  });
}
