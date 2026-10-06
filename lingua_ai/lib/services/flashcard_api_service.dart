import 'dart:convert';
import 'package:http/http.dart' as http;
import '../core/config/api_config.dart';
import '../models/flashcard.dart';
import 'auth_service.dart';
import 'sync_retry_policy.dart';

class FlashcardApiService {
  Future<Flashcard> createFlashcard(
    String targetWord,
    String turkishTranslation,
    String targetLanguage, {
    String? nativeLanguage,
    String? nativeTranslation,
    String? exampleSentence,
    String? note,
    String? operationId,
  }) async {
    try {
      final headers = <String, String>{
        'Content-Type': 'application/json',
        if (operationId != null) 'X-Idempotency-Key': operationId,
      };
      final token = AuthService().token;
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      final response = await http
          .post(
            Uri.parse('${ApiConfig.baseUrl}${ApiConfig.flashcards}'),
            headers: headers,
            body: json.encode({
              'targetWord': targetWord,
              'turkishTranslation': turkishTranslation,
              'targetLanguage': targetLanguage,
              if (nativeLanguage != null) 'nativeLanguage': nativeLanguage,
              if (nativeTranslation != null)
                'nativeTranslation': nativeTranslation,
              if (exampleSentence != null && exampleSentence.isNotEmpty)
                'exampleSentence': exampleSentence,
              if (note != null && note.isNotEmpty) 'note': note,
            }),
          )
          .timeout(replayTimeout);

      if (response.statusCode == 201 || response.statusCode == 200) {
        return Flashcard.fromJson(json.decode(response.body));
      } else {
        throw SyncHttpException(response.statusCode);
      }
    } catch (e) {
      rethrow;
    }
  }

  Future<Flashcard> updateFlashcard(
    String cardId,
    String targetWord,
    String turkishTranslation, {
    String? targetLanguage,
    String? nativeLanguage,
    String? nativeTranslation,
    String? exampleSentence,
    String? note,
    String? operationId,
  }) async {
    try {
      final headers = <String, String>{
        'Content-Type': 'application/json',
        if (operationId != null) 'X-Idempotency-Key': operationId,
      };
      final token = AuthService().token;
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      final response = await http
          .put(
            Uri.parse('${ApiConfig.baseUrl}${ApiConfig.flashcards}/$cardId'),
            headers: headers,
            body: json.encode({
              'targetWord': targetWord,
              'turkishTranslation': turkishTranslation,
              if (targetLanguage != null) 'targetLanguage': targetLanguage,
              if (nativeLanguage != null) 'nativeLanguage': nativeLanguage,
              if (nativeTranslation != null)
                'nativeTranslation': nativeTranslation,
              if (exampleSentence != null && exampleSentence.isNotEmpty)
                'exampleSentence': exampleSentence,
              if (note != null && note.isNotEmpty) 'note': note,
            }),
          )
          .timeout(replayTimeout);

      if (response.statusCode == 200) {
        return Flashcard.fromJson(json.decode(response.body));
      } else {
        throw SyncHttpException(response.statusCode);
      }
    } catch (e) {
      rethrow;
    }
  }

  Future<void> deleteFlashcard(String cardId, {String? operationId}) async {
    try {
      final headers = <String, String>{};
      if (operationId != null) headers['X-Idempotency-Key'] = operationId;
      final token = AuthService().token;
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      final response = await http
          .delete(
            Uri.parse('${ApiConfig.baseUrl}${ApiConfig.flashcards}/$cardId'),
            headers: headers,
          )
          .timeout(replayTimeout);

      if (response.statusCode != 200) {
        throw SyncHttpException(response.statusCode);
      }
    } catch (e) {
      rethrow;
    }
  }

  Future<List<Flashcard>> getDueCards({String? targetLanguage}) async {
    try {
      final headers = <String, String>{};
      final token = AuthService().token;
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      var url =
          '${ApiConfig.baseUrl}${ApiConfig.flashcards}/due';
      if (targetLanguage != null && targetLanguage.isNotEmpty) {
        url += '?targetLanguage=$targetLanguage';
      }

      final response = await http
          .get(
            Uri.parse(url),
            headers: headers,
          )
          .timeout(replayTimeout);

      if (response.statusCode == 200) {
        final List body = json.decode(response.body);
        return body.map((item) => Flashcard.fromJson(item)).toList();
      } else {
        throw Exception('Failed to fetch due flashcards');
      }
    } catch (e) {
      rethrow;
    }
  }

  Future<List<Flashcard>> getAllCards({String? targetLanguage}) async {
    try {
      final headers = <String, String>{};
      final token = AuthService().token;
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      var url =
          '${ApiConfig.baseUrl}${ApiConfig.flashcards}/all';
      if (targetLanguage != null && targetLanguage.isNotEmpty) {
        url += '?targetLanguage=$targetLanguage';
      }

      final response = await http
          .get(
            Uri.parse(url),
            headers: headers,
          )
          .timeout(replayTimeout);

      if (response.statusCode == 200) {
        final List body = json.decode(response.body);
        return body.map((item) => Flashcard.fromJson(item)).toList();
      } else {
        throw Exception('Failed to fetch all flashcards');
      }
    } catch (e) {
      rethrow;
    }
  }

  Future<Flashcard> reviewCard(String cardId, int score,
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

      final response = await http
          .put(
            Uri.parse(
                '${ApiConfig.baseUrl}${ApiConfig.flashcards}/$cardId/review'),
            headers: headers,
            body: json.encode({
              'score': score,
            }),
          )
          .timeout(replayTimeout);

      if (response.statusCode == 200) {
        return Flashcard.fromJson(json.decode(response.body));
      } else {
        throw SyncHttpException(response.statusCode);
      }
    } catch (e) {
      rethrow;
    }
  }
}
