import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'app_strings.dart';

class LanguageService extends ChangeNotifier {
  static final LanguageService _instance = LanguageService._internal();
  factory LanguageService() => _instance;
  LanguageService._internal();

  String _currentLanguage = 'en';
  late SharedPreferences _prefs;

  String get currentLanguage => _currentLanguage;

  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
    _currentLanguage = _prefs.getString('currentLanguage') ?? 'en';
    notifyListeners();
  }

  void toggleLanguage() async {
    _currentLanguage = _currentLanguage == 'en' ? 'tr' : 'en';
    await _prefs.setString('currentLanguage', _currentLanguage);
    notifyListeners();
  }

  Future<void> resetLanguage() async {
    _currentLanguage = 'en';
    await _prefs.remove('currentLanguage');
    notifyListeners();
  }

  String getString(String key) {
    return AppStrings.strings[_currentLanguage]?[key] ?? key;
  }
}
