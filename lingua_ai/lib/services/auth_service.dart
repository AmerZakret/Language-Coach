import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

class AuthService extends ChangeNotifier {
  static final AuthService _instance = AuthService._internal();
  factory AuthService() => _instance;
  AuthService._internal();

  late SharedPreferences _prefs;

  bool _isLoggedIn = false;
  bool _isGuest = false;
  String _currentUserName = '';
  String _currentUserEmail = '';
  String _token = '';

  bool get isLoggedIn => _isLoggedIn;
  bool get isGuest => _isGuest;
  String get currentUserName => _currentUserName;
  String get currentUserEmail => _currentUserEmail;
  String get token => _token;

  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
    
    _isLoggedIn = _prefs.getBool('isLoggedIn') ?? false;
    _isGuest = _prefs.getBool('isGuest') ?? false;
    _currentUserName = _prefs.getString('currentUserName') ?? '';
    _currentUserEmail = _prefs.getString('currentUserEmail') ?? '';
    _token = _prefs.getString('token') ?? '';
    
    notifyListeners();
  }

  // Returns null if successful, or an error message if invalid
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

    _isLoggedIn = true;
    _isGuest = false;
    _currentUserName = email.split('@')[0].toUpperCase();
    _currentUserEmail = email;
    _token = 'dummy-local-token';
    
    _saveSession();
    return null;
  }

  void setBackendSession({
    required String name,
    required String email,
    required String token,
  }) {
    _isLoggedIn = true;
    _isGuest = false;
    _currentUserName = name;
    _currentUserEmail = email;
    _token = token;
    
    _saveSession();
  }

  void loginAsGuest() {
    _isLoggedIn = false;
    _isGuest = true;
    _currentUserName = 'Guest User';
    _currentUserEmail = 'guest@lingua.ai';
    _token = '';
    
    _saveSession();
  }

  // Returns null if successful, or an error message if invalid
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

    _isLoggedIn = true;
    _isGuest = false;
    _currentUserName = name;
    _currentUserEmail = email;
    _token = 'dummy-local-token';
    
    _saveSession();
    return null;
  }

  void logout() {
    _isLoggedIn = false;
    _isGuest = false;
    _currentUserName = '';
    _currentUserEmail = '';
    _token = '';
    
    _prefs.remove('isLoggedIn');
    _prefs.remove('isGuest');
    _prefs.remove('currentUserName');
    _prefs.remove('currentUserEmail');
    _prefs.remove('token');
    
    notifyListeners();
  }

  Future<void> _saveSession() async {
    await _prefs.setBool('isLoggedIn', _isLoggedIn);
    await _prefs.setBool('isGuest', _isGuest);
    await _prefs.setString('currentUserName', _currentUserName);
    await _prefs.setString('currentUserEmail', _currentUserEmail);
    await _prefs.setString('token', _token);
    notifyListeners();
  }
}

