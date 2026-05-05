import 'dart:convert';
import 'package:http/http.dart' as http;
import '../core/config/api_config.dart';

class AiCoachApiService {
  Future<Map<String, dynamic>> sendMessage({
    required String userId,
    required String message,
    required String language,
  }) async {
    try {
      final response = await http.post(
        Uri.parse('${ApiConfig.baseUrl}${ApiConfig.aiCoach}'),
        headers: {'Content-Type': 'application/json'},
        body: json.encode({
          'userId': userId,
          'message': message,
          'language': language,
        }),
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
}
