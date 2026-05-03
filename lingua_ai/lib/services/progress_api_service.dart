import 'dart:convert';
import 'package:http/http.dart' as http;
import '../core/config/api_config.dart';

class ProgressApiService {
  Future<Map<String, dynamic>> getProgress(String userId) async {
    try {
      final response = await http.get(
        Uri.parse('${ApiConfig.baseUrl}${ApiConfig.progress}/$userId'),
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
      String userId, String lessonId, int score) async {
    try {
      final response = await http.post(
        Uri.parse('${ApiConfig.baseUrl}${ApiConfig.progress}/$userId/complete-lesson'),
        headers: {'Content-Type': 'application/json'},
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
}
