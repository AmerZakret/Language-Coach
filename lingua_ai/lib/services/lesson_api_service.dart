import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/lesson.dart';
import '../core/config/api_config.dart';
import '../data/dummy_data.dart';

class LessonApiService {
  Future<List<Lesson>> fetchLessons(String targetLanguage) async {
    try {
      final response = await http.get(Uri.parse(
          '${ApiConfig.baseUrl}${ApiConfig.lessons}?targetLanguage=$targetLanguage'));

      if (response.statusCode == 200) {
        final List<dynamic> data = json.decode(response.body);
        return data.map((json) => Lesson.fromJson(json)).toList();
      } else {
        throw Exception('Failed to load lessons from server');
      }
    } catch (e) {
      // Fallback to dummy data if API fails
      return DummyData.getLessons(targetLanguage);
    }
  }

  Future<Lesson> fetchLessonById(String id) async {
    try {
      final response = await http
          .get(Uri.parse('${ApiConfig.baseUrl}${ApiConfig.lessons}/$id'));

      if (response.statusCode == 200) {
        return Lesson.fromJson(json.decode(response.body));
      } else {
        throw Exception('Failed to load lesson details');
      }
    } catch (e) {
      // Fallback to dummy data by finding the lesson in the local list
      final localLessons = DummyData.getAllLessons();
      return localLessons.firstWhere(
        (l) => l.id == id,
        orElse: () => localLessons[0],
      );
    }
  }
}
