import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/localization/target_language_service.dart';
import 'user_api_service.dart';

/// Captured identity for asynchronous work; valid for local-only sessions too.
class SessionSnapshot {
  final int revision;
  final String ownerNamespace;
  final String userId;
  final String _token;
  SessionSnapshot._(this.revision, this.ownerNamespace, this.userId, this._token);

  bool get isCurrent {
    final auth = AuthService();
    return auth.sessionVersion == revision &&
        auth.localStorageNamespace == ownerNamespace &&
        auth.currentUserId == userId && auth.token == _token;
  }
}

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
  int _sessionVersion = 0;

  bool get isLoggedIn => _isLoggedIn;
  bool get isGuest => _isGuest;
  String get currentUserName => _currentUserName;
  String get currentUserEmail => _currentUserEmail;
  String get currentUserId => _currentUserId;
  String get token => _token;
  int get sessionVersion => _sessionVersion;
  SessionSnapshot captureSession() => SessionSnapshot._(
      _sessionVersion, localStorageNamespace, _currentUserId, _token);

  /// Shared identity for local progress and flashcard storage, never displayed.
  String get localStorageNamespace {
    if (_isGuest) {
      return _hasBackendGuestIdentity(_currentUserId, _currentUserEmail, _token)
          ? 'guest_$_currentUserId'
          : 'local_guest';
    }
    if (_isLoggedIn) {
      if (_currentUserId.isNotEmpty) return 'registered_$_currentUserId';
      if (_currentUserEmail.isNotEmpty) {
        return 'registered_email_${Uri.encodeComponent(_currentUserEmail)}';
      }
    }
    return 'local_guest';
  }

  /// Only registered caches have an attributable legacy email namespace.
  /// The old shared guest cache must never be claimed by a new guest session.
  String? get legacyRegisteredStorageNamespace =>
      _isLoggedIn && !_isGuest && _currentUserEmail.isNotEmpty
          ? _currentUserEmail.replaceAll('.', '_').replaceAll('@', '_')
          : null;

  Future<void> init() async {
    final revision = ++_sessionVersion;
    _prefs = await SharedPreferences.getInstance();
    if (_sessionVersion != revision) return;
    
    _isLoggedIn = _prefs.getBool('isLoggedIn') ?? false;
    _isGuest = _prefs.getBool('isGuest') ?? false;
    _currentUserName = _prefs.getString('currentUserName') ?? '';
    _currentUserEmail = _prefs.getString('currentUserEmail') ?? '';
    _currentUserId = _prefs.getString('currentUserId') ?? '';
    _token = _prefs.getString('token') ?? '';

    if (_isGuest && _token.isNotEmpty &&
        !_hasBackendGuestIdentity(_currentUserId, _currentUserEmail, _token)) {
      // Legacy or incomplete guest state cannot retain backend authorization.
      await loginAsGuest();
      return;
    }
    
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
    _sessionVersion++;
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
    final session = captureSession();
    try {
      final data = await UserApiService().fetchMe();
      // A stale profile must not pair the previous owner's ID with a new token.
      if (!session.isCurrent) return;
      _currentUserName = data['name'] ?? _currentUserName;
      _currentUserEmail = data['email'] ?? _currentUserEmail;
      _currentUserId = data['id'] ?? _currentUserId;
      
      await _saveSession();
      if (session.isCurrent) notifyListeners();
    } catch (e) {
      debugPrint('Failed to fetch latest profile: $e');
    }
  }

  Future<void> loginAsGuest() async {
    _sessionVersion++;
    _isLoggedIn = false;
    _isGuest = true;
    _currentUserName = 'Guest User';
    _currentUserEmail = 'guest@lingua.ai';
    _currentUserId = 'guest';
    _token = '';
    
    await _saveSession();
  }

  /// Sets a guest session with a real backend token, enabling
  /// authenticated API access (flashcards, AI coach) for guests.
  Future<void> setGuestSession({
    required String token,
    required String id,
    required String email,
    String name = 'Guest User',
  }) async {
    if (!_hasBackendGuestIdentity(id, email, token)) {
      throw ArgumentError('Backend guest session requires a valid identity and token');
    }
    _sessionVersion++;
    _isLoggedIn = false;
    _isGuest = true;
    _currentUserName = name;
    _currentUserEmail = email;
    _currentUserId = id;
    _token = token;

    await _saveSession();
  }

  static bool _hasBackendGuestIdentity(String id, String email, String token) {
    return RegExp(r'^[a-f\d]{24}$', caseSensitive: false).hasMatch(id)
        && email.toLowerCase().endsWith('@guest.lingua.local')
        && token.trim().isNotEmpty;
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
    _sessionVersion++;
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
    final session = captureSession();
    final values = <String, Object>{
      'isLoggedIn': _isLoggedIn, 'isGuest': _isGuest,
      'currentUserName': _currentUserName, 'currentUserEmail': _currentUserEmail,
      'currentUserId': _currentUserId, 'token': _token,
    };
    for (final entry in values.entries) {
      if (!session.isCurrent) return;
      if (entry.value is bool) {
        await _prefs.setBool(entry.key, entry.value as bool);
      } else {
        await _prefs.setString(entry.key, entry.value as String);
      }
    }
    if (session.isCurrent) notifyListeners();
  }
}
