import 'dart:async';
import 'package:flutter/foundation.dart';
import 'auth_service.dart';
import 'connectivity_service.dart';
import 'offline_queue_service.dart';

class SyncCoordinator {
  static final SyncCoordinator _instance = SyncCoordinator._internal();
  factory SyncCoordinator() => _instance;
  SyncCoordinator._internal()
      : _queue = OfflineQueueService(),
        _health = ConnectivityService(),
        _now = DateTime.now;
  @visibleForTesting
  SyncCoordinator.forTesting(
      {required OfflineQueueService queue,
      required ConnectivityService connectivity,
      DateTime Function()? now})
      : _queue = queue,
        _health = connectivity,
        _now = now ?? DateTime.now;
  final OfflineQueueService _queue;
  final ConnectivityService _health;
  final DateTime Function() _now;
  StreamSubscription<void>? _subscription;
  Timer? _timer;
  bool _started = false;
  bool _running = false;
  void Function(bool success)? onChanged;

  void start() {
    if (_started) return;
    _started = true;
    _subscription = _queue.changes.listen((_) => wake());
    _health.addListener(wake);
    AuthService().addListener(wake);
    wake();
  }

  void stop() {
    _started = false;
    _timer?.cancel();
    _subscription?.cancel();
    _health.removeListener(wake);
    AuthService().removeListener(wake);
  }

  void wake() {
    if (!_started || _running) return;
    _timer?.cancel();
    _timer = Timer(Duration.zero, _drain);
  }

  Future<void> _schedule() async {
    if (!_started ||
        !_health.backendReachable ||
        AuthService().localStorageNamespace == 'local_guest') {
      return;
    }
    final session = AuthService().captureSession();
    final actions = await _queue.getQueue();
    if (!_started || !session.isCurrent || actions.isEmpty) return;
    final due = actions.first.nextAttemptAt ?? _now();
    var delay = due.difference(_now());
    if (delay <= Duration.zero) delay = const Duration(milliseconds: 1);
    _timer?.cancel();
    _timer = Timer(delay, _drain);
  }

  Future<void> _drain() async {
    final auth = AuthService();
    if (!_started ||
        _running ||
        !_health.backendReachable ||
        auth.localStorageNamespace == 'local_guest' ||
        auth.token.isEmpty) {
      return;
    }
    _running = true;
    var storageFailure = false;
    final session = auth.captureSession();
    try {
      final actions = await _queue.getQueue();
      if (!_started || !session.isCurrent || actions.isEmpty) return;
      if (actions.first.nextAttemptAt?.isAfter(_now()) == true) return;
      final failedCount = (await _queue.getFailedActions()).length;
      if (!session.isCurrent) return;
      final success =
          await _queue.processQueue(session.userId, waitForActive: true);
      if (!_started || !session.isCurrent) return;
      final remaining = await _queue.getQueue();
      final failures = await _queue.getFailedActions();
      if (!_started || !session.isCurrent) return;
      if (remaining.length < actions.length || failures.length > failedCount) {
        onChanged?.call(success);
      }
      if (!success) await _health.refresh();
    } catch (_) {
      storageFailure = true;
    } finally {
      _running = false;
      if (_started) {
        if (storageFailure) {
          _timer?.cancel();
          _timer = Timer(const Duration(seconds: 30), wake);
        } else {
          try {
            await _schedule();
          } catch (_) {
            _timer?.cancel();
            _timer = Timer(const Duration(seconds: 30), wake);
          }
        }
      }
    }
  }
}
