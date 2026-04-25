class Question {
  final String text;
  final List<String> options;
  final String correctAnswer;

  Question({
    required this.text,
    required this.options,
    required this.correctAnswer,
  });
}

class Lesson {
  final String id;
  final String title;
  final String description;
  final String level;
  final String type;
  final int xpReward;
  final int durationMinutes;
  final double progress; // 0.0 to 1.0
  final List<Question> questions;

  Lesson({
    required this.id,
    required this.title,
    required this.description,
    required this.level,
    required this.type,
    required this.xpReward,
    required this.durationMinutes,
    required this.questions,
    this.progress = 0.0,
  });
}
