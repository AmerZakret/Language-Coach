import 'dart:convert';
import 'package:http/http.dart' as http;
import '../core/config/api_config.dart';
import 'auth_service.dart';

class ProgressApiService {
  Future<Map<String, dynamic>> getProgress(
      String userId, String targetLanguage) async {
    try {
      final headers = <String, String>{};
      final token = AuthService().token;
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      final response = await http.get(
        Uri.parse(
            '${ApiConfig.baseUrl}${ApiConfig.progress}/$userId?targetLanguage=$targetLanguage'),
        headers: headers,
      );

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
      {String? operationId}) async {
    try {
      final headers = <String, String>{
        'Content-Type': 'application/json',
        if (operationId != null) 'X-Idempotency-Key': operationId,
      };
      final token = AuthService().token;
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      final response = await http.post(
        Uri.parse(
            '${ApiConfig.baseUrl}${ApiConfig.progress}/$userId/complete-lesson'),
        headers: headers,
        body: json.encode({
          'lessonId': lessonId,
          'score': score,
        }),
      );

      if (response.statusCode == 201 || response.statusCode == 200) {
        return json.decode(response.body);
      } else {
        throw Exception('Failed to update progress');
      }
    } catch (e) {
      rethrow;
    }
  }

  Future<void> resetProgress(String userId, {String? operationId}) async {
    final response = await http.delete(
        Uri.parse('${ApiConfig.baseUrl}${ApiConfig.progress}/$userId/reset'),
        headers: {
          if (AuthService().token.isNotEmpty)
            'Authorization': 'Bearer ${AuthService().token}',
          if (operationId != null) 'X-Idempotency-Key': operationId,
        });
    if (response.statusCode != 200) {
      throw StateError('Failed to reset progress');
    }
  }
}
