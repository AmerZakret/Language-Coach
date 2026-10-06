import 'dart:convert';
import 'package:http/http.dart' as http;
import '../core/config/api_config.dart';
import 'auth_service.dart';

class AiCoachApiService {
  Future<Map<String, dynamic>> sendMessage({
    required String message,
    required String language,
    String? targetLanguage,
  }) async {
    try {
      final body = <String, dynamic>{
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
        try {
          final errorData = json.decode(response.body);
          throw Exception(errorData['message'] ?? 'Failed to communicate with AI Coach');
        } catch (_) {
          throw Exception('Failed to communicate with AI Coach');
        }
      }
    } catch (e) {
      throw Exception('Network error or server offline: $e');
    }
  }

  Future<List<dynamic>> getHistory({
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
          '${ApiConfig.baseUrl}${ApiConfig.aiCoach}/history?targetLanguage=$targetLanguage',
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

  Future<void> clearHistory({
    required String targetLanguage,
  }) async {
    try {
      final headers = <String, String>{};
      final token = AuthService().token;
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      final response = await http.delete(
        Uri.parse(
          '${ApiConfig.baseUrl}${ApiConfig.aiCoach}/clear?targetLanguage=$targetLanguage',
        ),
        headers: headers,
      );

      if (response.statusCode != 200 && response.statusCode != 204) {
        throw Exception('Failed to clear chat history: ${response.body}');
      }
    } catch (e) {
      throw Exception('Network error or server offline: $e');
    }
  }

  Future<Map<String, dynamic>> checkWriting({
    required String topic,
    required String text,
    required String language,
    required String targetLanguage,
  }) async {
    try {
      final body = <String, dynamic>{
        'topic': topic,
        'text': text,
        'language': language,
        'targetLanguage': targetLanguage,
      };

      final headers = <String, String>{
        'Content-Type': 'application/json',
      };
      final token = AuthService().token;
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      final response = await http.post(
        Uri.parse('${ApiConfig.baseUrl}${ApiConfig.aiCoach}/writing-check'),
        headers: headers,
        body: json.encode(body),
      );

      if (response.statusCode == 200 || response.statusCode == 201) {
        return json.decode(response.body);
      } else {
        throw Exception('Failed to get writing assessment');
      }
    } catch (e) {
      throw Exception('Network error or server offline: $e');
    }
  }
}
