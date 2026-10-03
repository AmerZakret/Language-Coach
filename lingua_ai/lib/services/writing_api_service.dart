import 'ai_coach_api_service.dart';
import 'auth_service.dart';
import '../core/localization/language_service.dart';

class WritingFeedback {
  final String overallFeedback;
  final String correctedVersion;
  final String mistakes;
  final int grammarScore;
  final int vocabularyScore;
  final int clarityScore;

  WritingFeedback({
    required this.overallFeedback,
    required this.correctedVersion,
    required this.mistakes,
    required this.grammarScore,
    required this.vocabularyScore,
    required this.clarityScore,
  });
}

class WritingApiService {
  final AiCoachApiService _aiService = AiCoachApiService();

  Future<WritingFeedback> checkWriting({
    required String topic,
    required String userText,
    required String targetLanguage,
  }) async {
    final auth = AuthService();
    final userId = auth.isGuest
        ? 'guest'
        : (auth.currentUserId.isNotEmpty
            ? auth.currentUserId
            : (auth.currentUserEmail.isNotEmpty
                ? auth.currentUserEmail
                : 'guest'));
    final language = LanguageService().currentLanguage;

    final response = await _aiService.checkWriting(
      userId: userId,
      topic: topic,
      text: userText,
      language: language,
      targetLanguage: targetLanguage,
    );

    final grammarScore = response['grammarScore'] as int? ?? 70;
    final vocabularyScore = response['vocabularyScore'] as int? ?? 70;
    final clarityScore = response['clarityScore'] as int? ?? 70;
    final feedback = response['feedback'] as String? ?? '';
    final improvedVersion = response['improvedVersion'] as String? ?? userText;

    final correctionsList = response['corrections'] as List? ?? [];
    final mistakesBuffer = StringBuffer();
    for (var correction in correctionsList) {
      final orig = correction['original'] ?? '';
      final corr = correction['correction'] ?? '';
      final exp = correction['explanation'] ?? '';
      mistakesBuffer.writeln('- "$orig" -> "$corr": $exp');
    }

    return WritingFeedback(
      overallFeedback: feedback,
      correctedVersion: improvedVersion,
      mistakes: mistakesBuffer.toString(),
      grammarScore: (grammarScore / 10).round().clamp(1, 10),
      vocabularyScore: (vocabularyScore / 10).round().clamp(1, 10),
      clarityScore: (clarityScore / 10).round().clamp(1, 10),
    );
  }
}
