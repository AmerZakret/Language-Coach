import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'auth_service.dart';
import 'flashcard_api_service.dart';
import 'srs_calculator.dart';
import '../models/flashcard.dart';
import '../core/localization/target_language_service.dart';
import 'connectivity_service.dart';
import 'offline_queue_service.dart';

class FlashcardService extends ChangeNotifier {
  static final FlashcardService _instance = FlashcardService._internal();
  factory FlashcardService() => _instance;
  FlashcardService._internal();

  late SharedPreferences _prefs;
  final FlashcardApiService _apiService = FlashcardApiService();

  List<Flashcard> _cards = [];

  bool Function() _captureContext() {
    final session = AuthService().captureSession();
    final language = TargetLanguageService().currentLanguage;
    final version = TargetLanguageService().languageVersion;
    return () => session.isCurrent &&
        TargetLanguageService().currentLanguage == language &&
        TargetLanguageService().languageVersion == version;
  }

  List<Flashcard> get allCards {
    final currentLang = TargetLanguageService().currentLanguage;
    final fullName = TargetLanguageService.toFullName(currentLang).toLowerCase();
    final shortName = currentLang.toLowerCase();

    return _cards.where((card) {
      final cardLang = card.targetLanguage.toLowerCase();
      return cardLang == shortName || cardLang == fullName;
    }).toList();
  }

  List<Flashcard> get dueCards {
    final now = DateTime.now();
    final currentLang = TargetLanguageService().currentLanguage;
    final fullName = TargetLanguageService.toFullName(currentLang).toLowerCase();
    final shortName = currentLang.toLowerCase();

    return _cards.where((card) {
      final cardLang = card.targetLanguage.toLowerCase();
      if (cardLang != shortName && cardLang != fullName) {
        return false;
      }
      return card.nextReviewDate.isBefore(now) || 
             card.nextReviewDate.year == now.year &&
             card.nextReviewDate.month == now.month &&
             card.nextReviewDate.day == now.day;
    }).toList();
  }

  String _getScopedKey(String suffix) {
    final auth = AuthService();
    final targetLang = TargetLanguageService();

    final userPart = auth.localStorageNamespace;

    String langPart = targetLang.currentLanguage;
    return 'flashcards_${userPart}_${langPart}_$suffix';
  }

  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
    await reloadFlashcards();
    
