class Question {
  final String text;
  final List<String> options;
  final String correctAnswer;

  Question({
    required this.text,
    required this.options,
    required this.correctAnswer,
  });

  factory Question.fromJson(Map<String, dynamic> json) {
    return Question(
      text: json['text'] ?? '',
      options: List<String>.from(json['options'] ?? []),
      correctAnswer: json['correctAnswer'] ?? '',
    );
  }
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

  factory Lesson.fromJson(Map<String, dynamic> json) {
    return Lesson(
      id: json['id']?.toString() ?? '',
      title: json['title'] ?? '',
      description: json['description'] ?? '',
      level: json['level'] ?? '',
      type: json['type'] ?? '',
      xpReward: json['xpReward'] ?? 0,
      durationMinutes: json['durationMinutes'] ?? 0,
      questions: (json['questions'] as List?)
              ?.map((q) => Question.fromJson(q))
              .toList() ??
          [],
      progress: (json['progress']?.toDouble()) ?? 0.0,
    );
  }
}
