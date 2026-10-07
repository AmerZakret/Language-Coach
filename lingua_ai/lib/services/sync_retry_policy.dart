import 'dart:async';
import 'api_response.dart';

const replayTimeout = Duration(seconds: 45);

class SyncHttpException implements Exception {
  final int statusCode;
  const SyncHttpException(this.statusCode);
  @override
  String toString() => 'Sync HTTP status $statusCode';
}

class InvalidQueuedPayload implements Exception {
  const InvalidQueuedPayload();
}

class SyncFailure {
  final String category;
  final bool terminal;
  const SyncFailure(this.category, this.terminal);
  static SyncFailure classify(Object error) {
    if (error is InvalidQueuedPayload) {
      return const SyncFailure('malformed', true);
    }
    if (error is TimeoutException) return const SyncFailure('timeout', false);
    final status = error is SyncHttpException
        ? error.statusCode
        : error is ApiException
            ? error.statusCode
            : null;
    if (status != null) {
      if (status == 401) return const SyncFailure('authentication', false);
      if (status == 403) return const SyncFailure('forbidden', true);
      if (status == 404) return const SyncFailure('not-found', true);
      if (status == 409) return const SyncFailure('conflict', true);
      if ([408, 425, 429].contains(status)) {
        return SyncFailure(status == 429 ? 'rate-limited' : 'timeout', false);
      }
      if (status >= 400 && status < 500) {
        return const SyncFailure('validation', true);
      }
      if (status >= 500) return const SyncFailure('backend', false);
    }
    return const SyncFailure('network', false);
  }
}

Duration retryDelay(int attempts) {
  final exponent = (attempts - 1).clamp(0, 6);
  return Duration(seconds: (5 * (1 << exponent)).clamp(5, 300));
}
