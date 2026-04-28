import '../models/lesson.dart';

class DummyData {
  static List<Lesson> getLessons() {
    return [
      Lesson(
        id: '1',
        title: 'Basic Greetings',
        description: 'Learn how to say hello, goodbye, and ask how someone is doing.',
        level: 'Beginner',
        type: 'Vocabulary',
        xpReward: 50,
        durationMinutes: 5,
        progress: 1.0,
        questions: [
          Question(
            text: 'What does "Hello" mean in Turkish?',
            options: ['Hoşça kal', 'Merhaba', 'Teşekkürler', 'Lütfen'],
            correctAnswer: 'Merhaba',
          ),
          Question(
            text: 'Translate: "Nasılsın?" to English',
            options: ['How are you?', 'What is your name?', 'Where are you?', 'Good morning'],
            correctAnswer: 'How are you?',
          ),
          Question(
            text: 'Which of the following means "Hoşça kal"?',
            options: ['Good morning', 'Hello', 'Goodbye', 'Sorry'],
            correctAnswer: 'Goodbye',
          ),
        ],
      ),
      Lesson(
        id: '2',
        title: 'Ordering Food',
        description: 'Essential phrases for ordering at a restaurant.',
        level: 'Beginner',
        type: 'Vocabulary',
        xpReward: 75,
        durationMinutes: 10,
        progress: 0.5,
        questions: [
          Question(
            text: 'Translate: "Bir kahve istiyorum, lütfen." to English',
            options: [
              'I would like a coffee, please.',
              'I want water, thanks.',
              'Where is the menu?',
              'The bill, please.'
            ],
            correctAnswer: 'I would like a coffee, please.',
          ),
          Question(
            text: 'How do you ask for "hesap" (the bill)?',
            options: ['The bathroom', 'The menu', 'The table', 'The bill'],
            correctAnswer: 'The bill',
          ),
        ],
      ),
      Lesson(
        id: '3',
        title: 'Travel Directions',
        description: 'Ask for directions and understand common responses.',
        level: 'Intermediate',
        type: 'Grammar',
        xpReward: 100,
        durationMinutes: 15,
        progress: 0.0,
        questions: [
          Question(
            text: 'Translate: "Tren istasyonu nerede?" to English',
            options: [
              'Where is the airport?',
              'Where is the train station?',
              'What time does the train leave?',
              'How much is a ticket?'
            ],
            correctAnswer: 'Where is the train station?',
          ),
          Question(
            text: 'Choose the correct grammar:',
            options: ['She go to school', 'She goes to school', 'She going school', 'She gone school'],
            correctAnswer: 'She goes to school',
          ),
        ],
      ),
      Lesson(
        id: '4',
        title: 'Business Introductions',
        description: 'Formal greetings and introducing yourself in a professional setting.',
        level: 'Advanced',
        type: 'Conversation',
        xpReward: 150,
        durationMinutes: 12,
        progress: 0.0,
        questions: [
          Question(
            text: 'Translate: "Tanıştığıma memnun oldum." to English',
            options: [
              'Nice to meet you.',
              'It is a pleasure to meet you.',
              'Glad to meet you.',
              'All of the above.'
            ],
            correctAnswer: 'All of the above.',
          ),
        ],
      ),
    ];
  }

  static Map<String, dynamic> getUserProfile() {
    return {
      'name': 'Alex Johnson',
      'email': 'alex.johnson@example.com',
      'level': 'Intermediate',
      'xp': 1250,
      'streak': 14,
    };
  }
}
