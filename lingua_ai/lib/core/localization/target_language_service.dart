import 'target_language.dart';
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

  static String toShortCode(String language) => TargetLanguage.code(language);
  static String toFullName(String language) => TargetLanguage.name(language);
  Future<void> init() async {
    final session = AuthService().captureSession();
    final version = ++_languageVersion;
    _prefs = await SharedPreferences.getInstance();
    if (!session.isCurrent || version != _languageVersion) return;
    final saved = _prefs.getString('targetLanguage');
    // A missing preference starts a new English session. Invalid saved values
    // retain the current selection and are reported instead of coercing to en.
    final normalized = TargetLanguage.tryCode(saved);
    if (saved == null) {
      _currentLanguage = 'en';
    } else if (normalized != null) {
      _currentLanguage = normalized;
    } else {
      debugPrint('Ignoring unsupported saved target language: $saved');
    }
    notifyListeners();
  }

  Future<void> setLanguage(String langCode, {bool syncToBackend = true}) async {
    final session = AuthService().captureSession();
    final version = ++_languageVersion;
    bool isCurrent() => session.isCurrent && version == _languageVersion;
    _currentLanguage = TargetLanguage.code(langCode);
    await _prefs.setString('targetLanguage', _currentLanguage);
    if (!isCurrent()) return;

    if (syncToBackend) {
      final auth = AuthService();
      if (auth.isLoggedIn && !auth.isGuest) {
        try {
          await UserApiService().updateProfile(
            targetLanguage: _currentLanguage,
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
      default: return code;
    }
  }

  String getLanguageFlag(String code) {
    switch (code) {
      case 'en': return '🇬🇧';
      case 'es': return '🇪🇸';
      case 'de': return '🇩🇪';
      case 'fr': return '🇫🇷';
      case 'ar': return '🇸🇦';
      default: return '🌐';
    }
  }
}
