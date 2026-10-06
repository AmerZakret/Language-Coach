import 'dart:convert';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:http/http.dart' as http;
import '../core/config/api_config.dart';
import '../models/pronunciation_assessment_result.dart';
import 'auth_service.dart';

class PronunciationService {
  Future<PronunciationAssessmentResult> assessPronunciation({
    required String audioPath,
    required String targetText,
    required String targetLanguage,
    String? nativeTranslation,
    String? nativeLanguage,
    String? sourceType,
    String? sourceId,
  }) async {
    try {
      final uri = Uri.parse('${ApiConfig.baseUrl}${ApiConfig.pronunciationAssess}');
      final request = http.MultipartRequest('POST', uri);

      // Attach JWT token if logged in
      final token = AuthService().token;
      if (token.isNotEmpty) {
        request.headers['Authorization'] = 'Bearer $token';
      }

      // Populate form-data text fields
      request.fields['targetText'] = targetText;
      request.fields['targetLanguage'] = targetLanguage;
      
      if (nativeTranslation != null && nativeTranslation.isNotEmpty) {
        request.fields['nativeTranslation'] = nativeTranslation;
      }
      if (nativeLanguage != null && nativeLanguage.isNotEmpty) {
        request.fields['nativeLanguage'] = nativeLanguage;
      }
      if (sourceType != null && sourceType.isNotEmpty) {
        request.fields['sourceType'] = sourceType;
      }
      if (sourceId != null && sourceId.isNotEmpty) {
        request.fields['sourceId'] = sourceId;
      }

      // Attach recorded audio file
      http.MultipartFile file;
      if (kIsWeb) {
        final response = await http.get(Uri.parse(audioPath));
        file = http.MultipartFile.fromBytes(
          'audio',
          response.bodyBytes,
          filename: 'audio.webm',
        );
      } else {
        file = await http.MultipartFile.fromPath('audio', audioPath);
      }
      request.files.add(file);

      // Send the request
      final streamedResponse = await request.send();
      final response = await http.Response.fromStream(streamedResponse);

      if (response.statusCode == 200 || response.statusCode == 201) {
        final decoded = json.decode(response.body);
        return PronunciationAssessmentResult.fromJson(decoded);
      } else {
        String errMsg = 'Failed to assess pronunciation';
        try {
          final errorBody = json.decode(response.body);
          errMsg = errorBody['message'] ?? errMsg;
        } catch (_) {
          if (response.body.isNotEmpty) {
            errMsg = response.body;
          }
        }
        throw Exception(errMsg);
      }
    } catch (e) {
      rethrow;
    }
  }
}
