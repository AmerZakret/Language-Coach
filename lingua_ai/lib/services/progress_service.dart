import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'auth_service.dart';
import 'progress_api_service.dart';

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

  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();

    // Load local fallback data
    _totalXp = _prefs.getInt('totalXp') ?? 0;
    _streak = _prefs.getInt('streak') ?? 0;

    final savedIds = _prefs.getStringList('completedLessonIds');
    if (savedIds != null) {
      _completedLessonIds = savedIds.toSet();
    }

    final savedActivity = _prefs.getStringList('weeklyActivity');
    if (savedActivity != null) {
      _weeklyActivity =
          savedActivity.map((e) => double.tryParse(e) ?? 0.0).toList();
    } else {
      _weeklyActivity = [0.2, 0.5, 0.8, 0.4, 0.9, 0.3, 0.0];
    }

    // If logged in, try to sync with backend
    if (AuthService().isLoggedIn) {
      syncWithBackend();
    }

    notifyListeners();
  }

  Future<void> syncWithBackend() async {
    final auth = AuthService();
    if (!auth.isLoggedIn) return;

    try {
      final response = await _apiService.getProgress(auth.currentUserEmail);
      final stats = response['stats'];

      if (stats != null) {
        _totalXp = stats['totalXp'] ?? _totalXp;
        _streak = stats['streak'] ?? _streak;
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

  void completeLesson(String lessonId, int xpReward) async {
    final auth = AuthService();

    // Always update local state first for instant feedback
    if (!_completedLessonIds.contains(lessonId)) {
      _completedLessonIds.add(lessonId);
      _totalXp += xpReward;
      _saveLocalData();
      notifyListeners();

      // If logged in, sync to backend
      if (auth.isLoggedIn) {
        try {
          final response = await _apiService.completeLesson(
            auth.currentUserEmail,
            lessonId,
            100, // Placeholder score
          );

          // Update state from backend response if it contains new totals
          final data = response['data'];
          if (data != null) {
            _totalXp = data['newTotalXp'] ?? _totalXp;
            _saveLocalData();
            notifyListeners();
          }
        } catch (e) {
          debugPrint('Backend progress update failed: $e');
        }
      }
    }
  }

  bool isLessonCompleted(String lessonId) {
    return _completedLessonIds.contains(lessonId);
  }

  Future<void> _saveLocalData() async {
    await _prefs.setInt('totalXp', _totalXp);
    await _prefs.setInt('streak', _streak);
    await _prefs.setStringList(
        'completedLessonIds', _completedLessonIds.toList());
    await _prefs.setStringList(
        'weeklyActivity', _weeklyActivity.map((e) => e.toString()).toList());
  }

  Future<void> resetProgress() async {
    _totalXp = 0;
    _streak = 0;
    _completedLessonIds.clear();
    _weeklyActivity = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];

    await _prefs.remove('totalXp');
    await _prefs.remove('streak');
    await _prefs.remove('completedLessonIds');
    await _prefs.remove('weeklyActivity');

    notifyListeners();
  }
}
