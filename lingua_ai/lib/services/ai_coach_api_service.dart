import 'dart:convert';
import 'package:http/http.dart' as http;
import '../core/config/api_config.dart';
import 'auth_service.dart';

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

      final headers = <String, String>{
        'Content-Type': 'application/json',
      };
      final token = AuthService().token;
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      final response = await http.post(
        Uri.parse('${ApiConfig.baseUrl}${ApiConfig.aiCoach}/chat'),
        headers: headers,
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
      final headers = <String, String>{
        'Content-Type': 'application/json',
      };
      final token = AuthService().token;
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      final response = await http.get(
        Uri.parse(
          '${ApiConfig.baseUrl}${ApiConfig.aiCoach}/history?userId=$userId&targetLanguage=$targetLanguage',
        ),
        headers: headers,
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
