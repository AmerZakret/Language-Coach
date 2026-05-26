import 'dart:convert';
import 'package:http/http.dart' as http;
import '../core/config/api_config.dart';
import '../models/flashcard.dart';
import 'auth_service.dart';

class FlashcardApiService {
  Future<Flashcard> createFlashcard(
    String userId,
    String targetWord,
    String turkishTranslation, {
    String? exampleSentence,
    String? note,
  }) async {
    try {
      final headers = <String, String>{
        'Content-Type': 'application/json',
      };
      final token = AuthService().token;
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      final response = await http.post(
        Uri.parse('${ApiConfig.baseUrl}${ApiConfig.flashcards}'),
        headers: headers,
        body: json.encode({
          'userId': userId,
          'targetWord': targetWord,
          'turkishTranslation': turkishTranslation,
          if (exampleSentence != null && exampleSentence.isNotEmpty) 'exampleSentence': exampleSentence,
          if (note != null && note.isNotEmpty) 'note': note,
        }),
      );

      if (response.statusCode == 201 || response.statusCode == 200) {
        return Flashcard.fromJson(json.decode(response.body));
      } else {
        throw Exception('Failed to create flashcard: ${response.body}');
      }
    } catch (e) {
      rethrow;
    }
  }

  Future<Flashcard> updateFlashcard(
    String cardId,
    String targetWord,
    String turkishTranslation, {
    String? exampleSentence,
    String? note,
  }) async {
    try {
      final headers = <String, String>{
        'Content-Type': 'application/json',
      };
      final token = AuthService().token;
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      final response = await http.put(
        Uri.parse('${ApiConfig.baseUrl}${ApiConfig.flashcards}/$cardId'),
        headers: headers,
        body: json.encode({
          'targetWord': targetWord,
          'turkishTranslation': turkishTranslation,
          if (exampleSentence != null && exampleSentence.isNotEmpty) 'exampleSentence': exampleSentence,
          if (note != null && note.isNotEmpty) 'note': note,
        }),
      );

      if (response.statusCode == 200) {
        return Flashcard.fromJson(json.decode(response.body));
      } else {
        throw Exception('Failed to update flashcard: ${response.body}');
      }
    } catch (e) {
      rethrow;
    }
  }

  Future<void> deleteFlashcard(String cardId) async {
    try {
      final headers = <String, String>{};
      final token = AuthService().token;
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      final response = await http.delete(
        Uri.parse('${ApiConfig.baseUrl}${ApiConfig.flashcards}/$cardId'),
        headers: headers,
      );

      if (response.statusCode != 200) {
        throw Exception('Failed to delete flashcard: ${response.body}');
      }
    } catch (e) {
      rethrow;
    }
  }

  Future<List<Flashcard>> getDueCards(String userId) async {
    try {
      final headers = <String, String>{};
      final token = AuthService().token;
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      final response = await http.get(
        Uri.parse('${ApiConfig.baseUrl}${ApiConfig.flashcards}/due?userId=$userId'),
        headers: headers,
      );

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

  Future<List<Flashcard>> getAllCards(String userId) async {
    try {
      final headers = <String, String>{};
      final token = AuthService().token;
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      final response = await http.get(
        Uri.parse('${ApiConfig.baseUrl}${ApiConfig.flashcards}/all?userId=$userId'),
        headers: headers,
      );

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

  Future<Flashcard> reviewCard(String cardId, int score) async {
    try {
      final headers = <String, String>{
        'Content-Type': 'application/json',
      };
      final token = AuthService().token;
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      final response = await http.put(
        Uri.parse('${ApiConfig.baseUrl}${ApiConfig.flashcards}/$cardId/review'),
        headers: headers,
        body: json.encode({
          'score': score,
        }),
      );

      if (response.statusCode == 200) {
        return Flashcard.fromJson(json.decode(response.body));
      } else {
        throw Exception('Failed to review flashcard');
      }
    } catch (e) {
      rethrow;
    }
  }
}
