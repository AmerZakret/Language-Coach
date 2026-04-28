import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

class ProgressService extends ChangeNotifier {
  static final ProgressService _instance = ProgressService._internal();
  factory ProgressService() => _instance;
  ProgressService._internal();

  late SharedPreferences _prefs;

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
    
    _totalXp = _prefs.getInt('totalXp') ?? 1250; // Keep dummy default for aesthetics
    _streak = _prefs.getInt('streak') ?? 14;     // Keep dummy default for aesthetics
    
    final savedIds = _prefs.getStringList('completedLessonIds');
    if (savedIds != null) {
      _completedLessonIds = savedIds.toSet();
    }

    final savedActivity = _prefs.getStringList('weeklyActivity');
    if (savedActivity != null) {
      _weeklyActivity = savedActivity.map((e) => double.tryParse(e) ?? 0.0).toList();
    } else {
      _weeklyActivity = [0.2, 0.5, 0.8, 0.4, 0.9, 0.3, 0.0];
    }
    
    notifyListeners();
  }

  void completeLesson(String lessonId, int xpReward) async {
    if (!_completedLessonIds.contains(lessonId)) {
      _completedLessonIds.add(lessonId);
      _totalXp += xpReward;
      
      await _prefs.setStringList('completedLessonIds', _completedLessonIds.toList());
      await _prefs.setInt('totalXp', _totalXp);
      
      notifyListeners();
    }
  }

  bool isLessonCompleted(String lessonId) {
    return _completedLessonIds.contains(lessonId);
  }

  Future<void> resetProgress() async {
    _totalXp = 1250;
    _streak = 14;
    _completedLessonIds.clear();
    _weeklyActivity = [0.2, 0.5, 0.8, 0.4, 0.9, 0.3, 0.0];
    
    await _prefs.remove('totalXp');
    await _prefs.remove('streak');
    await _prefs.remove('completedLessonIds');
    await _prefs.remove('weeklyActivity');
    
    notifyListeners();
  }
}
