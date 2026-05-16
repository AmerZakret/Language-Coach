class Question {
  final String id;
  final String question;
  final List<String> options;
  final String correctAnswer;
  final String type;

  Question({
    required this.id,
    required this.question,
    required this.options,
    required this.correctAnswer,
    required this.type,
  });

  factory Question.fromJson(Map<String, dynamic> json) {
    return Question(
      id: json['id']?.toString() ?? '',
      question: json['question'] ?? json['text'] ?? '', // Fallback for old 'text' field
      options: List<String>.from(json['options'] ?? []),
      correctAnswer: json['correctAnswer'] ?? '',
      type: json['type'] ?? 'multiple_choice',
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'question': question,
      'options': options,
      'correctAnswer': correctAnswer,
      'type': type,
    };
  }
}

class Lesson {
  final String id;
  final String targetLanguage;
  final String title;
  final String description;
  final String category;
  final String difficulty;
  final int duration;
  final int xpReward;
  final List<Question> questions;
  final double progress; // 0.0 to 1.0

  Lesson({
    required this.id,
    required this.targetLanguage,
    required this.title,
    required this.description,
    required this.category,
    required this.difficulty,
    required this.duration,
    required this.xpReward,
    required this.questions,
    this.progress = 0.0,
  });

  factory Lesson.fromJson(Map<String, dynamic> json) {
    return Lesson(
      id: json['id']?.toString() ?? '',
      targetLanguage: json['targetLanguage'] ?? 'en',
      title: json['title'] ?? '',
      description: json['description'] ?? '',
      category: json['category'] ?? json['type'] ?? 'Vocabulary', // Fallback for 'type'
      difficulty: json['difficulty'] ?? json['level'] ?? 'Beginner', // Fallback for 'level'
      duration: json['duration'] ?? json['durationMinutes'] ?? 0, // Fallback for 'durationMinutes'
      xpReward: json['xpReward'] ?? 0,
      questions: (json['questions'] as List?)
              ?.map((q) => Question.fromJson(q))
              .toList() ??
          [],
      progress: (json['progress']?.toDouble()) ?? 0.0,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'targetLanguage': targetLanguage,
      'title': title,
      'description': description,
      'category': category,
      'difficulty': difficulty,
      'duration': duration,
      'xpReward': xpReward,
      'questions': questions.map((q) => q.toJson()).toList(),
      'progress': progress,
    };
  }
}
