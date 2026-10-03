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

    final userId = auth.currentUserId.isNotEmpty ? auth.currentUserId : auth.currentUserEmail;

    // Drain the offline queue first
    await OfflineQueueService().processQueue(userId);

    try {
      final targetLang = TargetLanguageService();
      final langFullName = TargetLanguageService.toFullName(targetLang.currentLanguage);
      
      final response = await _apiService.getProgress(userId, langFullName);
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
      for (var localId in _completedLessonIds) {
        if (!backendIds.contains(localId)) {
          try {
            await _apiService.completeLesson(userId, localId, 100);
            syncedAny = true;
            debugPrint('Synced offline completion for lesson: $localId');
          } catch (err) {
            debugPrint('Failed to sync offline lesson $localId to backend: $err');
          }
        }
      }

      if (syncedAny) {
        final updatedResponse = await _apiService.getProgress(userId, langFullName);
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

  void completeLesson(String lessonId, int xpReward, {int score = 100}) async {
    final auth = AuthService();

    if (!_completedLessonIds.contains(lessonId)) {
      final hasToken = auth.token.isNotEmpty;
      if ((auth.isLoggedIn && !auth.isGuest) || (auth.isGuest && hasToken)) {
        try {
          final userId = auth.currentUserId.isNotEmpty ? auth.currentUserId : auth.currentUserEmail;
          if (ConnectivityService().isOffline) {
            throw Exception('Device is offline');
          }
          await _apiService.completeLesson(userId, lessonId, score);
          
          final targetLang = TargetLanguageService();
          final langFullName = TargetLanguageService.toFullName(targetLang.currentLanguage);
          final response = await _apiService.getProgress(userId, langFullName);
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
          debugPrint('Backend progress update failed, falling back to local: $e');
          await OfflineQueueService().pushAction('complete-lesson', {
            'lessonId': lessonId,
            'score': score,
          });
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
