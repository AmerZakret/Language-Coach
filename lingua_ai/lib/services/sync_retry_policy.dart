import 'dart:async';
import 'api_response.dart';

const replayTimeout = Duration(seconds: 45);

class SyncHttpException implements Exception {
  final int statusCode;
  final String? code;
  const SyncHttpException(this.statusCode, [this.code]);
  @override
  String toString() => 'Sync HTTP status $statusCode';
}

class InvalidQueuedPayload implements Exception {
  final String? code;
  const InvalidQueuedPayload([this.code]);
}

class SyncFailure {
  final String category;
  final bool terminal;
  final String? code;
  final int? statusCode;
  const SyncFailure(this.category, this.terminal, [this.code, this.statusCode]);
  static SyncFailure classify(Object error) {
    final status = error is SyncHttpException
        ? error.statusCode
        : error is ApiException
            ? error.statusCode
            : null;
    final code = error is ApiException
        ? error.code
        : error is SyncHttpException
            ? error.code
            : error is InvalidQueuedPayload
                ? error.code
                : null;
    const known = {
      'STALE_PROGRESS_EPOCH': 'stale-epoch',
      'FUTURE_PROGRESS_EPOCH': 'future-epoch',
      'STALE_RESET_EPOCH': 'stale-reset-epoch',
      'FUTURE_RESET_EPOCH': 'future-reset-epoch',
      'RESET_IDEMPOTENCY_CONFLICT': 'reset-key-conflict',
      'MISSING_PROGRESS_EPOCH': 'missing-epoch',
      'INVALID_PROGRESS_EPOCH': 'invalid-epoch'
    };
    SyncFailure failure(String category, bool terminal) =>
        SyncFailure(category, terminal, code, status);
    if ((error is InvalidQueuedPayload || status == 400 || status == 409) &&
        known.containsKey(code)) {
      return failure(known[code]!, true);
    }
    if (error is InvalidQueuedPayload) return failure('malformed', true);
    if (error is TimeoutException) return failure('timeout', false);
    if (status != null) {
      if (status == 401) return failure('authentication', false);
      if (status == 403) return failure('forbidden', true);
      if (status == 404) return failure('not-found', true);
      if (status == 409) return failure('conflict', true);
      if ([408, 425, 429].contains(status)) {
        return failure(status == 429 ? 'rate-limited' : 'timeout', false);
      }
      if (status >= 400 && status < 500) {
        return failure('validation', true);
      }
      if (status >= 500) return failure('backend', false);
    }
    return failure('network', false);
  }
}

Duration retryDelay(int attempts) {
  final exponent = (attempts - 1).clamp(0, 6);
  return Duration(seconds: (5 * (1 << exponent)).clamp(5, 300));
}
