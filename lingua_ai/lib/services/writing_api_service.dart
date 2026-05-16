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
    final userId = auth.isGuest || auth.currentUserEmail.isEmpty
        ? 'guest'
        : auth.currentUserEmail;
    final language = LanguageService().currentLanguage;

    // Craft a compact prompt that fits within the 500-char backend limit.
    // The backend system prompt already returns JSON with "reply" and "correction".
    final message =
        '[WRITING CHECK] Target:$targetLanguage Topic:$topic '
        'Text:"$userText" '
        'Rate grammar,vocabulary,clarity /10. List mistakes. Be encouraging.';

    final response = await _aiService.sendMessage(
      userId: userId,
      message: message,
      language: language,
    );

    final reply = response['reply'] as String? ?? '';
    final correction = response['correction'] as String? ?? userText;

    return _parseResponse(reply, correction);
  }

  WritingFeedback _parseResponse(String reply, String correction) {
    // Try to extract scores from the AI reply using regex
    int grammarScore = _extractScore(reply, r'[Gg]rammar[:\s]*(\d+)');
    int vocabScore = _extractScore(reply, r'[Vv]ocab\w*[:\s]*(\d+)');
    int clarityScore = _extractScore(reply, r'[Cc]larity[:\s]*(\d+)');

    // If scores weren't found in expected format, try alternate patterns
    if (grammarScore == 0 && vocabScore == 0 && clarityScore == 0) {
      // Try patterns like "Grammar: 8/10"
      grammarScore = _extractScore(reply, r'[Gg]rammar[:\s]*(\d+)/10');
      vocabScore = _extractScore(reply, r'[Vv]ocab\w*[:\s]*(\d+)/10');
      clarityScore = _extractScore(reply, r'[Cc]larity[:\s]*(\d+)/10');
    }

    // Default scores if AI didn't provide them
    if (grammarScore == 0) grammarScore = 7;
    if (vocabScore == 0) vocabScore = 7;
    if (clarityScore == 0) clarityScore = 7;

    // Try to extract mistakes section
    String mistakes = _extractSection(reply, r'[Mm]istakes?[:\s]*(.+?)(?=\n\n|\n[A-Z]|$)');
    if (mistakes.isEmpty) {
      mistakes = _extractSection(reply, r'[Ee]rrors?[:\s]*(.+?)(?=\n\n|\n[A-Z]|$)');
    }
    if (mistakes.isEmpty) {
      mistakes = _extractSection(reply, r'[Hh]atalar[:\s]*(.+?)(?=\n\n|\n[A-Z]|$)');
    }

    return WritingFeedback(
      overallFeedback: reply,
      correctedVersion: correction,
      mistakes: mistakes,
      grammarScore: grammarScore.clamp(1, 10),
      vocabularyScore: vocabScore.clamp(1, 10),
      clarityScore: clarityScore.clamp(1, 10),
    );
  }

  int _extractScore(String text, String pattern) {
    final match = RegExp(pattern).firstMatch(text);
    if (match != null) {
      return int.tryParse(match.group(1) ?? '') ?? 0;
    }
    return 0;
  }

  String _extractSection(String text, String pattern) {
    final match = RegExp(pattern, dotAll: true).firstMatch(text);
    if (match != null) {
      return match.group(1)?.trim() ?? '';
    }
    return '';
  }
}
