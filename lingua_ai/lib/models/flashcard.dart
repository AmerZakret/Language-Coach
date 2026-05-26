class FlashcardHistory {
  final DateTime date;
  final int score;

  FlashcardHistory({
    required this.date,
    required this.score,
  });

  factory FlashcardHistory.fromJson(Map<String, dynamic> json) {
    return FlashcardHistory(
      date: json['date'] != null ? DateTime.parse(json['date']) : DateTime.now(),
      score: json['score'] ?? 0,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'date': date.toIso8601String(),
      'score': score,
    };
  }
}

class FlashcardAiContext {
  final List<String> sentences;
  final String mnemonic;

  FlashcardAiContext({
    required this.sentences,
    required this.mnemonic,
  });

  factory FlashcardAiContext.fromJson(Map<String, dynamic> json) {
    return FlashcardAiContext(
      sentences: List<String>.from(json['sentences'] ?? []),
      mnemonic: json['mnemonic'] ?? '',
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'sentences': sentences,
      'mnemonic': mnemonic,
    };
  }
}

class Flashcard {
  final String id;
  final String userId;
  final String targetWord;
  final String turkishTranslation;
  final String? exampleSentence;
  final String? note;
  final int interval;
  final double easinessFactor;
  final DateTime nextReviewDate;
  final int reviewCount;
  final List<FlashcardHistory> history;
  final FlashcardAiContext aiContext;

  Flashcard({
    required this.id,
    required this.userId,
    required this.targetWord,
    required this.turkishTranslation,
    this.exampleSentence,
    this.note,
    required this.interval,
    required this.easinessFactor,
    required this.nextReviewDate,
    required this.reviewCount,
    required this.history,
    required this.aiContext,
  });

  factory Flashcard.fromJson(Map<String, dynamic> json) {
    return Flashcard(
      id: json['_id']?.toString() ?? json['id']?.toString() ?? '',
      userId: json['userId']?.toString() ?? '',
      targetWord: json['targetWord'] ?? '',
      turkishTranslation: json['turkishTranslation'] ?? json['translation'] ?? '',
      exampleSentence: json['exampleSentence'],
      note: json['note'],
      interval: json['interval'] ?? 0,
      easinessFactor: (json['easinessFactor'] as num?)?.toDouble() ?? 2.5,
      nextReviewDate: json['nextReviewDate'] != null
          ? DateTime.parse(json['nextReviewDate'])
          : DateTime.now(),
      reviewCount: json['reviewCount'] ?? 0,
      history: (json['history'] as List?)
              ?.map((h) => FlashcardHistory.fromJson(h))
              .toList() ??
          [],
      aiContext: json['aiContext'] != null
          ? FlashcardAiContext.fromJson(json['aiContext'])
          : FlashcardAiContext(sentences: [], mnemonic: ''),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      '_id': id,
      'userId': userId,
      'targetWord': targetWord,
      'turkishTranslation': turkishTranslation,
      if (exampleSentence != null) 'exampleSentence': exampleSentence,
      if (note != null) 'note': note,
      'interval': interval,
      'easinessFactor': easinessFactor,
      'nextReviewDate': nextReviewDate.toIso8601String(),
      'reviewCount': reviewCount,
      'history': history.map((h) => h.toJson()).toList(),
      'aiContext': aiContext.toJson(),
    };
  }

  Flashcard copyWith({
    String? id,
    String? userId,
    String? targetWord,
    String? turkishTranslation,
    String? exampleSentence,
    String? note,
    int? interval,
    double? easinessFactor,
    DateTime? nextReviewDate,
    int? reviewCount,
    List<FlashcardHistory>? history,
    FlashcardAiContext? aiContext,
  }) {
    return Flashcard(
      id: id ?? this.id,
      userId: userId ?? this.userId,
      targetWord: targetWord ?? this.targetWord,
      turkishTranslation: turkishTranslation ?? this.turkishTranslation,
      exampleSentence: exampleSentence ?? this.exampleSentence,
      note: note ?? this.note,
      interval: interval ?? this.interval,
      easinessFactor: easinessFactor ?? this.easinessFactor,
      nextReviewDate: nextReviewDate ?? this.nextReviewDate,
      reviewCount: reviewCount ?? this.reviewCount,
      history: history ?? this.history,
      aiContext: aiContext ?? this.aiContext,
    );
  }
}
