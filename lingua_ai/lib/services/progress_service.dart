import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'auth_service.dart';
import 'progress_api_service.dart';
import '../core/localization/target_language_service.dart';
import 'connectivity_service.dart';
import 'offline_queue_service.dart';
import 'progress_cache.dart';
import 'xp_level.dart';

class ProgressService extends ChangeNotifier {
  static final ProgressService _instance = ProgressService._internal();
  factory ProgressService() => _instance;
  ProgressService._internal();

  late SharedPreferences _prefs;
  final ProgressApiService _apiService = ProgressApiService();

  int _resetRevision = 0;
  int _requestRevision = 0;
  int _totalXp = 0;
  int _streak = 0;
  Set<String> _completedLessonIds = {};
  List<double> _weeklyActivity = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];

  int get totalXp => _totalXp;
  int get streak => _streak;
  int get completedLessonsCount => _completedLessonIds.length;
  Set<String> get completedLessonIds => _completedLessonIds;
  List<double> get weeklyActivity => _weeklyActivity;

  bool Function() _captureContext() {
    final reset = _resetRevision;
    final session = AuthService().captureSession();
    final language = TargetLanguageService().currentLanguage;
    final version = TargetLanguageService().languageVersion;
    return () =>
        reset == _resetRevision &&
        session.isCurrent &&
        TargetLanguageService().currentLanguage == language &&
        TargetLanguageService().languageVersion == version;
  }

  String get currentLevel => getLevelFromXp(_totalXp);

  static String getLevelFromXp(int xp) => XpLevels.levelFromXp(xp);

  // Scopes keys by authenticated identity (or local guest) and target language.
  String _getScopedKey(String suffix) {
    final auth = AuthService();
    final targetLang = TargetLanguageService();

    final userPart = auth.localStorageNamespace;

    // Language part
    String langPart = targetLang.currentLanguage;

    return 'progress_${userPart}_${langPart}_$suffix';
  }

  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
    await reloadProgress();
    ConnectivityService().addListener(_onConnectivityChanged);
    AuthService().addListener(_onAuthChanged);
  }

  void _onConnectivityChanged() {
    if (ConnectivityService().isOnline) {
      syncWithBackend();
    }
  }

  void _onAuthChanged() {
    reloadProgress();
  }

  @override
  void dispose() {
    ConnectivityService().removeListener(_onConnectivityChanged);
    AuthService().removeListener(_onAuthChanged);
    super.dispose();
  }

  // Resets in-memory state and reloads from SharedPreferences for current user/language
  Future<void> reloadProgress() async {
    final isCurrent = _captureContext();
    final scopedKeys = {
      for (final suffix in [
        'totalXp',
        'streak',
        'completedLessonIds',
        'weeklyActivity'
      ])
        suffix: _getScopedKey(suffix),
    };
    // 1. Reset in-memory state
    _totalXp = 0;
    _streak = 0;
    _completedLessonIds = {};
    _weeklyActivity = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];

    // 2. Load from scoped keys
    final legacyUserPart = AuthService().legacyRegisteredStorageNamespace;
    if (legacyUserPart != null) {
      final lang = TargetLanguageService().currentLanguage;
      for (final suffix in [
        'totalXp',
        'streak',
        'completedLessonIds',
        'weeklyActivity'
      ]) {
        if (!isCurrent()) return;
        final key = scopedKeys[suffix]!;
        final legacyKey = 'progress_${legacyUserPart}_${lang}_$suffix';
        if (!_prefs.containsKey(key)) {
          final value = _prefs.get(legacyKey);
          if (value is int) await _prefs.setInt(key, value);
          if (value is List<String>) await _prefs.setStringList(key, value);
        }
        // Retiring the old key prevents a later reset from restoring old data.
        if (!isCurrent()) return;
        if (_prefs.containsKey(key)) await _prefs.remove(legacyKey);
      }
    }
    // Another auth/language listener may have reloaded while migration yielded.
    if (!isCurrent()) return;
    await _refreshDisplay(isCurrent);
    if (!isCurrent()) return;
    final auth = AuthService();
    if (auth.token.isNotEmpty && ConnectivityService().isOnline) {
      syncWithBackend();
    }
  }

  Future<void> _refreshDisplay(bool Function() isCurrent) async {
    final owner = AuthService().localStorageNamespace;
    final language = TargetLanguageService().currentLanguage;
    await OfflineQueueService().preparePendingProgress(owner);
    if (!isCurrent()) return;
    final actions = await OfflineQueueService().getProgressActions();
    if (!isCurrent()) return;
    final base = ProgressSnapshot.read(_prefs, owner, language);
    final current = base.overlay(
        actions
            .where((a) =>
                a.ownerNamespace == owner &&
                a.type == 'complete-lesson' &&
                a.payload['targetLanguage'] == language)
            .map((a) => a.payload),
        reset: actions.any(
            (a) => a.ownerNamespace == owner && a.type == 'reset-progress'));
    _totalXp = current.totalXp;
    _streak = current.streak;
    _completedLessonIds = current.lessonIds;
    _weeklyActivity = current.activity;
    notifyListeners();
  }

  Future<void> syncWithBackend() async {
    final auth = AuthService();
    final contextCurrent = _captureContext();
    final request = ++_requestRevision;
    bool isCurrent() => contextCurrent() && request == _requestRevision;
    final owner = auth.localStorageNamespace;
    final language = TargetLanguageService().currentLanguage;
    if (auth.token.isEmpty) return;
    final userId = auth.currentUserId.isNotEmpty
        ? auth.currentUserId
        : auth.currentUserEmail;
    final queue = OfflineQueueService();
    try {
      await queue.processQueue(userId, waitForActive: true);
      if (!isCurrent()) return;
      final revision = await queue.progressRevision(owner);
      if (!isCurrent()) return;
      final response = await _apiService.getProgress(userId, language);
      if (!isCurrent()) return;
      await queue.saveServerProgress(
          owner, language, revision, ProgressSnapshot.fromServer(response),
          isCurrent: isCurrent);
      if (!isCurrent()) return;
    } catch (e) {
      if (!isCurrent()) return;
      debugPrint('Progress sync failed: $e');
    }
    await _refreshDisplay(isCurrent);
  }

  Future<void> completeLesson(String lessonId, int xpReward,
      {int score = 100}) async {
    final auth = AuthService();
    final isCurrent = _captureContext();
    final owner = auth.localStorageNamespace;
    final language = TargetLanguageService().currentLanguage;
    final queue = OfflineQueueService();
    if (_completedLessonIds.contains(lessonId)) return;
    if (auth.token.isNotEmpty) {
      final epoch = await queue.epochForNewProgress(owner);
      if (!isCurrent()) return;
      // Persist the score, reward and language before the first request. The
      // queue supplies the same operation ID on every ambiguous retry.
      await queue.pushAction(
          'complete-lesson',
          {
            'lessonId': lessonId,
            'score': score,
            'progressEpoch': epoch,
            'xpReward': xpReward,
            'targetLanguage': language,
          },
          ownerNamespace: owner);
    } else {
      await queue.modifyLocalProgress(
          owner,
          language,
          (base) => base.overlay([
                {'lessonId': lessonId, 'xpReward': xpReward}
              ]));
    }
    if (!isCurrent()) return;
    await _refreshDisplay(isCurrent);
    if (isCurrent() &&
        auth.token.isNotEmpty &&
        ConnectivityService().isOnline) {
      await syncWithBackend();
    }
  }

  bool isLessonCompleted(String lessonId) {
    return _completedLessonIds.contains(lessonId);
  }

  Future<void> resetProgress() async {
    ++_resetRevision;
    ++_requestRevision;
    final isCurrent = _captureContext();
    final auth = AuthService();
    final owner = auth.localStorageNamespace;
    if (auth.token.isNotEmpty) {
      final epoch = await OfflineQueueService()
          .epochForNewProgress(owner, forReset: true);
      if (!isCurrent()) return;
      await OfflineQueueService().pushAction(
          'reset-progress',
          {
            'expectedEpoch': epoch,
            'legacyOwnerNamespace': auth.legacyRegisteredStorageNamespace,
          },
          ownerNamespace: owner);
    } else {
      await ProgressSnapshot.resetOwner(_prefs, owner);
      final legacyOwner = auth.legacyRegisteredStorageNamespace;
      if (legacyOwner != null) {
        await ProgressSnapshot.resetOwner(_prefs, legacyOwner);
      }
    }
    if (!isCurrent()) return;
    await _refreshDisplay(isCurrent);
    if (isCurrent() &&
        auth.token.isNotEmpty &&
        ConnectivityService().isOnline) {
      await syncWithBackend();
    }
  }
}
