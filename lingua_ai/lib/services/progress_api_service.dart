import '../core/localization/target_language.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../core/config/api_config.dart';
import 'auth_service.dart';
import 'api_response.dart';
import 'sync_retry_policy.dart';

class ProgressApiService {
  Future<Map<String, dynamic>> getProgress(
      String userId, String targetLanguage) async {
    try {
      final session = AuthService().captureSession();
      final headers = <String, String>{};
      final token = AuthService().token;
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      final response = await apiRequest(
          () => http
              .get(
                Uri.parse(
                    '${ApiConfig.baseUrl}${ApiConfig.progress}/$userId?targetLanguage=${TargetLanguage.code(targetLanguage)}'),
                headers: headers,
              )
              .timeout(replayTimeout),
          session);
      if (response.statusCode == 200) {
        return json.decode(response.body);
      } else {
        throw Exception('Failed to load progress');
      }
    } catch (e) {
      rethrow;
    }
  }

  Future<Map<String, dynamic>> completeLesson(
      String userId, String lessonId, int score,
      {required int progressEpoch, String? operationId}) async {
    try {
      final session = AuthService().captureSession();
      final headers = <String, String>{
        'Content-Type': 'application/json',
        if (operationId != null) 'X-Idempotency-Key': operationId,
      };
      final token = AuthService().token;
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      final response = await apiRequest(
          () => http
              .post(
                Uri.parse(
                    '${ApiConfig.baseUrl}${ApiConfig.progress}/$userId/complete-lesson'),
                headers: headers,
                body: json.encode({
                  'lessonId': lessonId,
                  'score': score,
                  'progressEpoch': progressEpoch,
                }),
              )
              .timeout(replayTimeout),
          session);
      if (response.statusCode == 201 || response.statusCode == 200) {
        return json.decode(response.body);
      } else {
        throw SyncHttpException(response.statusCode);
      }
    } catch (e) {
      rethrow;
    }
  }

  Future<Map<String, dynamic>> resetProgress(String userId,
      {required int expectedEpoch, required String operationId}) async {
    final session = AuthService().captureSession();
    final response = await apiRequest(
        () => http.delete(
                Uri.parse('${ApiConfig.baseUrl}${ApiConfig.progress}/$userId'),
                body: json.encode({'expectedEpoch': expectedEpoch}),
                headers: {
                  'Content-Type': 'application/json',
                  if (AuthService().token.isNotEmpty)
                    'Authorization': 'Bearer ${AuthService().token}',
                  'X-Idempotency-Key': operationId,
                }).timeout(replayTimeout),
        session);
    if (response.statusCode != 200) {
      throw SyncHttpException(response.statusCode);
    }
    return json.decode(response.body);
  }
}
