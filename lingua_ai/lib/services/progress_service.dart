import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'auth_service.dart';
import 'progress_api_service.dart';
import '../core/localization/target_language_service.dart';

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

  String get currentLevel => getLevelFromXp(_totalXp);

  static String getLevelFromXp(int xp) {
    if (xp >= 2200) return 'Advanced';
    if (xp >= 1400) return 'Upper-Intermediate';
    if (xp >= 900) return 'Intermediate';
    if (xp >= 500) return 'Pre-Intermediate';
    if (xp >= 200) return 'Elementary';
    return 'Beginner';
  }

  // Scopes keys by user (email or guest) and target language
  String _getScopedKey(String suffix) {
    final auth = AuthService();
    final targetLang = TargetLanguageService();
    
    // Identity part
    String userPart = 'guest';
    if (auth.isLoggedIn && auth.currentUserEmail.isNotEmpty) {
      userPart = auth.currentUserEmail.replaceAll('.', '_').replaceAll('@', '_');
    }
    
    // Language part
    String langPart = targetLang.currentLanguage;
    
    return 'progress_${userPart}_${langPart}_$suffix';
  }

  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
    await reloadProgress();
  }

  // Resets in-memory state and reloads from SharedPreferences for current user/language
  Future<void> reloadProgress() async {
    // 1. Reset in-memory state
    _totalXp = 0;
    _streak = 0;
    _completedLessonIds = {};
    _weeklyActivity = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];

    // 2. Load from scoped keys
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
    if (!auth.isLoggedIn || auth.isGuest) return;

    try {
      final response = await _apiService.getProgress(auth.currentUserId.isNotEmpty ? auth.currentUserId : auth.currentUserEmail);
      final stats = response['stats'];

      if (stats != null) {
        // Take the HIGHER value so local progress is never lost
        final backendXp = stats['totalXp'] as int? ?? 0;
        if (backendXp > _totalXp) {
          _totalXp = backendXp;
        }
        final backendStreak = stats['streak'] as int? ?? 0;
        if (backendStreak > _streak) {
          _streak = backendStreak;
        }
      }

      final completed = response['completedLessons'] as List?;
      if (completed != null) {
        for (var item in completed) {
          _completedLessonIds.add(item['lessonId'].toString());
        }
      }

      _saveLocalData();
      notifyListeners();
    } catch (e) {
      debugPrint('Progress sync failed: $e');
    }
  }

  void completeLesson(String lessonId, int xpReward, {int score = 100}) async {
    final auth = AuthService();

    // Always update local state first for instant feedback
    if (!_completedLessonIds.contains(lessonId)) {
      _completedLessonIds.add(lessonId);
      _totalXp += xpReward;
      _saveLocalData();
      notifyListeners();

      // If logged in and NOT guest, or if guest WITH a token, sync to backend
      final hasToken = auth.token.isNotEmpty;
      if ((auth.isLoggedIn && !auth.isGuest) || (auth.isGuest && hasToken)) {
        try {
          await _apiService.completeLesson(
            auth.currentUserId.isNotEmpty ? auth.currentUserId : auth.currentUserEmail,
            lessonId,
            score,
          );
        } catch (e) {
          debugPrint('Backend progress update failed: $e');
        }
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
    await _prefs.setInt(_getScopedKey('totalXp'), _totalXp);
    await _prefs.setInt(_getScopedKey('streak'), _streak);
    await _prefs.setStringList(
        _getScopedKey('completedLessonIds'), _completedLessonIds.toList());
    await _prefs.setStringList(
        _getScopedKey('weeklyActivity'), _weeklyActivity.map((e) => e.toString()).toList());
  }

  Future<void> resetProgress() async {
    _totalXp = 0;
    _streak = 0;
    _completedLessonIds.clear();
    _weeklyActivity = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];

    await _prefs.remove(_getScopedKey('totalXp'));
    await _prefs.remove(_getScopedKey('streak'));
    await _prefs.remove(_getScopedKey('completedLessonIds'));
    await _prefs.remove(_getScopedKey('weeklyActivity'));

    notifyListeners();
  }
}
