import 'online_intent_dispatch.dart';
import 'online_intent_service.dart';
import '../core/localization/target_language.dart';
import 'dart:convert';
import 'backend_http.dart' as http;
import '../core/config/api_config.dart';
import 'auth_service.dart';
import 'api_response.dart';

class AiCoachApiService {
  Future<String> prepareMessage({required String message, required String language,
      required String targetLanguage}) async {
    final target = TargetLanguage.code(targetLanguage);
    final intent = await OnlineIntentService.prepare('ai-send', target, {
      'message': message, 'language': language, 'targetLanguage': target,
    });
    return intent['id'] as String;
  }

  Future<Map<String, dynamic>> sendMessage({
    required String message,
    required String language,
    String? targetLanguage,
    String? operationId,
    int? intentContext,
  }) async {
    final target = TargetLanguage.code(targetLanguage ?? 'en');
    return durableOnlineMutation('ai-send', target, {
      'message': message, 'language': language, 'targetLanguage': target,
    }, operationId: operationId);
  }

  Future<List<dynamic>> getHistory({
    required String targetLanguage,
    void Function()? onRecoveryIssue,
  }) async {
    final session = AuthService().captureSession();
    try { await recoverOnlineIntents('ai', language: TargetLanguage.code(targetLanguage)); }
    catch (_) { onRecoveryIssue?.call(); }
    if (!session.isDataCurrent) throw StateError('Chat session changed');
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
    final target = TargetLanguage.code(targetLanguage);
    await durableOnlineMutation('ai-clear', target, {'targetLanguage': target}, operationId: operationId);
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
