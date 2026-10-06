import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/offline_queue_service.dart';
import 'package:lingua_ai/services/flashcard_api_service.dart';
import 'package:lingua_ai/models/flashcard.dart';
import 'offline_queue_ownership_test.dart' show FakeProgressApi;

class DurableCardsApi extends FlashcardApiService {
  final calls = <Map<String, dynamic>>[];
  bool failUpdate = false;
  bool failReview = false;
  Completer<void>? started;
  Completer<void>? release;
  @override
  Future<Flashcard> createFlashcard(String targetWord,
      String turkishTranslation, String targetLanguage,
      {String? nativeLanguage,
      String? nativeTranslation,
      String? exampleSentence,
      String? note,
      String? operationId}) async {
    calls.add({'type': 'create', 'word': targetWord, 'note': note});
    started?.complete();
    if (release != null) await release!.future;
    return Flashcard.fromJson({'_id': 'mongo-real'});
  }

  @override
  Future<Flashcard> updateFlashcard(
      String cardId, String? targetWord, String? turkishTranslation,
      {String? targetLanguage,
      String? nativeLanguage,
      String? nativeTranslation,
      String? exampleSentence,
      String? note,
      String? operationId}) async {
    calls.add({'type': 'update', 'id': cardId});
    if (failUpdate) throw StateError('Update unavailable');
    return Flashcard.fromJson({'_id': cardId});
  }

  @override
  Future<void> deleteFlashcard(String cardId, {String? operationId}) async {
    calls.add({'type': 'delete', 'id': cardId});
  }

