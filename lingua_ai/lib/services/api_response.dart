import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'auth_service.dart';

enum ApiFailure { network, unauthorized, client, server }

const _deferUnauthorizedInvalidation = #deferUnauthorizedInvalidation;

/// Replay saves its durable retry checkpoint before invalidating authentication.
/// This changes response handling only; session ownership still uses AuthService.
Future<T> withDeferredUnauthorizedInvalidation<T>(Future<T> Function() send) =>
    runZoned(send, zoneValues: {_deferUnauthorizedInvalidation: true});

class ApiException implements Exception {
  final ApiFailure kind;
  final String message;
  final int? statusCode;
  final bool sessionInvalidated;
  final String? code;
  const ApiException(this.kind, this.message,
      [this.statusCode, this.sessionInvalidated = false, this.code]);
  @override
  String toString() => message;
}

/// Interpret HTTP failures before parsing a success response. Only a response
/// for the captured current token may invalidate authentication.
Future<http.Response> apiRequest(
  Future<http.Response> Function() send,
  SessionSnapshot session,
) async {
  http.Response response;
  try {
    response = await send();
  } on http.ClientException {
    throw const ApiException(
        ApiFailure.network, 'Cannot reach the backend. Check your connection.');
  } on SocketException {
    throw const ApiException(
        ApiFailure.network, 'Cannot reach the backend. Check your connection.');
  } on TimeoutException {
    throw const ApiException(
        ApiFailure.network, 'The request timed out. Please try again.');
  }
  if (response.statusCode >= 200 && response.statusCode < 300) return response;
  final status = response.statusCode;
  final kind = status == 401
      ? ApiFailure.unauthorized
      : status >= 500
          ? ApiFailure.server
          : ApiFailure.client;
  var message = status == 401
      ? 'Your session has expired. Please sign in again.'
      : status >= 500
          ? 'The server could not complete the request. Please try again.'
          : 'The request was rejected. Check your input.';
  String? code;
  try {
    final data = jsonDecode(response.body);
    final rawCode = data is Map ? data['code'] : null;
    if (rawCode is String &&
        RegExp(r'^[A-Z][A-Z0-9_]{0,63}$').hasMatch(rawCode)) {
      code = rawCode;
    }
    final value = data is Map ? data['message'] : null;
    final text = value is String
        ? value
        : value is List && value.every((item) => item is String)
            ? value.join(', ')
            : null;
    // Nest validation messages and our public provider messages are safe. Do not
    // display an arbitrary provider/server body, stack trace, or HTML response.
    if (text != null &&
        text.length <= 500 &&
        (status != 401 &&
            (status < 500 ||
                text == 'Writing evaluation is not configured yet.' ||
                text ==
                    'Writing evaluation is temporarily unavailable. Please try again.' ||
                text == 'Writing provider returned an invalid evaluation.' ||
                text ==
                    'An error occurred while communicating with the AI Coach. Please try again.'))) {
      message = text;
    }
  } on FormatException {
    // Use the safe status-specific message for non-JSON responses.
  }
  final invalidated = status == 401 &&
      Zone.current[_deferUnauthorizedInvalidation] != true &&
      AuthService().invalidateSession(session);
  throw ApiException(kind, message, status, invalidated, code);
}

Map<String, dynamic> parsePublicUser(dynamic value) {
  if (value is! Map<String, dynamic> ||
      value['id'] is! String ||
      !RegExp(r'^[a-f\d]{24}$', caseSensitive: false).hasMatch(value['id']) ||
      value['name'] is! String ||
      value['email'] is! String ||
      value['isGuest'] is! bool ||
      value['targetLanguage'] is! String) {
    throw const FormatException(
        'The server returned an incomplete user profile');
  }
  return value;
}

/// A current-token 401 changes the session revision itself. Its error can still
/// be shown after that invalidation, but never after a subsequent login/switch.
bool canHandleApiError(SessionSnapshot session, Object error) {
  final auth = AuthService();
  return session.isCurrent ||
      error is ApiException &&
          error.sessionInvalidated &&
          auth.sessionVersion == session.revision + 1 &&
          auth.token.isEmpty;
}
