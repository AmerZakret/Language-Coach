import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'auth_service.dart';
import 'flashcard_api_service.dart';
import 'srs_calculator.dart';
import '../models/flashcard.dart';
import '../core/localization/target_language_service.dart';

class FlashcardService extends ChangeNotifier {
  static final FlashcardService _instance = FlashcardService._internal();
  factory FlashcardService() => _instance;
  FlashcardService._internal();

  late SharedPreferences _prefs;
  final FlashcardApiService _apiService = FlashcardApiService();

  List<Flashcard> _cards = [];

  List<Flashcard> get allCards => _cards;

  List<Flashcard> get dueCards {
    final now = DateTime.now();
    // A card is due if nextReviewDate is before or equal to now (or close enough)
    return _cards.where((card) {
      // Set to midnight/time comparison
      return card.nextReviewDate.isBefore(now) || 
             card.nextReviewDate.year == now.year &&
             card.nextReviewDate.month == now.month &&
             card.nextReviewDate.day == now.day;
    }).toList();
  }

  String _getScopedKey(String suffix) {
    final auth = AuthService();
    final targetLang = TargetLanguageService();

    String userPart = 'guest';
    if (auth.isLoggedIn && auth.currentUserEmail.isNotEmpty) {
      userPart = auth.currentUserEmail.replaceAll('.', '_').replaceAll('@', '_');
    }

    String langPart = targetLang.currentLanguage;
    return 'flashcards_${userPart}_${langPart}_$suffix';
  }

  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
    await reloadFlashcards();
    