  @override
  Future<Flashcard> reviewCard(String cardId, int score,
      {String? operationId}) async {
    calls.add({'type': 'review', 'id': cardId, 'score': score});
    if (failReview) throw StateError('Review unavailable');
    return Flashcard.fromJson({'_id': cardId});
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const a = '507f1f77bcf86cd799439011';
  const b = '507f1f77bcf86cd799439012';
  const owner = 'guest_$a';
  const key = 'linguaai_offline_queue_$owner';
  const create = {
    'tempId': 'local_123',
    'targetWord': 'old',
    'turkishTranslation': 'translation',
    'targetLanguage': 'English'
  };
  final auth = AuthService();
  late SharedPreferences prefs;
  late FakeProgressApi progress;
  late DurableCardsApi cards;
  late OfflineQueueService queue;
  var now = DateTime.utc(2026);
  Future<void> login([String id = a]) => auth.setGuestSession(
      id: id, email: 'guest-$id@guest.lingua.local', token: 'test-$id');
  Future<void> push(String type, Map<String, dynamic> data) =>
      queue.pushAction(type, data, ownerNamespace: auth.localStorageNamespace);
  Future<void> restart() async {
    final values = {for (final k in prefs.getKeys()) k: prefs.get(k)!};
    SharedPreferences.setMockInitialValues(values);
    await auth.init();
    prefs = await SharedPreferences.getInstance();
    now = now.add(const Duration(minutes: 6));
    queue = OfflineQueueService.forTesting(
        progressApi: progress, flashcardApi: cards, now: () => now);
  }

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await auth.init();
    await login();
    prefs = await SharedPreferences.getInstance();
    progress = FakeProgressApi();
    cards = DurableCardsApi();
    now = now.add(const Duration(minutes: 6));
    queue = OfflineQueueService.forTesting(
        progressApi: progress, flashcardApi: cards, now: () => now);
  });

  test(
      'acknowledged first action does not replay after successor interruption and restart',
      () async {
    await push('complete-lesson', {'lessonId': 'first', 'score': 73});
    await push('complete-lesson', {'lessonId': 'second', 'score': 73});
    // Gate the first response, then arm a separate gate for its successor.
    final firstStarted = Completer<void>();
    final firstRelease = Completer<void>();
    progress.started = firstStarted;
    progress.release = firstRelease;
    final drain = queue.processQueue(a);
    await firstStarted.future;
    final secondStarted = Completer<void>();
    final secondRelease = Completer<void>();
    progress.started = secondStarted;
    // completeLesson captured firstRelease's future before this replacement.
    progress.release = secondRelease;
    firstRelease.complete();
    await secondStarted.future;
    expect((await queue.getQueue()).single.payload['lessonId'], 'second');
    auth.logout();
    secondRelease.complete();
    expect(await drain, false);
    await login();
    await restart();
    progress.release = null;
    expect(await queue.processQueue(a), true);
    expect(progress.calls, hasLength(3),
        reason: 'Only the unacknowledged successor retries');
  });

  test(
      'owned schema 1 migrates; create mapping and failed update survive app restart',
      () async {
    await push('create-flashcard', create);
    final action = (await queue.getQueue()).single.toJson();
    final update = {
      ...action,
      'id': 'legacy-update',
      'type': 'update-flashcard',
      'payload': {'id': 'local_123', 'targetWord': 'new'}
    };
    await prefs.setStringList(key, [jsonEncode(action), jsonEncode(update)]);
    cards.failUpdate = true;
    expect(await queue.processQueue(a), false);
    final record = jsonDecode(prefs.getString(key)!);
    expect(record['schemaVersion'], 2);
    expect(record['tempIds']['local_123'], 'mongo-real');
    expect(record['actions'].single['id'], 'legacy-update');
    expect(record['actions'].single['payload']['id'], 'mongo-real');
    await restart();
    cards.failUpdate = false;
    expect(await queue.processQueue(a), true);
    expect(cards.calls.map((c) => c['type']), ['create', 'update', 'update']);
    expect(cards.calls.last['id'], 'mongo-real');
  });

  test('unsent create plus edits sends latest fields as one create', () async {
    await push('create-flashcard', create);
    await push('update-flashcard',
        {'id': 'local_123', 'targetWord': 'new', 'note': 'latest'});
    expect((await queue.getQueue()).single.payload['targetWord'], 'new');
    expect(await queue.processQueue(a), true);
    expect(cards.calls.single,
        {'type': 'create', 'word': 'new', 'note': 'latest'});
  });

  test('compaction preserves earlier migrated edits and review order',
      () async {
    await push('create-flashcard', create);
    final action = (await queue.getQueue()).single.toJson();
    final earlierEdit = {
      ...action,
      'id': 'legacy-edit',
      'type': 'update-flashcard',
      'payload': {
        'id': 'local_123',
        'turkishTranslation': 'earlier translation',
        'exampleSentence': 'earlier example',
        'note': 'earlier note',
      }
    };
    final review = {
      ...action,
      'id': 'legacy-review',
      'type': 'review-flashcard',
      'payload': {'id': 'local_123', 'score': 2}
    };
    await prefs.setStringList(
        key, [jsonEncode(action), jsonEncode(earlierEdit), jsonEncode(review)]);
    await push('update-flashcard',
        {'id': 'local_123', 'targetWord': 'latest', 'note': null});
    final actions = await queue.getQueue();
    expect(actions.map((a) => a.id), [action['id'], 'legacy-review']);
    expect(actions.first.payload['turkishTranslation'], 'earlier translation');
    expect(actions.first.payload['exampleSentence'], 'earlier example');
    expect(actions.first.payload['targetWord'], 'latest');
    expect(actions.first.payload['note'], isNull);
    await restart();
    expect(await queue.processQueue(a), true);
    expect(cards.calls, [
      {'type': 'create', 'word': 'latest', 'note': null},
      {'type': 'review', 'id': 'mongo-real', 'score': 2},
    ]);
  });

  test('failed review retains real ID and exact score after restart', () async {
    await push('create-flashcard', create);
    await push('review-flashcard', {'id': 'local_123', 'score': 2});
    await push('review-flashcard', {'cardId': 'local_123', 'score': 5});
    cards.failReview = true;
    expect(await queue.processQueue(a), false);
    final pending = await queue.getQueue();
    expect(pending.map((a) => a.payload['score']), [2, 5]);
    expect(pending.first.payload['id'], 'mongo-real');
    expect(pending.last.payload['cardId'], 'mongo-real');
    await restart();
    cards.failReview = false;
    expect(await queue.processQueue(a), true);
    expect(cards.calls.skip(2).toList(), [
      {'type': 'review', 'id': 'mongo-real', 'score': 2},
      {'type': 'review', 'id': 'mongo-real', 'score': 5},
    ]);
  });

  test('overlapping owner drains do not dispatch or acknowledge twice',
      () async {
    await push('complete-lesson', {'lessonId': 'first', 'score': 73});
    progress.started = Completer<void>();
    progress.release = Completer<void>();
    final drain = queue.processQueue(a);
    await progress.started!.future;
    final another = OfflineQueueService.forTesting(
        progressApi: progress, flashcardApi: cards, now: () => now);
    expect(await another.processQueue(a), false);
    expect(progress.calls, hasLength(1));
    progress.release!.complete();
    expect(await drain, true);
    expect(await queue.getQueue(), isEmpty);
  });

  test('unsent create plus review plus delete cancels creation across restart',
      () async {
    await push('create-flashcard', create);
    await push('review-flashcard', {'id': 'local_123', 'score': 4});
    await push('delete-flashcard', {'id': 'local_123'});
    await restart();
    expect(await queue.processQueue(a), true);
    expect(cards.calls, isEmpty);
    expect(await queue.getQueue(), isEmpty);
  });

  test('reviews preserve exact scores and order behind mapped create',
      () async {
    await push('create-flashcard', create);
    await push('review-flashcard', {'cardId': 'local_123', 'score': 2});
    await push('review-flashcard', {'id': 'local_123', 'score': 5});
    expect(await queue.processQueue(a), true);
    expect(cards.calls.skip(1).toList(), [
      {'type': 'review', 'id': 'mongo-real', 'score': 2},
      {'type': 'review', 'id': 'mongo-real', 'score': 5}
    ]);
  });

  test('another instance append during drain is retained in current record',
      () async {
    await push('complete-lesson', {'lessonId': 'first', 'score': 73});
    final started = Completer<void>();
    progress.started = started;
    progress.release = Completer<void>();
    final drain = queue.processQueue(a);
    await started.future;
    final another = OfflineQueueService.forTesting(
        progressApi: progress, flashcardApi: cards, now: () => now);
    await another.pushAction(
        'complete-lesson', {'lessonId': 'new', 'score': 73},
        ownerNamespace: owner);
    progress.release!.complete();
    expect(await drain, true);
    expect(progress.calls, hasLength(1));
    await restart();
    expect((await queue.getQueue()).single.payload['lessonId'], 'new');
  });

  test(
      'in-flight create edits reviews and delete are retained and rewritten durably',
      () async {
    await push('create-flashcard', create);
    final started = Completer<void>();
    cards.started = started;
    cards.release = Completer<void>();
    final drain = queue.processQueue(a);
    await started.future;
    await push('update-flashcard', {'id': 'local_123', 'targetWord': 'new'});
    await push('review-flashcard', {'id': 'local_123', 'score': 4});
    await push('delete-flashcard', {'id': 'local_123'});
    expect(await queue.getQueue(), hasLength(4));
    cards.release!.complete();
    expect(await drain, true);
    expect(
        (await queue.getQueue()).every((a) => a.payload['id'] == 'mongo-real'),
        true);
    await restart();
    cards.started = null;
    cards.release = null;
    expect(await queue.processQueue(a), true);
    expect(cards.calls.map((c) => c['type']),
        ['create', 'update', 'review', 'delete']);
  });

  test('concurrent appends serialize without dropping actions', () async {
    await Future.wait(List.generate(
        20, (i) => push('complete-lesson', {'lessonId': '$i', 'score': 73})));
    final actions = await queue.getQueue();
    expect(actions, hasLength(20));
    expect(actions.map((a) => a.id).toSet(), hasLength(20));
    expect(actions.map((a) => a.payload['lessonId']),
        List.generate(20, (i) => '$i'));
  });

  test('mapping remains with its owner and resolves future local-ID mutations',
      () async {
    await push('create-flashcard', create);
    expect(await queue.processQueue(a), true);
    await login(b);
    expect(
        await queue.mutatePendingCard(
            'review-flashcard', {'id': 'local_123', 'score': 4},
            ownerNamespace: auth.localStorageNamespace),
        false);
    await auth.loginAsGuest();
    expect(
        await queue.mutatePendingCard(
            'review-flashcard', {'id': 'local_123', 'score': 4},
            ownerNamespace: 'local_guest'),
        false);
    await login();
    await restart();
    expect(
        await queue.mutatePendingCard(
            'review-flashcard', {'id': 'local_123', 'score': 4},
            ownerNamespace: owner),
        true);
    expect((await queue.getQueue()).single.payload['id'], 'mongo-real');
  });
}
