import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/flashcard_service.dart';
import 'package:lingua_ai/services/progress_service.dart';
import 'package:lingua_ai/services/offline_queue_service.dart';
import 'package:lingua_ai/services/srs_calculator.dart';
import 'package:lingua_ai/services/connectivity_service.dart';
import 'package:lingua_ai/core/localization/target_language_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final auth = AuthService();
  final cards = FlashcardService();
  final queue = OfflineQueueService();
  late SharedPreferences prefs;
  Future<void> settle() async {
    for (var i = 0; i < 8; i++) {
      await Future<void>.delayed(Duration.zero);
    }
  }

  setUpAll(() async {
    // Unsent-create compaction needs an actually offline device, rather than
    // an ambiguous HTTP failure after a create may already have reached MongoDB.
    final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
        const MethodChannel('dev.fluttercommunity.plus/connectivity'),
        (call) async => 'none');
    messenger.setMockMethodCallHandler(
        const MethodChannel('dev.fluttercommunity.plus/connectivity_status'),
        (call) async => null);
    await ConnectivityService().init();
    SharedPreferences.setMockInitialValues({});
    await auth.init();
    await TargetLanguageService().init();
    await ProgressService().init();
    await cards.init();
    prefs = await SharedPreferences.getInstance();
  });
  tearDownAll(() => ConnectivityService().dispose());
  setUp(() async {
    await prefs.clear();
    await auth.setGuestSession(
        id: '507f1f77bcf86cd799439011',
        email: 'guest-a@guest.lingua.local',
        token: 'test-a');
    await TargetLanguageService().setLanguage('en', syncToBackend: false);
    await settle();
  });
  Future<void> offline(Future<void> Function() work) => http.runWithClient(work,
      () => MockClient((request) async => http.Response('Unavailable', 503)));

  test(
      'Flutter service edits pending backend guest create instead of treating it as permanent local',
      () async {
    await offline(() async {
      await cards.createFlashcard('old', 'translation');
      await settle();
    });
    final id = cards.allCards.single.id;
    await cards.updateFlashcard(id, 'latest', 'new translation',
        note: 'new note');
    await settle();
    final action = (await queue.getQueue()).single;
    expect(action.type, 'create-flashcard');
    expect(action.payload['targetWord'], 'latest');
    expect(action.payload['turkishTranslation'], 'new translation');
    expect(action.payload['note'], 'new note');
    final cacheKey = 'flashcards_${auth.localStorageNamespace}_en_list';
    expect(
        jsonDecode(prefs.getString(cacheKey)!).single['targetWord'], 'latest');
  });
  test('Flutter service delete cancels pending create and reviews', () async {
    await offline(() async {
      await cards.createFlashcard('word', 'translation');
      await settle();
    });
    final card = cards.allCards.single;
    await cards.reviewCard(card, 4);
    await cards.deleteFlashcard(card.id);
    await settle();
    expect(cards.allCards, isEmpty);
    expect(await queue.getQueue(), isEmpty);
  });
  test('omitted pending edit fields preserve notes and examples, while empty values clear them', () async {
    await offline(() async {
      await cards.createFlashcard('word', 'translation', exampleSentence: 'saved example', note: 'saved note');
      await settle();
    });
    final id = cards.allCards.single.id;
    await cards.updateFlashcard(id, 'changed', 'translation');
    await settle();
    expect((await queue.getQueue()).single.payload['note'], 'saved note');
    expect((await queue.getQueue()).single.payload['exampleSentence'], 'saved example');
    expect(cards.allCards.single.note, 'saved note');
    await cards.updateFlashcard(id, 'changed', 'translation', exampleSentence: '', note: '');
    await settle();
    expect((await queue.getQueue()).single.payload['note'], '');
    expect((await queue.getQueue()).single.payload['exampleSentence'], '');
    expect(cards.allCards.single.note, '');
  });
  test(
      'Flutter service review preserves dependency and unchanged SRS calculation',
      () async {
    await offline(() async {
      await cards.createFlashcard('word', 'translation');
      await settle();
    });
    final original = cards.allCards.single;
    final expected =
        SrsCalculator.calculate(original.easinessFactor, original.interval, 4);
    await cards.reviewCard(original, 4);
    await settle();
    final actions = await queue.getQueue();
    expect(
        actions.map((a) => a.type), ['create-flashcard', 'review-flashcard']);
    expect(actions.last.payload, {'id': original.id, 'score': 4});
    final reviewed = cards.allCards.single;
    expect(reviewed.interval, expected.newInterval);
    expect(reviewed.easinessFactor, expected.newEf);
    expect(reviewed.reviewCount, original.reviewCount + 1);
    expect(reviewed.history.last.score, 4);
  });
  test(
      'permanently local guest edits reviews deletes never enqueue backend mutations',
      () async {
    await auth.loginAsGuest();
    await settle();
    await cards.createFlashcard('local', 'translation');
    await settle();
    final id = cards.allCards.single.id;
    await cards.updateFlashcard(id, 'edited', 'translation');
    await cards.reviewCard(cards.allCards.single, 4);
    await cards.deleteFlashcard(id);
    await settle();
    expect(await queue.getQueue(), isEmpty);
    expect(cards.allCards, isEmpty);
  });
}
