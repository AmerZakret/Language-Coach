import 'dart:async';
import 'dart:io';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../core/config/api_config.dart';

class ConnectivityService extends ChangeNotifier {
  static final ConnectivityService _instance = ConnectivityService._internal();
  factory ConnectivityService() => _instance;
  ConnectivityService._internal();

  final Connectivity _connectivity = Connectivity();
  bool _isOffline = false;
  StreamSubscription? _subscription;
  Timer? _pingTimer;

  bool get isOffline => _isOffline;
  bool get isOnline => !_isOffline;

  Future<void> init() async {
    final result = await _connectivity.checkConnectivity();
    await _checkStatus(result);

    _subscription = _connectivity.onConnectivityChanged.listen((ConnectivityResult result) {
      _checkStatus(result);
    });

    // Periodically verify server reachability
    _pingTimer = Timer.periodic(const Duration(seconds: 30), (timer) async {
      final currentResult = await _connectivity.checkConnectivity();
      await _checkStatus(currentResult);
    });
  }

  Future<void> _checkStatus(ConnectivityResult result) async {
    if (result == ConnectivityResult.none) {
      _setOffline(true);
      return;
    }

    final hasInternet = await _pingServer();
    _setOffline(!hasInternet);
  }

  Future<bool> _pingServer() async {
    try {
      await http.get(
        Uri.parse('${ApiConfig.baseUrl}/auth/login'),
      ).timeout(const Duration(seconds: 4));
      // Any response (even a method not allowed / bad request) means the server is reachable
      return true;
    } catch (_) {
      if (kIsWeb) {
        return false;
      }
      try {
        final lookup = await InternetAddress.lookup('google.com');
        return lookup.isNotEmpty && lookup[0].rawAddress.isNotEmpty;
      } catch (_) {
        return false;
      }
    }
  }

  void _setOffline(bool offline) {
    if (_isOffline != offline) {
      _isOffline = offline;
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _pingTimer?.cancel();
    super.dispose();
  }
}
