import '../core/localization/target_language.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../core/config/api_config.dart';
import 'auth_service.dart';
import 'api_response.dart';

class UserApiService {
  Future<Map<String, dynamic>> fetchMe() async {
    try {
      final session = AuthService().captureSession();
      final token = AuthService().token;
      final response = await apiRequest(
          () => http.get(
                Uri.parse('${ApiConfig.baseUrl}/users/me'),
                headers: {
                  'Authorization': 'Bearer $token',
                },
              ),
          session);

      return parsePublicUser(json.decode(response.body));
    } catch (e) {
      rethrow;
    }
  }

  Future<Map<String, dynamic>> updateProfile({
    String? name,
    String? targetLanguage,
  }) async {
    try {
      final session = AuthService().captureSession();
      final token = AuthService().token;
      final response = await apiRequest(
          () => http.patch(
                Uri.parse('${ApiConfig.baseUrl}/users/profile'),
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': 'Bearer $token',
                },
                body: json.encode({
                  if (name != null) 'name': name,
                  if (targetLanguage != null)
                    'targetLanguage': TargetLanguage.code(targetLanguage),
                }),
              ),
          session);

      return parsePublicUser(json.decode(response.body));
    } catch (e) {
      rethrow;
    }
  }
}