    // Set up listener to reload flashcards when authentication state or language changes
    AuthService().addListener(_onAuthChanged);
    TargetLanguageService().addListener(_onLanguageChanged);
    ConnectivityService().addListener(_onConnectivityChanged);
  }

  void _onAuthChanged() {
    reloadFlashcards();
  }

  void _onLanguageChanged() {
    reloadFlashcards();
  }

  void _onConnectivityChanged() {
    if (ConnectivityService().isOnline) {
      syncWithBackend();
    }
  }

  @override
  void dispose() {
    AuthService().removeListener(_onAuthChanged);
    TargetLanguageService().removeListener(_onLanguageChanged);
    ConnectivityService().removeListener(_onConnectivityChanged);
    super.dispose();
  }

  Future<void> reloadFlashcards() async {
    final isCurrent = _captureContext();
    final key = _getScopedKey('list');
    _cards = [];
    final legacyUserPart = AuthService().legacyRegisteredStorageNamespace;
    if (legacyUserPart != null) {
      final lang = TargetLanguageService().currentLanguage;
      final legacyKey = 'flashcards_${legacyUserPart}_${lang}_list';
      if (!_prefs.containsKey(key)) {
        final legacyJson = _prefs.getString(legacyKey);
        if (legacyJson != null) await _prefs.setString(key, legacyJson);
      }
      if (!isCurrent()) return;
      if (_prefs.containsKey(key)) await _prefs.remove(legacyKey);
    }
    if (!isCurrent()) return;
    final savedJson = _prefs.getString(key);
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
    final isCurrent = _captureContext();
    final key = _getScopedKey('list');
    final serialized = json.encode(_cards.map((c) => c.toJson()).toList());
    await _prefs.setString(key, serialized);
    if (isCurrent()) notifyListeners();
  }

  Future<void> syncWithBackend() async {
    final auth = AuthService();
    final isCurrent = _captureContext();
    final language = TargetLanguageService().currentLanguage;
    if (!auth.isLoggedIn || auth.isGuest) return;

    final userId = auth.currentUserId.isNotEmpty ? auth.currentUserId : auth.currentUserEmail;

    // 1. Drain the offline queue first
    await OfflineQueueService().processQueue(userId);
    if (!isCurrent()) return;

    if (ConnectivityService().isOffline) {
      debugPrint('FlashcardService: Offline, skipping backend fetch.');
      return;
    }

    try {
      final backendCards = await _apiService.getAllCards(
        userId,
        targetLanguage: language,
      );
      if (!isCurrent()) return;
      _cards = backendCards;
      await _saveLocal();
    } catch (e) {
      if (!isCurrent()) return;
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
    final isCurrent = _captureContext();
    final userId = auth.currentUserId.isNotEmpty ? auth.currentUserId : auth.currentUserEmail;
    final ownerNamespace = auth.localStorageNamespace;
    final targetLang = TargetLanguageService().currentLanguage;
    final localId = 'local_${DateTime.now().microsecondsSinceEpoch}';

    if (auth.isLoggedIn && !auth.isGuest) {
      if (ConnectivityService().isOffline) {
        debugPrint('Device is offline. Queueing createFlashcard.');
        await OfflineQueueService().pushAction('create-flashcard', {
          'tempId': localId,
          'userId': userId,
          'targetWord': targetWord,
          'turkishTranslation': turkishTranslation,
          'targetLanguage': targetLang,
          'exampleSentence': exampleSentence,
          'note': note,
        }, ownerNamespace: ownerNamespace);
        if (!isCurrent()) return;
        _createLocalCard(userId, targetWord, turkishTranslation, targetLang, exampleSentence, note, localId: localId);
        return;
      }

      try {
        final newCard = await _apiService.createFlashcard(
          userId,
          targetWord,
          turkishTranslation,
          targetLang,
          exampleSentence: exampleSentence,
          note: note,
        );
        if (!isCurrent()) return;
        _cards.add(newCard);
        await _saveLocal();
      } catch (e) {
        if (!isCurrent()) return;
        debugPrint('Failed to create flashcard on backend: $e. Queueing instead.');
        await OfflineQueueService().pushAction('create-flashcard', {
          'tempId': localId,
          'userId': userId,
          'targetWord': targetWord,
          'turkishTranslation': turkishTranslation,
          'targetLanguage': targetLang,
          'exampleSentence': exampleSentence,
          'note': note,
        }, ownerNamespace: ownerNamespace);
        if (!isCurrent()) return;
        _createLocalCard(userId, targetWord, turkishTranslation, targetLang, exampleSentence, note, localId: localId);
      }
    } else {
      _createLocalCard(userId, targetWord, turkishTranslation, targetLang, exampleSentence, note, localId: localId);
    }
  }

  void _createLocalCard(
    String userId,
    String targetWord,
    String turkishTranslation,
    String targetLang,
    String? exampleSentence,
    String? note, {
    String? localId,
  }) {
    final finalId = localId ?? 'local_${DateTime.now().microsecondsSinceEpoch}';
    final newCard = Flashcard(
      id: finalId,
      userId: userId,
      targetWord: targetWord,
      turkishTranslation: turkishTranslation,
      targetLanguage: targetLang,
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
    final isCurrent = _captureContext();
    final isLocal = cardId.startsWith('local_') || auth.isGuest || !auth.isLoggedIn;
    final ownerNamespace = auth.localStorageNamespace;
    final targetLang = TargetLanguageService().currentLanguage;

    if (!isLocal) {
      if (ConnectivityService().isOffline) {
        debugPrint('Device is offline. Queueing updateFlashcard.');
        await OfflineQueueService().pushAction('update-flashcard', {
          'id': cardId,
          'targetWord': targetWord,
          'turkishTranslation': turkishTranslation,
          'targetLanguage': targetLang,
          'exampleSentence': exampleSentence,
          'note': note,
        }, ownerNamespace: ownerNamespace);
        if (!isCurrent()) return;
        _updateLocalCard(cardId, targetWord, turkishTranslation, targetLang, exampleSentence, note);
        return;
      }

      try {
        final updatedCard = await _apiService.updateFlashcard(
          cardId,
          targetWord,
          turkishTranslation,
          targetLanguage: targetLang,
          exampleSentence: exampleSentence,
          note: note,
        );
        if (!isCurrent()) return;
        final index = _cards.indexWhere((c) => c.id == cardId);
        if (index != -1) {
          _cards[index] = updatedCard;
        }
        await _saveLocal();
        return;
      } catch (e) {
        if (!isCurrent()) return;
        debugPrint('Failed to update flashcard on backend: $e. Queueing update.');
        await OfflineQueueService().pushAction('update-flashcard', {
          'id': cardId,
          'targetWord': targetWord,
          'turkishTranslation': turkishTranslation,
          'targetLanguage': targetLang,
          'exampleSentence': exampleSentence,
          'note': note,
        }, ownerNamespace: ownerNamespace);
        if (!isCurrent()) return;
      }
    }

    // Local update
    _updateLocalCard(cardId, targetWord, turkishTranslation, targetLang, exampleSentence, note);
  }

  void _updateLocalCard(
    String cardId,
    String targetWord,
    String turkishTranslation,
    String targetLang,
    String? exampleSentence,
    String? note,
  ) async {
    final index = _cards.indexWhere((c) => c.id == cardId);
    if (index != -1) {
      final oldCard = _cards[index];
      _cards[index] = oldCard.copyWith(
        targetWord: targetWord,
        turkishTranslation: turkishTranslation,
        targetLanguage: targetLang,
        exampleSentence: exampleSentence,
        note: note,
      );
      await _saveLocal();
    }
  }

  Future<void> deleteFlashcard(String cardId) async {
    final auth = AuthService();
    final isCurrent = _captureContext();
    final ownerNamespace = auth.localStorageNamespace;
    final isLocal = cardId.startsWith('local_') || auth.isGuest || !auth.isLoggedIn;

    if (!isLocal) {
      if (ConnectivityService().isOffline) {
        debugPrint('Device is offline. Queueing deleteFlashcard.');
        await OfflineQueueService().pushAction('delete-flashcard', {
          'id': cardId,
        }, ownerNamespace: ownerNamespace);
        if (!isCurrent()) return;
        _deleteLocalCard(cardId);
        return;
      }

      try {
        await _apiService.deleteFlashcard(cardId);
        if (!isCurrent()) return;
        _deleteLocalCard(cardId);
        return;
      } catch (e) {
        if (!isCurrent()) return;
        debugPrint('Failed to delete flashcard on backend: $e. Queueing delete.');
        await OfflineQueueService().pushAction('delete-flashcard', {
          'id': cardId,
        }, ownerNamespace: ownerNamespace);
        if (!isCurrent()) return;
      }
    }

    // Local delete
    _deleteLocalCard(cardId);
  }

  void _deleteLocalCard(String cardId) async {
    _cards.removeWhere((c) => c.id == cardId);
    await _saveLocal();
  }

  Future<void> reviewCard(Flashcard card, int score) async {
    final auth = AuthService();
    final isCurrent = _captureContext();
    final ownerNamespace = auth.localStorageNamespace;
    final isLocal = card.id.startsWith('local_') || auth.isGuest || !auth.isLoggedIn;

    if (!isLocal) {
      if (ConnectivityService().isOffline) {
        debugPrint('Device is offline. Queueing reviewCard.');
        await OfflineQueueService().pushAction('review-flashcard', {
          'id': card.id,
          'score': score,
        }, ownerNamespace: ownerNamespace);
        if (!isCurrent()) return;
        _reviewLocalCard(card, score);
        return;
      }

      try {
        final updatedCard = await _apiService.reviewCard(card.id, score);
        if (!isCurrent()) return;
        final index = _cards.indexWhere((c) => c.id == card.id);
        if (index != -1) {
          _cards[index] = updatedCard;
        } else {
          _cards.add(updatedCard);
        }
        await _saveLocal();
        return;
      } catch (e) {
        if (!isCurrent()) return;
        debugPrint('Failed to submit review to backend: $e. Queueing review.');
        await OfflineQueueService().pushAction('review-flashcard', {
          'id': card.id,
          'score': score,
        }, ownerNamespace: ownerNamespace);
        if (!isCurrent()) return;
      }
    }

    // Local review calculation
    _reviewLocalCard(card, score);
  }

  void _reviewLocalCard(Flashcard card, int score) async {
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
