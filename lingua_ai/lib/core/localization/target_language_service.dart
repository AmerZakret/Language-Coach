import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../services/progress_service.dart';
import 'language_service.dart';
import '../../services/auth_service.dart';
import '../../services/user_api_service.dart';

class TargetLanguageService extends ChangeNotifier {
  static final TargetLanguageService _instance = TargetLanguageService._internal();
  factory TargetLanguageService() => _instance;
  TargetLanguageService._internal();

  String _currentLanguage = 'en';
  int _languageVersion = 0;
  late SharedPreferences _prefs;

  String get currentLanguage => _currentLanguage;
  int get languageVersion => _languageVersion;

  static String toShortCode(String lang) {
    switch (lang.toLowerCase()) {
      case 'english': return 'en';
      case 'german': return 'de';
      case 'spanish': return 'es';
      case 'french': return 'fr';
      case 'arabic': return 'ar';
      default: return 'en';
    }
  }

  static String toFullName(String code) {
    switch (code) {
      case 'en': return 'English';
      case 'de': return 'German';
      case 'es': return 'Spanish';
      case 'fr': return 'French';
      case 'ar': return 'Arabic';
      default: return 'English';
    }
  }

  Future<void> init() async {
    final session = AuthService().captureSession();
    final version = ++_languageVersion;
    _prefs = await SharedPreferences.getInstance();
    if (!session.isCurrent || version != _languageVersion) return;
    _currentLanguage = _prefs.getString('targetLanguage') ?? 'en';
    notifyListeners();
  }

  Future<void> setLanguage(String langCode, {bool syncToBackend = true}) async {
    final session = AuthService().captureSession();
    final version = ++_languageVersion;
    bool isCurrent() => session.isCurrent && version == _languageVersion;
    _currentLanguage = langCode;
    await _prefs.setString('targetLanguage', _currentLanguage);
    if (!isCurrent()) return;

    if (syncToBackend) {
      final auth = AuthService();
      if (auth.isLoggedIn && !auth.isGuest) {
        try {
          await UserApiService().updateProfile(
            targetLanguage: toFullName(langCode),
          );
        } catch (e) {
          debugPrint('Failed to sync target language to backend: $e');
        }
      }
    }
    if (!isCurrent()) return;
    
    ProgressService().reloadProgress();
    notifyListeners();
  }

  Future<void> resetLanguage() async {
    final session = AuthService().captureSession();
    final version = ++_languageVersion;
    _currentLanguage = 'en';
    await _prefs.remove('targetLanguage');
    if (!session.isCurrent || version != _languageVersion) return;
    notifyListeners();
  }

  String getLanguageName(String code) {
    final isTr = LanguageService().currentLanguage == 'tr';
    switch (code) {
      case 'en': return isTr ? 'İngilizce' : 'English';
      case 'es': return isTr ? 'İspanyolca' : 'Spanish';
      case 'de': return isTr ? 'Almanca' : 'German';
      case 'fr': return isTr ? 'Fransızca' : 'French';
      case 'ar': return isTr ? 'Arapça' : 'Arabic';
      default: return isTr ? 'İngilizce' : 'English';
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
