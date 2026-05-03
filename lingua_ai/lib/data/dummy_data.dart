import '../models/lesson.dart';

class DummyData {
  static List<Lesson> getLessons() {
    return [
      Lesson(
        id: '1',
        title: 'Greetings & Basics',
        description: 'Learn common greetings and how to introduce yourself.',
        level: 'Beginner',
        type: 'Vocabulary',
        xpReward: 50,
        durationMinutes: 5,
        progress: 0.0,
        questions: [
          Question(
            text: 'What does "Hello" mean in Turkish?',
            options: ['Hoşça kal', 'Merhaba', 'Teşekkürler', 'Lütfen'],
            correctAnswer: 'Merhaba',
          ),
          Question(
            text: 'Translate to English: "Nasılsın?"',
            options: ['How are you?', 'What is your name?', 'Where are you?', 'Good morning'],
            correctAnswer: 'How are you?',
          ),
          Question(
            text: 'Which of the following means "Goodbye"?',
            options: ['Günaydın', 'Selam', 'Hoşça kal', 'Pardon'],
            correctAnswer: 'Hoşça kal',
          ),
          Question(
            text: 'Complete the sentence: "My name ___ John."',
            options: ['am', 'is', 'are', 'be'],
            correctAnswer: 'is',
          ),
        ],
      ),
      Lesson(
        id: '2',
        title: 'The "To Be" Verb',
        description: 'Master the basics of Am, Is, and Are.',
        level: 'Beginner',
        type: 'Grammar',
        xpReward: 60,
        durationMinutes: 7,
        progress: 0.0,
        questions: [
          Question(
            text: 'Translate to English: "Ben bir öğrenciyim."',
            options: ['I is a student.', 'I am a student.', 'I are a student.', 'He is a student.'],
            correctAnswer: 'I am a student.',
          ),
          Question(
            text: 'Choose the correct sentence:',
            options: ['They is happy.', 'They am happy.', 'They are happy.', 'They be happy.'],
            correctAnswer: 'They are happy.',
          ),
          Question(
            text: 'Translate to Turkish: "She is a doctor."',
            options: ['O bir doktordur.', 'Sen bir doktorsun.', 'Biz doktoruz.', 'Onlar doktordur.'],
            correctAnswer: 'O bir doktordur.',
          ),
          Question(
            text: 'Complete the sentence: "You ___ my friend."',
            options: ['am', 'is', 'are', 'be'],
            correctAnswer: 'are',
          ),
        ],
      ),
      Lesson(
        id: '3',
        title: 'Numbers & Counting',
        description: 'Learn numbers from 1 to 20 and basic math terms.',
        level: 'Beginner',
        type: 'Vocabulary',
        xpReward: 40,
        durationMinutes: 4,
        progress: 0.0,
        questions: [
          Question(
            text: 'What is the number "Five" in Turkish?',
            options: ['Dört', 'Beş', 'Altı', 'Yedi'],
            correctAnswer: 'Beş',
          ),
          Question(
            text: 'Translate to English: "On iki"',
            options: ['Ten', 'Eleven', 'Twelve', 'Twenty'],
            correctAnswer: 'Twelve',
          ),
          Question(
            text: 'Which one is "Sekiz"?',
            options: ['Seven', 'Eight', 'Nine', 'Six'],
            correctAnswer: 'Eight',
          ),
          Question(
            text: 'How do you say "Zero" in Turkish?',
            options: ['Bir', 'Hiç', 'Sıfır', 'Yok'],
            correctAnswer: 'Sıfır',
          ),
        ],
      ),
      Lesson(
        id: '4',
        title: 'Daily Activities',
        description: 'Common verbs for things you do every day.',
        level: 'Beginner',
        type: 'Basic Sentences',
        xpReward: 70,
        durationMinutes: 8,
        progress: 0.0,
        questions: [
          Question(
            text: 'Translate to English: "Ben kahve içerim."',
            options: ['I drink coffee.', 'I eat coffee.', 'I like coffee.', 'I make coffee.'],
            correctAnswer: 'I drink coffee.',
          ),
          Question(
            text: 'What does "Sleep" mean in Turkish?',
            options: ['Uyanmak', 'Uyumak', 'Yürümek', 'Koşmak'],
            correctAnswer: 'Uyumak',
          ),
          Question(
            text: 'Choose the correct sentence:',
            options: ['I goes to school.', 'I go to school.', 'I going to school.', 'I gone to school.'],
            correctAnswer: 'I go to school.',
          ),
          Question(
            text: 'Translate to English: "Kitap okurum."',
            options: ['I write a book.', 'I read a book.', 'I buy a book.', 'I see a book.'],
            correctAnswer: 'I read a book.',
          ),
        ],
      ),
      Lesson(
        id: '5',
        title: 'Travel: At the Airport',
        description: 'Essential phrases for your next flight.',
        level: 'Beginner',
        type: 'Travel English',
        xpReward: 80,
        durationMinutes: 10,
        progress: 0.0,
        questions: [
          Question(
            text: 'What does "Passport" mean in Turkish?',
            options: ['Bilet', 'Pasaport', 'Vize', 'Kimlik'],
            correctAnswer: 'Pasaport',
          ),
          Question(
            text: 'Translate to English: "Uçuşum nerede?"',
            options: ['Where is my flight?', 'Where is my bag?', 'Where is the gate?', 'Where is the exit?'],
            correctAnswer: 'Where is my flight?',
          ),
          Question(
            text: 'Which one means "Bilet"?',
            options: ['Passport', 'Ticket', 'Luggage', 'Seat'],
            correctAnswer: 'Ticket',
          ),
          Question(
            text: 'How do you say "Gümrük" in English?',
            options: ['Security', 'Customs', 'Check-in', 'Boarding'],
            correctAnswer: 'Customs',
          ),
        ],
      ),
      Lesson(
        id: '6',
        title: 'In the Restaurant',
        description: 'How to order food and ask for the bill.',
        level: 'Beginner',
        type: 'Daily Conversation',
        xpReward: 75,
        durationMinutes: 9,
        progress: 0.0,
        questions: [
          Question(
            text: 'Translate to English: "Hesap, lütfen."',
            options: ['The menu, please.', 'The bill, please.', 'Water, please.', 'A table, please.'],
            correctAnswer: 'The bill, please.',
          ),
          Question(
            text: 'What does "Water" mean in Turkish?',
            options: ['Süt', 'Çay', 'Su', 'Meyve suyu'],
            correctAnswer: 'Su',
          ),
          Question(
            text: 'How do you say "I am hungry" in Turkish?',
            options: ['Susadım', 'Açım', 'Yorgunum', 'Mutluyum'],
            correctAnswer: 'Açım',
          ),
          Question(
            text: 'Complete the sentence: "I would like to ___ chicken."',
            options: ['drink', 'eat', 'see', 'go'],
            correctAnswer: 'eat',
          ),
        ],
      ),
      Lesson(
        id: '7',
        title: 'Family Members',
        description: 'Words for your relatives and family tree.',
        level: 'Beginner',
        type: 'Vocabulary',
        xpReward: 50,
        durationMinutes: 6,
        progress: 0.0,
        questions: [
          Question(
            text: 'What does "Mother" mean in Turkish?',
            options: ['Baba', 'Anne', 'Kız kardeş', 'Teyze'],
            correctAnswer: 'Anne',
          ),
          Question(
            text: 'Translate to English: "Benim babam"',
            options: ['My mother', 'My brother', 'My father', 'My sister'],
            correctAnswer: 'My father',
          ),
          Question(
            text: 'Which one is "Brother"?',
            options: ['Erkek kardeş', 'Kız kardeş', 'Amca', 'Dayı'],
            correctAnswer: 'Erkek kardeş',
          ),
          Question(
            text: 'How do you say "Family" in Turkish?',
            options: ['Arkadaş', 'Aile', 'Komşu', 'Akraba'],
            correctAnswer: 'Aile',
          ),
        ],
      ),
      Lesson(
        id: '8',
        title: 'Essential Questions',
        description: 'How to ask basic questions in daily life.',
        level: 'Beginner',
        type: 'Basic Sentences',
        xpReward: 90,
        durationMinutes: 12,
        progress: 0.0,
        questions: [
          Question(
            text: 'Translate to English: "Nerelisin?"',
            options: ['Where are you from?', 'How are you?', 'Who are you?', 'What are you doing?'],
            correctAnswer: 'Where are you from?',
          ),
          Question(
            text: 'How do you ask "Saat kaç?" in English?',
            options: ['What time is it?', 'How much is it?', 'Where is it?', 'Who is it?'],
            correctAnswer: 'What time is it?',
          ),
          Question(
            text: 'What does "Why" mean in Turkish?',
            options: ['Ne', 'Nerede', 'Neden', 'Nasıl'],
            correctAnswer: 'Neden',
          ),
          Question(
            text: 'Complete the sentence: "___ is the bathroom?"',
            options: ['Who', 'What', 'Where', 'When'],
            correctAnswer: 'Where',
          ),
        ],
      ),
    ];
  }

  static Map<String, dynamic> getUserProfile() {
    return {
      'name': 'Demo User',
      'email': 'demo@lingua.ai',
      'level': 'Beginner',
      'xp': 150,
      'streak': 3,
    };
  }
}

