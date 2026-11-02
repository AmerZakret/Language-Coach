import 'dart:async';
import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'data_timeline.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/localization/target_language_service.dart';
import 'user_api_service.dart';

/// Captured identity for asynchronous work; valid for local-only sessions too.
class SessionSnapshot {
  final int timelineRevision = DataTimeline().revision;
  bool get isDataCurrent => isCurrent && timelineRevision == DataTimeline().revision;
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
  String? _profileDataTimelineId;
  int _profileRevision = -1;
  bool _timelineListening = false;
  int _sessionVersion = 0;
  static Future<void>? _profileWriteTail;
  static String profileProjectionKey(String owner) => 'profile_projection_v1_${Uri.encodeComponent(owner)}';
  @visibleForTesting
  Future<void> Function(Map<String, dynamic>)? beforeProfileProjectionWrite;
  @visibleForTesting
  Future<bool> Function(String, String)? writeProfileProjectionForTesting;


  bool get isLoggedIn => _isLoggedIn;
  bool get isGuest => _isGuest;
  bool get hasCurrentProfile => _token.isEmpty || DataTimeline().matchesCache(_profileDataTimelineId);
  String get currentUserName => hasCurrentProfile ? _currentUserName : (_isGuest ? 'Guest User' : 'User');
  String get currentUserEmail => hasCurrentProfile ? _currentUserEmail : '';
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
    // Legacy per-field profile/tag pairs are not coherent evidence. The single
    // profile projection below is the only authoritative persisted read state.
    _profileDataTimelineId = null;
    _restoreProfileProjection();
    if (!_timelineListening) {
      _timelineListening = true;
      DataTimeline().addListener(_onTimelineChanged);
    }
    _profileRevision = DataTimeline().revision;

    if (_isGuest && _token.isNotEmpty &&
        !_hasBackendGuestIdentity(_currentUserId, _currentUserEmail, _token)) {
      // Legacy or incomplete guest state cannot retain backend authorization.
      await loginAsGuest();
      return;
    }
    
    notifyListeners();
    if (_token.isNotEmpty && DataTimeline().freshlyConfirmed) fetchLatestProfile();
  }

  void _onTimelineChanged() {
    if (_profileRevision == DataTimeline().revision) return;
    _profileRevision = DataTimeline().revision;
    // Identity/token remain authoritative. Displayed profile data is a read
    // cache and becomes unavailable until a response from the new lineage.
    notifyListeners();
    if (_token.isNotEmpty && DataTimeline().freshlyConfirmed) fetchLatestProfile();
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

  Future<void> setBackendSession({
    required String name,
    required String email,
    required String token,
    required String id,
    String? targetLanguage,
  }) async {
    _sessionVersion++;
    _isLoggedIn = true;
    _isGuest = false;
    _currentUserName = name;
    _currentUserEmail = email;
    _currentUserId = id;
    _token = token;
    _profileDataTimelineId = DataTimeline().lastConfirmedDataTimelineId;
    
    final session = captureSession();
    await _saveSession();
    if (!session.isDataCurrent) return;

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
    if ((!_isLoggedIn && !_isGuest) || _token.isEmpty) return;
    final session = captureSession();
    try {
      final data = await UserApiService().fetchMe();
      // A stale profile must not pair the previous owner's ID with a new token.
      if (!session.isDataCurrent) return;
      _profileDataTimelineId = DataTimeline().lastConfirmedDataTimelineId;
      _currentUserName = data['name'] as String;
      _currentUserEmail = data['email'] as String;
      _currentUserId = data['id'] as String;
      _isGuest = data['isGuest'] as bool;
      _isLoggedIn = !_isGuest;
      
      await _saveSession();
      if (session.isDataCurrent) notifyListeners();
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
    _profileDataTimelineId = DataTimeline().lastConfirmedDataTimelineId;

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

  bool invalidateSession(SessionSnapshot session) {
    if (!session.isDataCurrent || session._token.isEmpty ||
        session.ownerNamespace == 'local_guest') {
      return false;
    }
    logout();
    return true;
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

  void _restoreProfileProjection() {
    try {
      final raw = _prefs.getString(profileProjectionKey(localStorageNamespace));
      if (raw == null) return;
      final record = jsonDecode(raw);
      final data = record['data'];
      if (record['schemaVersion'] != 1 ||
          record['ownerNamespace'] != localStorageNamespace ||
          record['sessionIdentity'] != sha256.convert(utf8.encode(_token)).toString() ||
          !DataTimeline.valid(record['dataTimelineId']) || data is! Map ||
          data['id'] != _currentUserId || data['isGuest'] != _isGuest ||
          data['name'] is! String || data['email'] is! String) { return; }
      _currentUserName = data['name'];
      _currentUserEmail = data['email'];
      _profileDataTimelineId = record['dataTimelineId'];
    } catch (_) { /* An invalid read projection never becomes server authority. */ }
  }

  Future<void> _saveSession() async {
    final session = captureSession();
    final profileTimeline = _profileDataTimelineId;
    final values = <String, Object>{
      'isLoggedIn': _isLoggedIn, 'isGuest': _isGuest,
      'currentUserName': _currentUserName, 'currentUserEmail': _currentUserEmail,
      'currentUserId': _currentUserId, 'token': _token,
    };
    final projection = <String, dynamic>{
      'schemaVersion': 1, 'ownerNamespace': session.ownerNamespace,
      'sessionIdentity': sha256.convert(utf8.encode(values['token'] as String)).toString(),
      'dataTimelineId': profileTimeline,
      'data': {'id': values['currentUserId'], 'name': values['currentUserName'],
        'email': values['currentUserEmail'], 'isGuest': values['isGuest']},
    };
    // These legacy keys restore authentication identity only. They cannot
    // establish profile provenance; init reads it from the atomic JSON record.
    for (final entry in values.entries) {
      if (!session.isDataCurrent) return;
      if (entry.value is bool) {
        await _prefs.setBool(entry.key, entry.value as bool);
      } else {
        await _prefs.setString(entry.key, entry.value as String);
      }
    }
    if (!session.isDataCurrent) return;
    if (session.ownerNamespace != 'local_guest' && DataTimeline.valid(profileTimeline)) {
      await beforeProfileProjectionWrite?.call(projection);
      final previous = _profileWriteTail;
      final released = Completer<void>();
      _profileWriteTail = released.future;
      if (previous != null) await previous;
      try {
        if (!session.isDataCurrent) return;
        // One serialized value carries data AND provenance. No per-key ordering
        // or partially written timeline tag can authorize a mixed profile.
        if (!await (writeProfileProjectionForTesting ?? _prefs.setString)(profileProjectionKey(session.ownerNamespace), jsonEncode(projection))) {
          throw StateError('Could not persist coherent profile projection');
        }
      } finally {
        released.complete();
        if (identical(_profileWriteTail, released.future)) _profileWriteTail = null;
      }
    }
    if (session.isDataCurrent) notifyListeners();
  }
}