    // Set up listener to reload flashcards when authentication state or language changes
    AuthService().addListener(_onAuthChanged);
    TargetLanguageService().addListener(_onLanguageChanged);
  }

  void _onAuthChanged() {
    reloadFlashcards();
  }

  void _onLanguageChanged() {
    reloadFlashcards();
  }

  @override
  void dispose() {
    AuthService().removeListener(_onAuthChanged);
    TargetLanguageService().removeListener(_onLanguageChanged);
    super.dispose();
  }

  Future<void> reloadFlashcards() async {
    _cards = [];
    final savedJson = _prefs.getString(_getScopedKey('list'));
    if (savedJson != null) {
      try {
        final List decoded = json.decode(savedJson);
        _cards = decoded.map((item) => Flashcard.fromJson(item)).toList();
      } catch (e) {
        debugPrint('Error decoding cached flashcards: $e');
      }
    }

    final auth = AuthService();
    if (auth.isLoggedIn && !auth.isGuest) {
      syncWithBackend();
    } else {
      notifyListeners();
    }
  }

  Future<void> _saveLocal() async {
    final serialized = json.encode(_cards.map((c) => c.toJson()).toList());
    await _prefs.setString(_getScopedKey('list'), serialized);
    notifyListeners();
  }

  Future<void> syncWithBackend() async {
    final auth = AuthService();
    if (!auth.isLoggedIn || auth.isGuest) return;

    final userId = auth.currentUserId.isNotEmpty ? auth.currentUserId : auth.currentUserEmail;
    try {
      final backendCards = await _apiService.getAllCards(userId);
      _cards = backendCards;
      await _saveLocal();
    } catch (e) {
      debugPrint('Flashcard sync failed: $e');
      notifyListeners(); // Ensure UI still refreshes with cached state
    }
  }

  Future<void> createFlashcard(
    String targetWord,
    String turkishTranslation, {
    String? exampleSentence,
    String? note,
  }) async {
    final auth = AuthService();
    final userId = auth.currentUserId.isNotEmpty ? auth.currentUserId : auth.currentUserEmail;

    if (auth.isLoggedIn && !auth.isGuest) {
      try {
        final newCard = await _apiService.createFlashcard(
          userId,
          targetWord,
          turkishTranslation,
          exampleSentence: exampleSentence,
          note: note,
        );
        _cards.add(newCard);
        await _saveLocal();
      } catch (e) {
        debugPrint('Failed to create flashcard on backend: $e. Falling back to local.');
        _createLocalCard(userId, targetWord, turkishTranslation, exampleSentence, note);
      }
    } else {
      _createLocalCard(userId, targetWord, turkishTranslation, exampleSentence, note);
    }
  }

  void _createLocalCard(
    String userId,
    String targetWord,
    String turkishTranslation,
    String? exampleSentence,
    String? note,
  ) {
    final localId = 'local_${DateTime.now().millisecondsSinceEpoch}';
    final newCard = Flashcard(
      id: localId,
      userId: userId,
      targetWord: targetWord,
      turkishTranslation: turkishTranslation,
      exampleSentence: exampleSentence,
      note: note,
      interval: 0,
      easinessFactor: 2.5,
      nextReviewDate: DateTime.now(),
      reviewCount: 0,
      history: [],
      aiContext: FlashcardAiContext(
        sentences: exampleSentence != null && exampleSentence.isNotEmpty ? [exampleSentence] : ['Local example sentence.'],
        mnemonic: note != null && note.isNotEmpty ? note : 'Local association.',
      ),
    );
    _cards.add(newCard);
    _saveLocal();
  }

  Future<void> updateFlashcard(
    String cardId,
    String targetWord,
    String turkishTranslation, {
    String? exampleSentence,
    String? note,
  }) async {
    final auth = AuthService();
    final isLocal = cardId.startsWith('local_') || auth.isGuest || !auth.isLoggedIn;

    if (!isLocal) {
      try {
        final updatedCard = await _apiService.updateFlashcard(
          cardId,
          targetWord,
          turkishTranslation,
          exampleSentence: exampleSentence,
          note: note,
        );
        final index = _cards.indexWhere((c) => c.id == cardId);
        if (index != -1) {
          _cards[index] = updatedCard;
        }
        await _saveLocal();
        return;
      } catch (e) {
        debugPrint('Failed to update flashcard on backend: $e. Falling back to local update.');
      }
    }

    // Local update
    final index = _cards.indexWhere((c) => c.id == cardId);
    if (index != -1) {
      final oldCard = _cards[index];
      _cards[index] = oldCard.copyWith(
        targetWord: targetWord,
        turkishTranslation: turkishTranslation,
        exampleSentence: exampleSentence,
        note: note,
      );
      await _saveLocal();
    }
  }

  Future<void> deleteFlashcard(String cardId) async {
    final auth = AuthService();
    final isLocal = cardId.startsWith('local_') || auth.isGuest || !auth.isLoggedIn;

    if (!isLocal) {
      try {
        await _apiService.deleteFlashcard(cardId);
        _cards.removeWhere((c) => c.id == cardId);
        await _saveLocal();
        return;
      } catch (e) {
        debugPrint('Failed to delete flashcard on backend: $e. Falling back to local delete.');
      }
    }

    // Local delete
    _cards.removeWhere((c) => c.id == cardId);
    await _saveLocal();
  }

  Future<void> reviewCard(Flashcard card, int score) async {
    final auth = AuthService();
    // If it's a local card (starts with 'local_'), or we are offline/guest, we update it locally.
    final isLocal = card.id.startsWith('local_') || auth.isGuest || !auth.isLoggedIn;

    if (!isLocal) {
      try {
        final updatedCard = await _apiService.reviewCard(card.id, score);
        final index = _cards.indexWhere((c) => c.id == card.id);
        if (index != -1) {
          _cards[index] = updatedCard;
        } else {
          _cards.add(updatedCard);
        }
        await _saveLocal();
        return;
      } catch (e) {
        debugPrint('Failed to submit review to backend: $e. Falling back to local calculation.');
      }
    }

    // Local review calculation
    final srsResult = SrsCalculator.calculate(card.easinessFactor, card.interval, score);
    final historyItem = FlashcardHistory(date: DateTime.now(), score: score);
    final updatedCard = card.copyWith(
      interval: srsResult.newInterval,
      easinessFactor: srsResult.newEf,
      nextReviewDate: srsResult.nextReviewDate,
      reviewCount: card.reviewCount + 1,
      history: [...card.history, historyItem],
    );

    final index = _cards.indexWhere((c) => c.id == card.id);
    if (index != -1) {
      _cards[index] = updatedCard;
    } else {
      _cards.add(updatedCard);
    }
    await _saveLocal();
  }
}
