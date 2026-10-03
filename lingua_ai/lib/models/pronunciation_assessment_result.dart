class PronunciationAssessmentResult {
  final String targetText;
  final String recognizedText;
  final String targetLanguage;
  final int pronunciationScore;
  final String result;
  final String aiFeedback;
  final String provider;

  PronunciationAssessmentResult({
    required this.targetText,
    required this.recognizedText,
    required this.targetLanguage,
    required this.pronunciationScore,
    required this.result,
    required this.aiFeedback,
    required this.provider,
  });

  factory PronunciationAssessmentResult.fromJson(Map<String, dynamic> json) {
    return PronunciationAssessmentResult(
      targetText: json['targetText'] ?? '',
      recognizedText: json['recognizedText'] ?? '',
      targetLanguage: json['targetLanguage'] ?? '',
      pronunciationScore: json['pronunciationScore'] ?? 0,
      result: json['result'] ?? 'try_again',
      aiFeedback: json['aiFeedback'] ?? '',
      provider: json['provider'] ?? '',
    );
  }
}
