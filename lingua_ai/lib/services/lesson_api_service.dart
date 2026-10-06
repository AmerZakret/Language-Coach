import '../core/localization/target_language.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../models/lesson.dart';
import '../core/config/api_config.dart';
import '../data/dummy_data.dart';
import 'connectivity_service.dart';

class LessonNotFoundException implements Exception {
  final String id;
  const LessonNotFoundException(this.id);

  @override
  String toString() => 'Lesson not found: $id';
}

class LessonApiService {
  Future<List<Lesson>> fetchLessons(String targetLanguage) async {
    final code = TargetLanguage.code(targetLanguage);
    try {
      if (ConnectivityService().isOffline) {
        throw Exception('Device is offline');
      }

      final response = await http.get(Uri.parse(
          '${ApiConfig.baseUrl}${ApiConfig.lessons}?targetLanguage=$code'));

      if (response.statusCode == 200) {
        final List<dynamic> data = json.decode(response.body);
        
        // Cache lessons in SharedPreferences
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('lessons_cache_$targetLanguage', response.body);

        return data.map((json) => Lesson.fromJson(json)).toList();
      } else {
        throw Exception('Failed to load lessons from server');
      }
    } catch (e) {
      // Fallback to cached lessons
      final prefs = await SharedPreferences.getInstance();
      final cachedJson = prefs.getString('lessons_cache_$targetLanguage');
      if (cachedJson != null) {
        try {
          final List<dynamic> data = json.decode(cachedJson);
          return data.map((json) => Lesson.fromJson(json)).toList();
        } catch (_) {}
      }
      
      // Fallback to dummy data if cache is empty
      return DummyData.getLessons(code);
    }
  }

  Future<Lesson> fetchLessonById(String id) async {
    try {
      if (ConnectivityService().isOffline) {
        throw Exception('Device is offline');
      }

      final response = await http
          .get(Uri.parse('${ApiConfig.baseUrl}${ApiConfig.lessons}/$id'));

      if (response.statusCode == 200) {
        return _parseDetails(json.decode(response.body), id);
      } else if (response.statusCode == 404) {
        throw LessonNotFoundException(id);
      } else {
        throw Exception('Failed to load lesson details');
      }
    } on LessonNotFoundException {
      rethrow;
    } on FormatException {
      rethrow;
    } catch (e) {
      // Fallback: search in cached lessons first
      try {
        final prefs = await SharedPreferences.getInstance();
        for (final key in prefs.getKeys()) {
          if (key.startsWith('lessons_cache_')) {
            final cachedJson = prefs.getString(key);
            if (cachedJson != null) {
              final List<dynamic> data = json.decode(cachedJson);
              final match = data.firstWhere(
                (item) => item['id'] == id &&
                    item['questions'] is List &&
                    (item['questions'] as List).isNotEmpty,
                orElse: () => null,
              );
              if (match != null) {
                return _parseDetails(match, id);
              }
            }
          }
        }
      } catch (_) {}

      // Fallback to dummy data by finding the lesson in the local list
      final localLessons = DummyData.getAllLessons();
      for (final lesson in localLessons) {
        if (lesson.id == id && lesson.questions.isNotEmpty) return lesson;
      }
      throw LessonNotFoundException(id);
    }
  }

  Lesson _parseDetails(Map<String, dynamic> json, String id) {
    final lesson = Lesson.fromJson(json);
    if (lesson.id != id || lesson.questions.isEmpty) {
      throw const FormatException('Invalid lesson details');
    }
    return lesson;
  }
}
