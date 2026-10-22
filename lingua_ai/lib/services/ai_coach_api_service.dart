import 'mutation_request.dart';
import '../core/localization/target_language.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../core/config/api_config.dart';
import 'auth_service.dart';
import 'api_response.dart';

class AiCoachApiService {
  final _intents = MutationIntents();
  // Bind a clear to the send it superseded, including explicit clear replays.
  final _sendBeforeClear = <String, String?>{};
  Future<Map<String, dynamic>> sendMessage({
    required String message,
    required String language,
    String? targetLanguage,
    String? operationId,
    int? intentContext,
  }) async {
    final session = AuthService().captureSession();
    try {
      final body = <String, dynamic>{
        'message': message,
        'language': language,
      };
      if (targetLanguage != null) {
        body['targetLanguage'] = TargetLanguage.code(targetLanguage);
      }

      final slot =
          '${session.revision}:${intentContext ?? 0}:send:${TargetLanguage.code(targetLanguage ?? 'en')}';
      final id =
          _intents.operation(slot, jsonEncode(body), operationId: operationId);
      final headers = <String, String>{
        'X-Idempotency-Key': id,
        'Content-Type': 'application/json',
      };
      final token = AuthService().token;
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      final response = await mutationRequest(
          () => http.post(
                Uri.parse('${ApiConfig.baseUrl}${ApiConfig.aiCoach}/chat'),
                headers: headers,
                body: json.encode(body),
              ),
          session);

      final result = json.decode(response.body) as Map<String, dynamic>;
      _intents.complete(slot, id);
      return result;
    } catch (_) {
      rethrow;
    }
  }

  Future<List<dynamic>> getHistory({
    required String targetLanguage,
  }) async {
    final session = AuthService().captureSession();
    try {
      final headers = <String, String>{
        'Content-Type': 'application/json',
      };
      final token = AuthService().token;
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      final response = await apiRequest(
          () => http.get(
                Uri.parse(
                  '${ApiConfig.baseUrl}${ApiConfig.aiCoach}/history?targetLanguage=${TargetLanguage.code(targetLanguage)}',
                ),
                headers: headers,
              ),
          session);

      return json.decode(response.body) as List<dynamic>;
    } catch (_) {
      rethrow;
    }
  }

  Future<void> clearHistory({
    required String targetLanguage,
    String? operationId,
    int? intentContext,
  }) async {
    final session = AuthService().captureSession();
    try {
      final slot =
          '${session.revision}:${intentContext ?? 0}:clear:${TargetLanguage.code(targetLanguage)}';
      final id =
          _intents.operation(slot, targetLanguage, operationId: operationId);
      final sendSlot =
          '${session.revision}:${intentContext ?? 0}:send:${TargetLanguage.code(targetLanguage)}';
      final supersededSend = _sendBeforeClear.putIfAbsent(
          '$slot:$id', () => _intents.pendingId(sendSlot));
      final headers = <String, String>{'X-Idempotency-Key': id};
      final token = AuthService().token;
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      await mutationRequest(
          () => http.delete(
                Uri.parse(
                  '${ApiConfig.baseUrl}${ApiConfig.aiCoach}/clear?targetLanguage=${TargetLanguage.code(targetLanguage)}',
                ),
                headers: headers,
              ),
          session);
      _intents.complete(slot, id);
      if (supersededSend != null) _intents.complete(sendSlot, supersededSend);
    } catch (_) {
      rethrow;
    }
  }

  Future<Map<String, dynamic>> checkWriting({
    required String topic,
    required String text,
    required String language,
    required String targetLanguage,
  }) async {
    final session = AuthService().captureSession();
    try {
      final body = <String, dynamic>{
        'topic': topic,
        'text': text,
        'language': language,
        'targetLanguage': TargetLanguage.code(targetLanguage),
      };

      final headers = <String, String>{
        'Content-Type': 'application/json',
      };
      final token = AuthService().token;
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      final response = await apiRequest(
          () => http.post(
                Uri.parse(
                    '${ApiConfig.baseUrl}${ApiConfig.aiCoach}/writing-check'),
                headers: headers,
                body: json.encode(body),
              ),
          session);

      return json.decode(response.body) as Map<String, dynamic>;
    } catch (_) {
      rethrow;
    }
  }
}
