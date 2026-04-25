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
            text: 'How do you say "Hello" in Spanish?',
            options: ['Adiós', 'Hola', 'Gracias', 'Por favor'],
            correctAnswer: 'Hola',
          ),
          Question(
            text: 'Translate: "¿Cómo estás?"',
            options: ['How are you?', 'What is your name?', 'Where are you?', 'Good morning'],
            correctAnswer: 'How are you?',
          ),
          Question(
            text: 'Which of the following means "Goodbye"?',
            options: ['Buenos días', 'Hola', 'Adiós', 'Perdón'],
            correctAnswer: 'Adiós',
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
            text: 'Translate: "I would like a coffee, please."',
            options: [
              'Me gustaría un café, por favor.',
              'Quiero agua, gracias.',
              '¿Dónde está el menú?',
              'La cuenta, por favor.'
            ],
            correctAnswer: 'Me gustaría un café, por favor.',
          ),
          Question(
            text: 'How do you ask for "the bill"?',
            options: ['El baño', 'El menú', 'La mesa', 'La cuenta'],
            correctAnswer: 'La cuenta',
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
            text: 'Translate: "Where is the train station?"',
            options: [
              '¿Dónde está el aeropuerto?',
              '¿Dónde está la estación de tren?',
              '¿A qué hora sale el tren?',
              '¿Cuánto cuesta un boleto?'
            ],
            correctAnswer: '¿Dónde está la estación de tren?',
          ),
          Question(
            text: 'What does "Gire a la izquierda" mean?',
            options: ['Turn right', 'Go straight', 'Turn left', 'Stop'],
            correctAnswer: 'Turn left',
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
            text: 'Translate: "It is a pleasure to meet you."',
            options: [
              'Encantado de conocerle.',
              'Mucho gusto.',
              'Es un placer conocerle.',
              'Todos los anteriores.'
            ],
            correctAnswer: 'Todos los anteriores.',
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
