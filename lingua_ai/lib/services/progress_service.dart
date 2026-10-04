import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'auth_service.dart';
import 'progress_api_service.dart';
import '../core/localization/target_language_service.dart';
import 'connectivity_service.dart';
import 'offline_queue_service.dart';

class ProgressService extends ChangeNotifier {
  static final ProgressService _instance = ProgressService._internal();
  factory ProgressService() => _instance;
  ProgressService._internal();

  late SharedPreferences _prefs;
  final ProgressApiService _apiService = ProgressApiService();

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
    final session = AuthService().captureSession();
    final language = TargetLanguageService().currentLanguage;
    final version = TargetLanguageService().languageVersion;
    return () => session.isCurrent &&
        TargetLanguageService().currentLanguage == language &&
        TargetLanguageService().languageVersion == version;
  }

  String get currentLevel => getLevelFromXp(_totalXp);

  static String getLevelFromXp(int xp) {
    if (xp >= 2200) return 'Advanced';
    if (xp >= 1400) return 'Upper-Intermediate';
    if (xp >= 900) return 'Intermediate';
    if (xp >= 500) return 'Pre-Intermediate';
    if (xp >= 200) return 'Elementary';
    return 'Beginner';
  }

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
      for (final suffix in ['totalXp', 'streak', 'completedLessonIds', 'weeklyActivity'])
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
      for (final suffix in ['totalXp', 'streak', 'completedLessonIds', 'weeklyActivity']) {
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
    _totalXp = _prefs.getInt(_getScopedKey('totalXp')) ?? 0;
    _streak = _prefs.getInt(_getScopedKey('streak')) ?? 0;

    final savedIds = _prefs.getStringList(_getScopedKey('completedLessonIds'));
    if (savedIds != null) {
      _completedLessonIds = savedIds.toSet();
    }

    final savedActivity = _prefs.getStringList(_getScopedKey('weeklyActivity'));
    if (savedActivity != null) {
      _weeklyActivity =
          savedActivity.map((e) => double.tryParse(e) ?? 0.0).toList();
    } else {
      // Default placeholder activity if new user
      _weeklyActivity = [0.2, 0.5, 0.8, 0.4, 0.9, 0.3, 0.0];
    }

    // 3. If logged in (not guest), try to sync with backend
    final auth = AuthService();
    if (auth.isLoggedIn && !auth.isGuest) {
      syncWithBackend();
    }

    notifyListeners();
  }

  Future<void> syncWithBackend() async {
    final auth = AuthService();
    final isCurrent = _captureContext();
    final language = TargetLanguageService().currentLanguage;
    if (!auth.isLoggedIn || auth.isGuest) return;

    final userId = auth.currentUserId.isNotEmpty ? auth.currentUserId : auth.currentUserEmail;

    // Drain the offline queue first
    await OfflineQueueService().processQueue(userId);
    if (!isCurrent()) return;

    try {
      final langFullName = TargetLanguageService.toFullName(language);
      
      final response = await _apiService.getProgress(userId, langFullName);
      if (!isCurrent()) return;
      final stats = response['stats'];

      final completed = response['completedLessons'] as List?;
      final backendIds = <String>{};
      if (completed != null) {
        for (var item in completed) {
          backendIds.add(item['lessonId'].toString());
        }
      }

      // Sync any local offline completed lessons that are missing on the backend
      bool syncedAny = false;
      for (var localId in _completedLessonIds.toList()) {
        if (!isCurrent()) return;
        if (!backendIds.contains(localId)) {
          try {
            await _apiService.completeLesson(userId, localId, 100);
            if (!isCurrent()) return;
            syncedAny = true;
            debugPrint('Synced offline completion for lesson: $localId');
          } catch (err) {
            if (!isCurrent()) return;
            debugPrint('Failed to sync offline lesson $localId to backend: $err');
          }
        }
      }

      if (syncedAny) {
        final updatedResponse = await _apiService.getProgress(userId, langFullName);
        if (!isCurrent()) return;
        final updatedStats = updatedResponse['stats'];
        if (updatedStats != null) {
          _totalXp = updatedStats['totalXp'] as int? ?? 0;
          _streak = updatedStats['streak'] as int? ?? 0;
        }
        final updatedCompleted = updatedResponse['completedLessons'] as List?;
        _completedLessonIds.clear();
        if (updatedCompleted != null) {
          for (var item in updatedCompleted) {
            _completedLessonIds.add(item['lessonId'].toString());
          }
        }
      } else {
        if (stats != null) {
          _totalXp = stats['totalXp'] as int? ?? 0;
          _streak = stats['streak'] as int? ?? 0;
        }
        _completedLessonIds = backendIds;
      }

      _saveLocalData();
      notifyListeners();
    } catch (e) {
      debugPrint('Progress sync failed: $e');
    }
  }

  Future<void> completeLesson(String lessonId, int xpReward, {int score = 100}) async {
    final auth = AuthService();
    final isCurrent = _captureContext();
    final language = TargetLanguageService().currentLanguage;
    final ownerNamespace = auth.localStorageNamespace;

    if (!_completedLessonIds.contains(lessonId)) {
      final hasToken = auth.token.isNotEmpty;
      if ((auth.isLoggedIn && !auth.isGuest) || (auth.isGuest && hasToken)) {
        try {
          final userId = auth.currentUserId.isNotEmpty ? auth.currentUserId : auth.currentUserEmail;
          if (ConnectivityService().isOffline) {
            throw Exception('Device is offline');
          }
          await _apiService.completeLesson(userId, lessonId, score);
          if (!isCurrent()) return;
          
          final langFullName = TargetLanguageService.toFullName(language);
          final response = await _apiService.getProgress(userId, langFullName);
          if (!isCurrent()) return;
          final stats = response['stats'];
          if (stats != null) {
            _totalXp = stats['totalXp'] as int? ?? 0;
            _streak = stats['streak'] as int? ?? 0;
          }
          final completed = response['completedLessons'] as List?;
          _completedLessonIds.clear();
          if (completed != null) {
            for (var item in completed) {
              _completedLessonIds.add(item['lessonId'].toString());
            }
          }
          _saveLocalData();
          notifyListeners();
        } catch (e) {
          if (!isCurrent()) return;
          debugPrint('Backend progress update failed, falling back to local: $e');
          await OfflineQueueService().pushAction('complete-lesson', {
            'lessonId': lessonId,
            'score': score,
          }, ownerNamespace: ownerNamespace);
          if (!isCurrent()) return;
          _completedLessonIds.add(lessonId);
          _totalXp += xpReward;
          _saveLocalData();
          notifyListeners();
        }
      } else {
        _completedLessonIds.add(lessonId);
        _totalXp += xpReward;
        _saveLocalData();
        notifyListeners();
      }
    }
  }

  bool isLessonCompleted(String lessonId) {
    return _completedLessonIds.contains(lessonId);
  }

  void addXp(int amount) {
    _totalXp += amount;
    _saveLocalData();
    notifyListeners();
  }

  Future<void> _saveLocalData() async {
    final isCurrent = _captureContext();
    // Capture keys and values before yielding so a session change cannot split
    // this local write across two accounts.
    final xpKey = _getScopedKey('totalXp');
    final streakKey = _getScopedKey('streak');
    final lessonsKey = _getScopedKey('completedLessonIds');
    final activityKey = _getScopedKey('weeklyActivity');
    final xp = _totalXp;
    final streak = _streak;
    final lessonIds = _completedLessonIds.toList();
    final activity = _weeklyActivity.map((e) => e.toString()).toList();
    await _prefs.setInt(xpKey, xp);
    if (!isCurrent()) return;
    await _prefs.setInt(streakKey, streak);
    if (!isCurrent()) return;
    await _prefs.setStringList(
        lessonsKey, lessonIds);
    if (!isCurrent()) return;
    await _prefs.setStringList(
        activityKey, activity);
  }

  Future<void> resetProgress() async {
    final isCurrent = _captureContext();
    final keys = [
      for (final suffix in ['totalXp', 'streak', 'completedLessonIds', 'weeklyActivity'])
        _getScopedKey(suffix),
    ];
    _totalXp = 0;
    _streak = 0;
    _completedLessonIds.clear();
    _weeklyActivity = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];

    for (final key in keys) {
      if (!isCurrent()) return;
      await _prefs.remove(key);
    }

    if (!isCurrent()) return;
    notifyListeners();
  }
}
