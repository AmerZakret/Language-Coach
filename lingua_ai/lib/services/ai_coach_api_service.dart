import 'dart:convert';
import 'package:http/http.dart' as http;
import '../core/config/api_config.dart';

class AiCoachApiService {
  Future<Map<String, dynamic>> sendMessage({
    required String userId,
    required String message,
    required String language,
    String? targetLanguage,
  }) async {
    try {
      final body = <String, dynamic>{
        'userId': userId,
        'message': message,
        'language': language,
      };
      if (targetLanguage != null) {
        body['targetLanguage'] = targetLanguage;
      }

      final response = await http.post(
        Uri.parse('${ApiConfig.baseUrl}${ApiConfig.aiCoach}/chat'),
        headers: {'Content-Type': 'application/json'},
        body: json.encode(body),
      );

      if (response.statusCode == 200 || response.statusCode == 201) {
        return json.decode(response.body);
      } else {
        throw Exception('Failed to communicate with AI Coach');
      }
    } catch (e) {
      throw Exception('Network error or server offline: $e');
    }
  }

  Future<List<dynamic>> getHistory({
    required String userId,
    required String targetLanguage,
  }) async {
    try {
      final response = await http.get(
        Uri.parse(
          '${ApiConfig.baseUrl}${ApiConfig.aiCoach}/history?userId=$userId&targetLanguage=$targetLanguage',
        ),
        headers: {'Content-Type': 'application/json'},
      );

      if (response.statusCode == 200) {
        return json.decode(response.body);
      } else {
        throw Exception('Failed to load chat history');
      }
    } catch (e) {
      throw Exception('Network error or server offline: $e');
    }
  }
}
