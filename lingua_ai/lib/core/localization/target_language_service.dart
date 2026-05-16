import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../services/progress_service.dart';

class TargetLanguageService extends ChangeNotifier {
  static final TargetLanguageService _instance = TargetLanguageService._internal();
  factory TargetLanguageService() => _instance;
  TargetLanguageService._internal();

  String _currentLanguage = 'en';
  late SharedPreferences _prefs;

  String get currentLanguage => _currentLanguage;

  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
    _currentLanguage = _prefs.getString('targetLanguage') ?? 'en';
    notifyListeners();
  }

  Future<void> setLanguage(String langCode) async {
    _currentLanguage = langCode;
    await _prefs.setString('targetLanguage', _currentLanguage);
    ProgressService().reloadProgress();
    notifyListeners();
  }

  Future<void> resetLanguage() async {
    _currentLanguage = 'en';
    await _prefs.remove('targetLanguage');
    notifyListeners();
  }

  String getLanguageName(String code) {
    switch (code) {
      case 'en': return 'English';
      case 'es': return 'Spanish';
      case 'de': return 'German';
      case 'fr': return 'French';
      case 'ar': return 'Arabic';
      default: return 'English';
    }
  }

  String getLanguageFlag(String code) {
    switch (code) {
      case 'en': return '🇬🇧';
      case 'es': return '🇪🇸';
      case 'de': return '🇩🇪';
      case 'fr': return '🇫🇷';
      case 'ar': return '🇸🇦';
      default: return '🇬🇧';
    }
  }
}
