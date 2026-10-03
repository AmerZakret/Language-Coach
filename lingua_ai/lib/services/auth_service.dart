import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/localization/target_language_service.dart';
import 'user_api_service.dart';

class AuthService extends ChangeNotifier {
  static final AuthService _instance = AuthService._internal();
  factory AuthService() => _instance;
  AuthService._internal();

  late SharedPreferences _prefs;

  bool _isLoggedIn = false;
  bool _isGuest = false;
  String _currentUserName = '';
  String _currentUserEmail = '';
  String _currentUserId = '';
  String _token = '';

  bool get isLoggedIn => _isLoggedIn;
  bool get isGuest => _isGuest;
  String get currentUserName => _currentUserName;
  String get currentUserEmail => _currentUserEmail;
  String get currentUserId => _currentUserId;
  String get token => _token;

  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
    
    _isLoggedIn = _prefs.getBool('isLoggedIn') ?? false;
    _isGuest = _prefs.getBool('isGuest') ?? false;
    _currentUserName = _prefs.getString('currentUserName') ?? '';
    _currentUserEmail = _prefs.getString('currentUserEmail') ?? '';
    _currentUserId = _prefs.getString('currentUserId') ?? '';
    _token = _prefs.getString('token') ?? '';
    
    notifyListeners();

    if (_isLoggedIn && !_isGuest && _token.isNotEmpty) {
      fetchLatestProfile();
    }
  }

  // Returns null if input is valid, or an error message if invalid
  String? loginLocal(String email, String password) {
    if (email.trim().isEmpty || password.trim().isEmpty) {
      return 'fields_empty_error';
    }
    
    final emailRegex = RegExp(r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$');
    if (!emailRegex.hasMatch(email)) {
      return 'invalid_email_error';
    }

    if (password.length < 4) {
      return 'password_length_error';
    }

    return null;
  }

  void setBackendSession({
    required String name,
    required String email,
    required String token,
    required String id,
    String? targetLanguage,
  }) {
    _isLoggedIn = true;
    _isGuest = false;
    _currentUserName = name;
    _currentUserEmail = email;
    _currentUserId = id;
    _token = token;
    
    _saveSession();

    if (targetLanguage != null && targetLanguage.isNotEmpty) {
      final shortCode = TargetLanguageService.toShortCode(targetLanguage);
      TargetLanguageService().setLanguage(shortCode, syncToBackend: false);
    }
  }

  void updateName(String newName) {
    _currentUserName = newName;
    _saveSession();
  }

  Future<void> fetchLatestProfile() async {
    if (!_isLoggedIn || _isGuest || _token.isEmpty) return;
    try {
      final data = await UserApiService().fetchMe();
      _currentUserName = data['name'] ?? _currentUserName;
      _currentUserEmail = data['email'] ?? _currentUserEmail;
      _currentUserId = data['id'] ?? _currentUserId;
      
      await _saveSession();
      notifyListeners();
    } catch (e) {
      debugPrint('Failed to fetch latest profile: $e');
    }
  }

  void loginAsGuest() {
    _isLoggedIn = false;
    _isGuest = true;
    _currentUserName = 'Guest User';
    _currentUserEmail = 'guest@lingua.ai';
    _currentUserId = 'guest';
    _token = '';
    
    _saveSession();
  }

  /// Sets a guest session with a real backend token, enabling
  /// authenticated API access (flashcards, AI coach) for guests.
  void setGuestSession({
    required String token,
    required String id,
  }) {
    _isLoggedIn = false;
    _isGuest = true;
    _currentUserName = 'Guest User';
    _currentUserEmail = 'guest@lingua.ai';
    _currentUserId = id;
    _token = token;

    _saveSession();
  }

  // Returns null if input is valid, or an error message if invalid
  String? registerLocal(String name, String email, String password, String confirmPassword) {
    if (name.trim().isEmpty || email.trim().isEmpty || password.trim().isEmpty || confirmPassword.trim().isEmpty) {
      return 'fields_empty_error';
    }
    
    final emailRegex = RegExp(r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$');
    if (!emailRegex.hasMatch(email)) {
      return 'invalid_email_error';
    }

    if (password.length < 4) {
      return 'password_length_error';
    }

    if (password != confirmPassword) {
      return 'password_match_error';
    }

    return null;
  }

  void logout() {
    _isLoggedIn = false;
    _isGuest = false;
    _currentUserName = '';
    _currentUserEmail = '';
    _currentUserId = '';
    _token = '';
    
    _prefs.remove('isLoggedIn');
    _prefs.remove('isGuest');
    _prefs.remove('currentUserName');
    _prefs.remove('currentUserEmail');
    _prefs.remove('currentUserId');
    _prefs.remove('token');
    
    notifyListeners();
  }

  Future<void> _saveSession() async {
    await _prefs.setBool('isLoggedIn', _isLoggedIn);
    await _prefs.setBool('isGuest', _isGuest);
    await _prefs.setString('currentUserName', _currentUserName);
    await _prefs.setString('currentUserEmail', _currentUserEmail);
    await _prefs.setString('currentUserId', _currentUserId);
    await _prefs.setString('token', _token);
    notifyListeners();
  }
}

