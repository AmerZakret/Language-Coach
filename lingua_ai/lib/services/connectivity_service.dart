import 'dart:async';
import 'dart:convert';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../core/config/api_config.dart';

enum BackendReachability { unknown, reachable, unreachable }

class ConnectivityService extends ChangeNotifier {
  static final ConnectivityService _instance = ConnectivityService._internal();
  factory ConnectivityService() => _instance;
  ConnectivityService._internal()
      : _networkCheck = null,
        _clientFactory = http.Client.new,
        _probeTimeout = const Duration(seconds: 5),
        _probeInterval = const Duration(seconds: 30);
  @visibleForTesting
  ConnectivityService.forTesting(
      {required Future<bool> Function() networkAvailable,
      required http.Client Function() clientFactory,
      Duration probeTimeout = const Duration(seconds: 5),
      Duration probeInterval = const Duration(seconds: 30)})
      : _networkCheck = networkAvailable,
        _clientFactory = clientFactory,
        _probeTimeout = probeTimeout,
        _probeInterval = probeInterval;
  final Connectivity _connectivity = Connectivity();
  final Future<bool> Function()? _networkCheck;
  final http.Client Function() _clientFactory;
  final Duration _probeTimeout;
  final Duration _probeInterval;
  bool _networkAvailable = true;
  BackendReachability _backendState = BackendReachability.unknown;
  StreamSubscription? _subscription;
  Timer? _pingTimer;
  Future<void>? _checking;
  int _generation = 0;
  bool _disposed = false;

  bool get networkAvailable => _networkAvailable;
  BackendReachability get backendState => _backendState;
  bool get backendReachable => _backendState == BackendReachability.reachable;
  bool get isOffline =>
      !_networkAvailable || _backendState == BackendReachability.unreachable;
  bool get isOnline => !isOffline;

  Future<void> init() async {
    await refresh();
    if (_networkCheck == null) {
      _subscription = _connectivity.onConnectivityChanged
          .listen((ConnectivityResult result) {
        _setNetwork(result != ConnectivityResult.none);
        if (_networkAvailable) refresh();
      });
    }
    _pingTimer = Timer.periodic(_probeInterval, (_) {
      refresh();
    });
  }

  void _setNetwork(bool available) {
    if (_networkAvailable == available) return;
    ++_generation;
    _networkAvailable = available;
    _backendState = available
        ? BackendReachability.unknown
        : BackendReachability.unreachable;
    notifyListeners();
  }

  Future<void> refresh() {
    if (_disposed) return Future.value();
    if (_checking != null) return _checking!;
    final checking = _refresh();
    _checking = checking;
    return checking.whenComplete(() {
      if (identical(_checking, checking)) _checking = null;
    });
  }

  Future<void> _refresh() async {
    var available = false;
    try {
      available = _networkCheck != null
          ? await _networkCheck!()
          : await _connectivity.checkConnectivity() != ConnectivityResult.none;
    } catch (_) {
      // A failed connectivity check must not stop periodic recovery probes.
    }
    if (_disposed) return;
    _setNetwork(available);
    if (!available) return;
    final generation = _generation;
    final client = _clientFactory();
    var reachable = false;
    try {
      final response = await client
          .get(Uri.parse('${ApiConfig.baseUrl}/health'))
          .timeout(_probeTimeout);
      reachable = response.statusCode == 200 &&
          jsonDecode(response.body)['status'] == 'ok';
    } catch (_) {
      /* Backend availability never falls back to external DNS. */
    } finally {
      client.close();
    }
    if (_disposed || generation != _generation || !_networkAvailable) return;
    final state = reachable
        ? BackendReachability.reachable
        : BackendReachability.unreachable;
    if (_backendState != state) {
      _backendState = state;
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    ++_generation;
    _subscription?.cancel();
    _pingTimer?.cancel();
    super.dispose();
  }
}
