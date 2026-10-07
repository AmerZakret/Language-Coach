import 'ai_coach_api_service.dart';
import '../core/localization/language_service.dart';

class WritingFeedback {
  final String overallFeedback;
  final String correctedVersion;
  final String mistakes;
  final double grammarScore;
  final double vocabularyScore;
  final double clarityScore;
  final double overallScore;

  WritingFeedback({
    required this.overallFeedback,
    required this.correctedVersion,
    required this.mistakes,
    required this.grammarScore,
    required this.vocabularyScore,
    required this.clarityScore,
    required this.overallScore,
  });
  factory WritingFeedback.fromJson(Map<String, dynamic> data) {
    double score(String field) {
      final value = data[field];
      if (value is! num || !value.isFinite || value < 0 || value > 100) {
        throw FormatException('Invalid writing score: $field');
      }
      return value.toDouble();
    }

    if (data['feedback'] is! String ||
        data['improvedVersion'] is! String ||
        data['corrections'] is! List) {
      throw const FormatException('Incomplete writing evaluation');
    }
    final mistakes = StringBuffer();
    for (final item in data['corrections'] as List) {
      if (item is! Map ||
          ['original', 'correction', 'explanation']
              .any((field) => item[field] is! String)) {
        throw const FormatException('Invalid writing correction');
      }
      mistakes.writeln(
          '- "${item['original']}" -> "${item['correction']}": ${item['explanation']}');
    }
    return WritingFeedback(
        overallFeedback: data['feedback'] as String,
        correctedVersion: data['improvedVersion'] as String,
        mistakes: mistakes.toString(),
        grammarScore: score('grammarScore'),
        vocabularyScore: score('vocabularyScore'),
        clarityScore: score('clarityScore'),
        overallScore: score('overallScore'));
  }
}

class WritingApiService {
  final AiCoachApiService _aiService = AiCoachApiService();

  Future<WritingFeedback> checkWriting({
    required String topic,
    required String userText,
    required String targetLanguage,
  }) async {
    final language = LanguageService().currentLanguage;

    final response = await _aiService.checkWriting(
      topic: topic,
      text: userText,
      language: language,
      targetLanguage: targetLanguage,
    );

    return WritingFeedback.fromJson(response);
  }
}
