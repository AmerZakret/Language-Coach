import '../models/lesson.dart';

class DummyData {
  static List<Lesson> getLessons(String targetLanguage) {
    switch (targetLanguage) {
      case 'es':
        return _getSpanishLessons();
      case 'de':
        return _getGermanLessons();
      case 'fr':
        return _getFrenchLessons();
      case 'ar':
        return _getArabicLessons();
      case 'en':
      default:
        return _getEnglishLessons();
    }
  }

  static List<Lesson> getAllLessons() {
    return [
      ..._getEnglishLessons(),
      ..._getSpanishLessons(),
      ..._getGermanLessons(),
      ..._getFrenchLessons(),
      ..._getArabicLessons(),
    ];
  }

  static Map<String, dynamic> getUserProfile() {
    return {
      'name': 'Amer Zakret',
      'email': 'amer@example.com',
      'xp': 150,
      'streak': 5,
      'level': 'Beginner',
      'avatar': 'https://ui-avatars.com/api/?name=Amer+Zakret&background=6366f1&color=fff',
    };
  }

  static List<Lesson> _getEnglishLessons() {
    return [
      Lesson(id: 'en_1', targetLanguage: 'en', title: 'Greetings & Introductions', description: 'Learn how to greet people and introduce yourself.', category: 'Vocabulary', difficulty: 'Beginner', duration: 5, xpReward: 20, questions: [
        Question(id: 'en1q1', question: 'Translate: "Merhaba, nasılsın?"', options: ['Hello, how are you?', 'Goodbye, see you!', 'Good night!', 'What is your name?'], correctAnswer: 'Hello, how are you?', type: 'multiple_choice'),
        Question(id: 'en1q2', question: 'What does "Nice to meet you" mean?', options: ['Hoşça kal', 'Tanıştığıma memnun oldum', 'Günaydın', 'Teşekkürler'], correctAnswer: 'Tanıştığıma memnun oldum', type: 'multiple_choice'),
        Question(id: 'en1q3', question: 'Complete: "My name ___ Ali."', options: ['am', 'is', 'are', 'be'], correctAnswer: 'is', type: 'fill_blank'),
        Question(id: 'en1q4', question: 'Which is a greeting?', options: ['Goodbye', 'Sorry', 'Good morning', 'Please'], correctAnswer: 'Good morning', type: 'multiple_choice'),
        Question(id: 'en1q5', question: 'Translate: "Ben Türkiye\'denim."', options: ['I am from Turkey.', 'I like Turkey.', 'Turkey is big.', 'I go to Turkey.'], correctAnswer: 'I am from Turkey.', type: 'multiple_choice'),
      ]),
      Lesson(id: 'en_2', targetLanguage: 'en', title: 'Classroom & School Words', description: 'Learn words you use every day at school.', category: 'Vocabulary', difficulty: 'Beginner', duration: 5, xpReward: 20, questions: [
        Question(id: 'en2q1', question: 'What is "kalem" in English?', options: ['Book', 'Pen', 'Desk', 'Bag'], correctAnswer: 'Pen', type: 'multiple_choice'),
        Question(id: 'en2q2', question: 'Translate: "öğretmen"', options: ['Student', 'Teacher', 'Doctor', 'Driver'], correctAnswer: 'Teacher', type: 'multiple_choice'),
        Question(id: 'en2q3', question: '"I read a ___" — choose the correct word.', options: ['chair', 'book', 'window', 'door'], correctAnswer: 'book', type: 'fill_blank'),
        Question(id: 'en2q4', question: 'What does "homework" mean?', options: ['Ev', 'Ödev', 'Okul', 'Sınıf'], correctAnswer: 'Ödev', type: 'multiple_choice'),
        Question(id: 'en2q5', question: 'Which word is a school item?', options: ['Eraser', 'Kitchen', 'Garden', 'Bedroom'], correctAnswer: 'Eraser', type: 'multiple_choice'),
      ]),
      Lesson(id: 'en_3', targetLanguage: 'en', title: 'Family Members', description: 'Learn how to talk about your family.', category: 'Vocabulary', difficulty: 'Beginner', duration: 6, xpReward: 25, questions: [
        Question(id: 'en3q1', question: 'What does "uncle" mean in Turkish?', options: ['Baba', 'Amca / Dayı', 'Kardeş', 'Kuzen'], correctAnswer: 'Amca / Dayı', type: 'multiple_choice'),
        Question(id: 'en3q2', question: 'Translate: "kız kardeş"', options: ['Brother', 'Sister', 'Mother', 'Daughter'], correctAnswer: 'Sister', type: 'multiple_choice'),
        Question(id: 'en3q3', question: 'Complete: "My ___ is a doctor." (anne)', options: ['father', 'mother', 'brother', 'uncle'], correctAnswer: 'mother', type: 'fill_blank'),
        Question(id: 'en3q4', question: '"Grandfather" means:', options: ['Büyükanne', 'Büyükbaba', 'Amca', 'Teyze'], correctAnswer: 'Büyükbaba', type: 'multiple_choice'),
        Question(id: 'en3q5', question: 'Which sentence is correct?', options: ['I have two brother.', 'I have two brothers.', 'I has two brothers.', 'I am two brothers.'], correctAnswer: 'I have two brothers.', type: 'multiple_choice'),
      ]),
      Lesson(id: 'en_4', targetLanguage: 'en', title: 'Daily Routine', description: 'Describe what you do every day.', category: 'Grammar', difficulty: 'Beginner', duration: 6, xpReward: 25, questions: [
        Question(id: 'en4q1', question: 'Complete: "I ___ breakfast at 8."', options: ['eat', 'eats', 'eating', 'am eat'], correctAnswer: 'eat', type: 'fill_blank'),
        Question(id: 'en4q2', question: 'Translate: "Okula giderim."', options: ['I go to school.', 'I like school.', 'School is good.', 'I am at school.'], correctAnswer: 'I go to school.', type: 'multiple_choice'),
        Question(id: 'en4q3', question: 'What does "I wake up early" mean?', options: ['Geç kalırım', 'Erken kalkarım', 'Erken yatarım', 'Geç yatarım'], correctAnswer: 'Erken kalkarım', type: 'multiple_choice'),
        Question(id: 'en4q4', question: 'Choose the correct sentence:', options: ['She go to work.', 'She goes to work.', 'She going to work.', 'She gone to work.'], correctAnswer: 'She goes to work.', type: 'multiple_choice'),
        Question(id: 'en4q5', question: 'Complete: "We ___ TV in the evening."', options: ['watches', 'watch', 'watching', 'watched'], correctAnswer: 'watch', type: 'fill_blank'),
      ]),
      Lesson(id: 'en_5', targetLanguage: 'en', title: 'Food & Drinks', description: 'Learn food vocabulary and ordering phrases.', category: 'Vocabulary', difficulty: 'Elementary', duration: 7, xpReward: 30, questions: [
        Question(id: 'en5q1', question: 'What is "ekmek" in English?', options: ['Butter', 'Cheese', 'Bread', 'Rice'], correctAnswer: 'Bread', type: 'multiple_choice'),
        Question(id: 'en5q2', question: 'Translate: "Bir çay, lütfen."', options: ['One coffee, please.', 'One tea, please.', 'One water, please.', 'One juice, please.'], correctAnswer: 'One tea, please.', type: 'multiple_choice'),
        Question(id: 'en5q3', question: '"I am hungry" means:', options: ['Susadım', 'Açım', 'Yorgunum', 'Mutluyum'], correctAnswer: 'Açım', type: 'multiple_choice'),
        Question(id: 'en5q4', question: 'Which is a drink?', options: ['Chicken', 'Orange juice', 'Pasta', 'Salad'], correctAnswer: 'Orange juice', type: 'multiple_choice'),
        Question(id: 'en5q5', question: 'Complete: "Can I have the ___, please?"', options: ['menu', 'table', 'chair', 'kitchen'], correctAnswer: 'menu', type: 'fill_blank'),
      ]),
      Lesson(id: 'en_6', targetLanguage: 'en', title: 'Asking Questions', description: 'Learn how to ask basic questions in English.', category: 'Grammar', difficulty: 'Elementary', duration: 7, xpReward: 30, questions: [
        Question(id: 'en6q1', question: "How do you ask someone's name?", options: ['Where are you?', 'What is your name?', 'How old are you?', 'Who is he?'], correctAnswer: 'What is your name?', type: 'multiple_choice'),
        Question(id: 'en6q2', question: 'Translate: "Nerelisin?"', options: ['How are you?', 'Where are you from?', 'What do you do?', 'How old are you?'], correctAnswer: 'Where are you from?', type: 'multiple_choice'),
        Question(id: 'en6q3', question: 'Complete: "___ you like coffee?"', options: ['Are', 'Do', 'Is', 'Does'], correctAnswer: 'Do', type: 'fill_blank'),
        Question(id: 'en6q4', question: 'Which is a correct question?', options: ['You are student?', 'Are you a student?', 'Student you are?', 'A student are you?'], correctAnswer: 'Are you a student?', type: 'multiple_choice'),
        Question(id: 'en6q5', question: '"How much is this?" means:', options: ['Bu nedir?', 'Bu ne kadar?', 'Bu nerede?', 'Bu kimin?'], correctAnswer: 'Bu ne kadar?', type: 'multiple_choice'),
      ]),
    ];
  }

  static List<Lesson> _getSpanishLessons() {
    return [
      Lesson(id: 'es_1', targetLanguage: 'es', title: 'Saludos Básicos', description: 'Learn basic Spanish greetings.', category: 'Vocabulary', difficulty: 'Beginner', duration: 5, xpReward: 20, questions: [
        Question(id: 'es1q1', question: 'Translate: "Merhaba"', options: ['Adiós', 'Hola', 'Gracias', 'Por favor'], correctAnswer: 'Hola', type: 'multiple_choice'),
        Question(id: 'es1q2', question: '"Buenos días" means:', options: ['Good night', 'Good afternoon', 'Good morning', 'Goodbye'], correctAnswer: 'Good morning', type: 'multiple_choice'),
        Question(id: 'es1q3', question: '"Teşekkürler" in Spanish:', options: ['De nada', 'Gracias', 'Perdón', 'Hola'], correctAnswer: 'Gracias', type: 'multiple_choice'),
        Question(id: 'es1q4', question: 'How do you say "Goodbye"?', options: ['Hola', 'Adiós', 'Sí', 'No'], correctAnswer: 'Adiós', type: 'multiple_choice'),
        Question(id: 'es1q5', question: '"¿Cómo estás?" means:', options: ['What is your name?', 'How are you?', 'Where are you?', 'How old are you?'], correctAnswer: 'How are you?', type: 'multiple_choice'),
      ]),
      Lesson(id: 'es_2', targetLanguage: 'es', title: 'Presentaciones', description: 'Introduce yourself in Spanish.', category: 'Vocabulary', difficulty: 'Beginner', duration: 5, xpReward: 20, questions: [
        Question(id: 'es2q1', question: 'Complete: "Me ___ María."', options: ['soy', 'llamo', 'tengo', 'estoy'], correctAnswer: 'llamo', type: 'fill_blank'),
        Question(id: 'es2q2', question: '"I am a student" in Spanish:', options: ['Soy profesor', 'Soy estudiante', 'Tengo clase', 'Estoy bien'], correctAnswer: 'Soy estudiante', type: 'multiple_choice'),
        Question(id: 'es2q3', question: 'Translate: "Benim adım Ali"', options: ['Soy Ali', 'Me llamo Ali', 'Tengo Ali', 'Estoy Ali'], correctAnswer: 'Me llamo Ali', type: 'multiple_choice'),
        Question(id: 'es2q4', question: '"¿De dónde eres?" means:', options: ['How are you?', 'Where are you from?', 'What do you do?', 'How old are you?'], correctAnswer: 'Where are you from?', type: 'multiple_choice'),
        Question(id: 'es2q5', question: 'Complete: "Yo ___ de Turquía."', options: ['soy', 'estoy', 'tengo', 'hago'], correctAnswer: 'soy', type: 'fill_blank'),
      ]),
      Lesson(id: 'es_3', targetLanguage: 'es', title: 'Números y Colores', description: 'Numbers and colors.', category: 'Vocabulary', difficulty: 'Beginner', duration: 6, xpReward: 25, questions: [
        Question(id: 'es3q1', question: '"Cinco" is:', options: ['Three', 'Four', 'Five', 'Six'], correctAnswer: 'Five', type: 'multiple_choice'),
        Question(id: 'es3q2', question: '"Rojo" means:', options: ['Blue', 'Green', 'Red', 'Yellow'], correctAnswer: 'Red', type: 'multiple_choice'),
        Question(id: 'es3q3', question: '"10" in Spanish:', options: ['Ocho', 'Nueve', 'Diez', 'Once'], correctAnswer: 'Diez', type: 'multiple_choice'),
        Question(id: 'es3q4', question: '"Blanco" is:', options: ['Black', 'White', 'Gray', 'Brown'], correctAnswer: 'White', type: 'multiple_choice'),
        Question(id: 'es3q5', question: '"Veinte" is:', options: ['12', '15', '18', '20'], correctAnswer: '20', type: 'multiple_choice'),
      ]),
      Lesson(id: 'es_4', targetLanguage: 'es', title: 'La Familia', description: 'Family vocabulary.', category: 'Vocabulary', difficulty: 'Beginner', duration: 6, xpReward: 25, questions: [
        Question(id: 'es4q1', question: '"Madre" means:', options: ['Father', 'Mother', 'Sister', 'Aunt'], correctAnswer: 'Mother', type: 'multiple_choice'),
        Question(id: 'es4q2', question: '"kardeş" in Spanish:', options: ['Hermano/a', 'Padre', 'Hijo', 'Primo'], correctAnswer: 'Hermano/a', type: 'multiple_choice'),
        Question(id: 'es4q3', question: '"Abuelo" is:', options: ['Uncle', 'Grandfather', 'Cousin', 'Brother'], correctAnswer: 'Grandfather', type: 'multiple_choice'),
        Question(id: 'es4q4', question: 'Complete: "Mi ___ se llama Ayşe." (anne)', options: ['padre', 'madre', 'hermano', 'tío'], correctAnswer: 'madre', type: 'fill_blank'),
        Question(id: 'es4q5', question: '"Hija" means:', options: ['Son', 'Daughter', 'Niece', 'Sister'], correctAnswer: 'Daughter', type: 'multiple_choice'),
      ]),
      Lesson(id: 'es_5', targetLanguage: 'es', title: 'Comida y Bebida', description: 'Food and drink words.', category: 'Vocabulary', difficulty: 'Elementary', duration: 7, xpReward: 30, questions: [
        Question(id: 'es5q1', question: '"Agua" means:', options: ['Milk', 'Juice', 'Water', 'Tea'], correctAnswer: 'Water', type: 'multiple_choice'),
        Question(id: 'es5q2', question: '"ekmek" in Spanish:', options: ['Arroz', 'Pan', 'Queso', 'Carne'], correctAnswer: 'Pan', type: 'multiple_choice'),
        Question(id: 'es5q3', question: '"Manzana" is:', options: ['Orange', 'Banana', 'Apple', 'Grape'], correctAnswer: 'Apple', type: 'multiple_choice'),
        Question(id: 'es5q4', question: 'Complete: "Quiero un ___, por favor." (çay)', options: ['café', 'té', 'agua', 'jugo'], correctAnswer: 'té', type: 'fill_blank'),
        Question(id: 'es5q5', question: '"Tengo hambre" means:', options: ['I am thirsty', 'I am hungry', 'I am tired', 'I am happy'], correctAnswer: 'I am hungry', type: 'multiple_choice'),
      ]),
      Lesson(id: 'es_6', targetLanguage: 'es', title: 'Verbos Básicos', description: 'Common Spanish verbs.', category: 'Grammar', difficulty: 'Elementary', duration: 7, xpReward: 30, questions: [
        Question(id: 'es6q1', question: 'Complete: "Yo ___ español."', options: ['hablas', 'hablo', 'habla', 'hablamos'], correctAnswer: 'hablo', type: 'fill_blank'),
        Question(id: 'es6q2', question: '"Comer" means:', options: ['To drink', 'To eat', 'To run', 'To sleep'], correctAnswer: 'To eat', type: 'multiple_choice'),
        Question(id: 'es6q3', question: '"Okula gidiyorum":', options: ['Voy a casa', 'Voy a la escuela', 'Como en casa', 'Estudio mucho'], correctAnswer: 'Voy a la escuela', type: 'multiple_choice'),
        Question(id: 'es6q4', question: 'Complete: "Ella ___ en Madrid."', options: ['vivo', 'vives', 'vive', 'vivimos'], correctAnswer: 'vive', type: 'fill_blank'),
        Question(id: 'es6q5', question: '"Escribir" is:', options: ['To read', 'To write', 'To speak', 'To listen'], correctAnswer: 'To write', type: 'multiple_choice'),
      ]),
    ];
  }

  static List<Lesson> _getGermanLessons() {
    return [
      Lesson(id: 'de_1', targetLanguage: 'de', title: 'Begrüßungen', description: 'Basic German greetings.', category: 'Vocabulary', difficulty: 'Beginner', duration: 5, xpReward: 20, questions: [
        Question(id: 'de1q1', question: 'Translate: "Merhaba"', options: ['Tschüss', 'Hallo', 'Danke', 'Bitte'], correctAnswer: 'Hallo', type: 'multiple_choice'),
        Question(id: 'de1q2', question: '"Guten Morgen" means:', options: ['Good night', 'Good evening', 'Good morning', 'Goodbye'], correctAnswer: 'Good morning', type: 'multiple_choice'),
        Question(id: 'de1q3', question: '"Teşekkürler" in German:', options: ['Bitte', 'Danke', 'Ja', 'Nein'], correctAnswer: 'Danke', type: 'multiple_choice'),
        Question(id: 'de1q4', question: 'How do you say "Goodbye"?', options: ['Hallo', 'Tschüss', 'Gut', 'Ja'], correctAnswer: 'Tschüss', type: 'multiple_choice'),
        Question(id: 'de1q5', question: '"Wie geht es dir?" means:', options: ['What is your name?', 'How are you?', 'Where do you live?', 'How old are you?'], correctAnswer: 'How are you?', type: 'multiple_choice'),
      ]),
      Lesson(id: 'de_2', targetLanguage: 'de', title: 'Sich Vorstellen', description: 'Introduce yourself in German.', category: 'Vocabulary', difficulty: 'Beginner', duration: 5, xpReward: 20, questions: [
        Question(id: 'de2q1', question: 'Complete: "Ich ___ Ali."', options: ['bin', 'heiße', 'habe', 'ist'], correctAnswer: 'heiße', type: 'fill_blank'),
        Question(id: 'de2q2', question: '"I am a student" in German:', options: ['Ich bin Lehrer', 'Ich bin Student', 'Ich habe Klasse', 'Ich bin gut'], correctAnswer: 'Ich bin Student', type: 'multiple_choice'),
        Question(id: 'de2q3', question: '"Benim adım Ayşe":', options: ['Ich bin Ayşe', 'Ich heiße Ayşe', 'Ich habe Ayşe', 'Ich komme Ayşe'], correctAnswer: 'Ich heiße Ayşe', type: 'multiple_choice'),
        Question(id: 'de2q4', question: '"Woher kommst du?" means:', options: ['How are you?', 'Where are you from?', 'What do you do?', 'How old are you?'], correctAnswer: 'Where are you from?', type: 'multiple_choice'),
        Question(id: 'de2q5', question: 'Complete: "Ich komme ___ der Türkei."', options: ['von', 'aus', 'in', 'nach'], correctAnswer: 'aus', type: 'fill_blank'),
      ]),
      Lesson(id: 'de_3', targetLanguage: 'de', title: 'Zahlen und Farben', description: 'Numbers and colors.', category: 'Vocabulary', difficulty: 'Beginner', duration: 6, xpReward: 25, questions: [
        Question(id: 'de3q1', question: '"Fünf" is:', options: ['Three', 'Four', 'Five', 'Six'], correctAnswer: 'Five', type: 'multiple_choice'),
        Question(id: 'de3q2', question: '"Rot" means:', options: ['Blue', 'Green', 'Red', 'Yellow'], correctAnswer: 'Red', type: 'multiple_choice'),
        Question(id: 'de3q3', question: '"10" in German:', options: ['Acht', 'Neun', 'Zehn', 'Elf'], correctAnswer: 'Zehn', type: 'multiple_choice'),
        Question(id: 'de3q4', question: '"Schwarz" is:', options: ['White', 'Black', 'Gray', 'Brown'], correctAnswer: 'Black', type: 'multiple_choice'),
        Question(id: 'de3q5', question: '"Zwanzig" is:', options: ['12', '15', '18', '20'], correctAnswer: '20', type: 'multiple_choice'),
      ]),
      Lesson(id: 'de_4', targetLanguage: 'de', title: 'Die Familie', description: 'Family vocabulary.', category: 'Vocabulary', difficulty: 'Beginner', duration: 6, xpReward: 25, questions: [
        Question(id: 'de4q1', question: '"Mutter" means:', options: ['Father', 'Mother', 'Sister', 'Aunt'], correctAnswer: 'Mother', type: 'multiple_choice'),
        Question(id: 'de4q2', question: '"kardeş" in German:', options: ['Geschwister', 'Vater', 'Sohn', 'Cousin'], correctAnswer: 'Geschwister', type: 'multiple_choice'),
        Question(id: 'de4q3', question: '"Großvater" is:', options: ['Uncle', 'Grandfather', 'Cousin', 'Brother'], correctAnswer: 'Grandfather', type: 'multiple_choice'),
        Question(id: 'de4q4', question: 'Complete: "Meine ___ heißt Ayşe." (anne)', options: ['Vater', 'Mutter', 'Bruder', 'Onkel'], correctAnswer: 'Mutter', type: 'fill_blank'),
        Question(id: 'de4q5', question: '"Tochter" means:', options: ['Son', 'Daughter', 'Niece', 'Sister'], correctAnswer: 'Daughter', type: 'multiple_choice'),
      ]),
      Lesson(id: 'de_5', targetLanguage: 'de', title: 'Essen und Trinken', description: 'Food and drink words.', category: 'Vocabulary', difficulty: 'Elementary', duration: 7, xpReward: 30, questions: [
        Question(id: 'de5q1', question: '"Wasser" means:', options: ['Milk', 'Juice', 'Water', 'Tea'], correctAnswer: 'Water', type: 'multiple_choice'),
        Question(id: 'de5q2', question: '"ekmek" in German:', options: ['Reis', 'Brot', 'Käse', 'Fleisch'], correctAnswer: 'Brot', type: 'multiple_choice'),
        Question(id: 'de5q3', question: '"Apfel" is:', options: ['Orange', 'Banana', 'Apple', 'Grape'], correctAnswer: 'Apple', type: 'multiple_choice'),
        Question(id: 'de5q4', question: 'Complete: "Ich möchte einen ___, bitte." (çay)', options: ['Kaffee', 'Tee', 'Wasser', 'Saft'], correctAnswer: 'Tee', type: 'fill_blank'),
        Question(id: 'de5q5', question: '"Ich habe Hunger" means:', options: ['I am thirsty', 'I am hungry', 'I am tired', 'I am happy'], correctAnswer: 'I am hungry', type: 'multiple_choice'),
      ]),
      Lesson(id: 'de_6', targetLanguage: 'de', title: 'Grundverben', description: 'Basic German verbs.', category: 'Grammar', difficulty: 'Elementary', duration: 7, xpReward: 30, questions: [
        Question(id: 'de6q1', question: 'Complete: "Ich ___ Deutsch."', options: ['sprichst', 'spreche', 'spricht', 'sprechen'], correctAnswer: 'spreche', type: 'fill_blank'),
        Question(id: 'de6q2', question: '"Essen" means:', options: ['To drink', 'To eat', 'To run', 'To sleep'], correctAnswer: 'To eat', type: 'multiple_choice'),
        Question(id: 'de6q3', question: '"Okula gidiyorum":', options: ['Ich gehe nach Hause', 'Ich gehe zur Schule', 'Ich esse zu Hause', 'Ich lerne viel'], correctAnswer: 'Ich gehe zur Schule', type: 'multiple_choice'),
        Question(id: 'de6q4', question: 'Complete: "Sie ___ in Berlin."', options: ['wohne', 'wohnst', 'wohnt', 'wohnen'], correctAnswer: 'wohnt', type: 'fill_blank'),
        Question(id: 'de6q5', question: '"Schreiben" is:', options: ['To read', 'To write', 'To speak', 'To listen'], correctAnswer: 'To write', type: 'multiple_choice'),
      ]),
    ];
  }

  static List<Lesson> _getFrenchLessons() {
    return [
      Lesson(id: 'fr_1', targetLanguage: 'fr', title: 'Salutations', description: 'Basic French greetings.', category: 'Vocabulary', difficulty: 'Beginner', duration: 5, xpReward: 20, questions: [
        Question(id: 'fr1q1', question: 'Translate: "Merhaba"', options: ['Au revoir', 'Bonjour', 'Merci', 'Oui'], correctAnswer: 'Bonjour', type: 'multiple_choice'),
        Question(id: 'fr1q2', question: '"Bonsoir" means:', options: ['Good morning', 'Good night', 'Good evening', 'Goodbye'], correctAnswer: 'Good evening', type: 'multiple_choice'),
        Question(id: 'fr1q3', question: '"Teşekkürler" in French:', options: ["S'il vous plaît", 'Merci', 'De rien', 'Pardon'], correctAnswer: 'Merci', type: 'multiple_choice'),
        Question(id: 'fr1q4', question: 'How do you say "Goodbye"?', options: ['Bonjour', 'Au revoir', 'Oui', 'Non'], correctAnswer: 'Au revoir', type: 'multiple_choice'),
        Question(id: 'fr1q5', question: '"Comment ça va?" means:', options: ['What is your name?', 'How are you?', 'Where are you?', 'How old are you?'], correctAnswer: 'How are you?', type: 'multiple_choice'),
      ]),
      Lesson(id: 'fr_2', targetLanguage: 'fr', title: 'Se Présenter', description: 'Introduce yourself in French.', category: 'Vocabulary', difficulty: 'Beginner', duration: 5, xpReward: 20, questions: [
        Question(id: 'fr2q1', question: "Complete: \"Je m'___ Ali.\"", options: ['suis', 'appelle', 'ai', 'fais'], correctAnswer: 'appelle', type: 'fill_blank'),
        Question(id: 'fr2q2', question: '"I am a student" in French:', options: ['Je suis professeur', 'Je suis étudiant', "J'ai cours", 'Je suis bien'], correctAnswer: 'Je suis étudiant', type: 'multiple_choice'),
        Question(id: 'fr2q3', question: '"Benim adım Ayşe":', options: ['Je suis Ayşe', "Je m'appelle Ayşe", "J'ai Ayşe", 'Je viens Ayşe'], correctAnswer: "Je m'appelle Ayşe", type: 'multiple_choice'),
        Question(id: 'fr2q4', question: '"D\'où viens-tu?" means:', options: ['How are you?', 'Where are you from?', 'What do you do?', 'How old are you?'], correctAnswer: 'Where are you from?', type: 'multiple_choice'),
        Question(id: 'fr2q5', question: 'Complete: "Je viens ___ Turquie."', options: ['du', 'de', 'à', 'en'], correctAnswer: 'de', type: 'fill_blank'),
      ]),
      Lesson(id: 'fr_3', targetLanguage: 'fr', title: 'Nombres et Couleurs', description: 'Numbers and colors.', category: 'Vocabulary', difficulty: 'Beginner', duration: 6, xpReward: 25, questions: [
        Question(id: 'fr3q1', question: '"Cinq" is:', options: ['Three', 'Four', 'Five', 'Six'], correctAnswer: 'Five', type: 'multiple_choice'),
        Question(id: 'fr3q2', question: '"Rouge" means:', options: ['Blue', 'Green', 'Red', 'Yellow'], correctAnswer: 'Red', type: 'multiple_choice'),
        Question(id: 'fr3q3', question: '"10" in French:', options: ['Huit', 'Neuf', 'Dix', 'Onze'], correctAnswer: 'Dix', type: 'multiple_choice'),
        Question(id: 'fr3q4', question: '"Noir" is:', options: ['White', 'Black', 'Gray', 'Brown'], correctAnswer: 'Black', type: 'multiple_choice'),
        Question(id: 'fr3q5', question: '"Vingt" is:', options: ['12', '15', '18', '20'], correctAnswer: '20', type: 'multiple_choice'),
      ]),
      Lesson(id: 'fr_4', targetLanguage: 'fr', title: 'La Famille', description: 'Family vocabulary.', category: 'Vocabulary', difficulty: 'Beginner', duration: 6, xpReward: 25, questions: [
        Question(id: 'fr4q1', question: '"Mère" means:', options: ['Father', 'Mother', 'Sister', 'Aunt'], correctAnswer: 'Mother', type: 'multiple_choice'),
        Question(id: 'fr4q2', question: '"kardeş" in French:', options: ['Frère/Sœur', 'Père', 'Fils', 'Cousin'], correctAnswer: 'Frère/Sœur', type: 'multiple_choice'),
        Question(id: 'fr4q3', question: '"Grand-père" is:', options: ['Uncle', 'Grandfather', 'Cousin', 'Brother'], correctAnswer: 'Grandfather', type: 'multiple_choice'),
        Question(id: 'fr4q4', question: "Complete: \"Ma ___ s'appelle Ayşe.\" (anne)", options: ['père', 'mère', 'frère', 'oncle'], correctAnswer: 'mère', type: 'fill_blank'),
        Question(id: 'fr4q5', question: '"Fille" means:', options: ['Son', 'Daughter', 'Niece', 'Sister'], correctAnswer: 'Daughter', type: 'multiple_choice'),
      ]),
      Lesson(id: 'fr_5', targetLanguage: 'fr', title: 'Nourriture et Boissons', description: 'Food and drink words.', category: 'Vocabulary', difficulty: 'Elementary', duration: 7, xpReward: 30, questions: [
        Question(id: 'fr5q1', question: '"Eau" means:', options: ['Milk', 'Juice', 'Water', 'Tea'], correctAnswer: 'Water', type: 'multiple_choice'),
        Question(id: 'fr5q2', question: '"ekmek" in French:', options: ['Riz', 'Pain', 'Fromage', 'Viande'], correctAnswer: 'Pain', type: 'multiple_choice'),
        Question(id: 'fr5q3', question: '"Pomme" is:', options: ['Orange', 'Banana', 'Apple', 'Grape'], correctAnswer: 'Apple', type: 'multiple_choice'),
        Question(id: 'fr5q4', question: "Complete: \"Je voudrais un ___, s'il vous plaît.\" (çay)", options: ['café', 'thé', 'eau', 'jus'], correctAnswer: 'thé', type: 'fill_blank'),
        Question(id: 'fr5q5', question: '"J\'ai faim" means:', options: ['I am thirsty', 'I am hungry', 'I am tired', 'I am happy'], correctAnswer: 'I am hungry', type: 'multiple_choice'),
      ]),
      Lesson(id: 'fr_6', targetLanguage: 'fr', title: 'Verbes de Base', description: 'Basic French verbs.', category: 'Grammar', difficulty: 'Elementary', duration: 7, xpReward: 30, questions: [
        Question(id: 'fr6q1', question: 'Complete: "Je ___ français."', options: ['parles', 'parle', 'parlons', 'parlent'], correctAnswer: 'parle', type: 'fill_blank'),
        Question(id: 'fr6q2', question: '"Manger" means:', options: ['To drink', 'To eat', 'To run', 'To sleep'], correctAnswer: 'To eat', type: 'multiple_choice'),
        Question(id: 'fr6q3', question: '"Okula gidiyorum":', options: ['Je vais à la maison', "Je vais à l'école", 'Je mange à la maison', "J'étudie beaucoup"], correctAnswer: "Je vais à l'école", type: 'multiple_choice'),
        Question(id: 'fr6q4', question: 'Complete: "Elle ___ à Paris."', options: ['habite', 'habites', 'habitons', 'habitent'], correctAnswer: 'habite', type: 'fill_blank'),
        Question(id: 'fr6q5', question: '"Écrire" is:', options: ['To read', 'To write', 'To speak', 'To listen'], correctAnswer: 'To write', type: 'multiple_choice'),
      ]),
    ];
  }

  static List<Lesson> _getArabicLessons() {
    return [
      Lesson(id: 'ar_1', targetLanguage: 'ar', title: 'التحيات', description: 'Basic Arabic greetings.', category: 'Vocabulary', difficulty: 'Beginner', duration: 5, xpReward: 20, questions: [
        Question(id: 'ar1q1', question: 'Translate: "Merhaba"', options: ["Ma'a as-salamah", 'Marhaba', 'Shukran', 'Min fadlak'], correctAnswer: 'Marhaba', type: 'multiple_choice'),
        Question(id: 'ar1q2', question: '"Sabah al-khayr" means:', options: ['Good night', 'Good evening', 'Good morning', 'Goodbye'], correctAnswer: 'Good morning', type: 'multiple_choice'),
        Question(id: 'ar1q3', question: '"Teşekkürler" in Arabic:', options: ['Afwan', 'Shukran', 'La', "Na'am"], correctAnswer: 'Shukran', type: 'multiple_choice'),
        Question(id: 'ar1q4', question: 'How do you say "Goodbye"?', options: ['Marhaba', "Ma'a as-salamah", 'Shukran', "Na'am"], correctAnswer: "Ma'a as-salamah", type: 'multiple_choice'),
        Question(id: 'ar1q5', question: '"Kayfa haluk?" means:', options: ['What is your name?', 'How are you?', 'Where are you?', 'How old are you?'], correctAnswer: 'How are you?', type: 'multiple_choice'),
      ]),
      Lesson(id: 'ar_2', targetLanguage: 'ar', title: 'التعريف بالنفس', description: 'Introduce yourself in Arabic.', category: 'Vocabulary', difficulty: 'Beginner', duration: 5, xpReward: 20, questions: [
        Question(id: 'ar2q1', question: '"My name is Ali" in Arabic:', options: ['Ana Ali', 'Ismi Ali', 'Indi Ali', 'Huwa Ali'], correctAnswer: 'Ismi Ali', type: 'fill_blank'),
        Question(id: 'ar2q2', question: '"Ana talib" means:', options: ['I am a teacher', 'I am a student', 'I am happy', 'I am fine'], correctAnswer: 'I am a student', type: 'multiple_choice'),
        Question(id: 'ar2q3', question: '"Benim adım Ayşe":', options: ['Ana Ayşe', 'Ismi Ayşe', 'Indi Ayşe', 'Anti Ayşe'], correctAnswer: 'Ismi Ayşe', type: 'multiple_choice'),
        Question(id: 'ar2q4', question: '"Min ayna anta?" means:', options: ['How are you?', 'Where are you from?', 'What do you do?', 'How old are you?'], correctAnswer: 'Where are you from?', type: 'multiple_choice'),
        Question(id: 'ar2q5', question: '"Ana min Turkiya" means:', options: ['I like Turkey', 'I am from Turkey', 'Turkey is good', 'I go to Turkey'], correctAnswer: 'I am from Turkey', type: 'multiple_choice'),
      ]),
      Lesson(id: 'ar_3', targetLanguage: 'ar', title: 'الأرقام والألوان', description: 'Numbers and colors.', category: 'Vocabulary', difficulty: 'Beginner', duration: 6, xpReward: 25, questions: [
        Question(id: 'ar3q1', question: '"Khamsa" is:', options: ['Three', 'Four', 'Five', 'Six'], correctAnswer: 'Five', type: 'multiple_choice'),
        Question(id: 'ar3q2', question: '"Ahmar" means:', options: ['Blue', 'Green', 'Red', 'Yellow'], correctAnswer: 'Red', type: 'multiple_choice'),
        Question(id: 'ar3q3', question: '"10" in Arabic:', options: ['Thamaniya', "Tis'a", 'Ashara', 'Ihda Ashar'], correctAnswer: 'Ashara', type: 'multiple_choice'),
        Question(id: 'ar3q4', question: '"Aswad" is:', options: ['White', 'Black', 'Gray', 'Brown'], correctAnswer: 'Black', type: 'multiple_choice'),
        Question(id: 'ar3q5', question: '"Ishrun" is:', options: ['12', '15', '18', '20'], correctAnswer: '20', type: 'multiple_choice'),
      ]),
      Lesson(id: 'ar_4', targetLanguage: 'ar', title: 'العائلة', description: 'Family vocabulary.', category: 'Vocabulary', difficulty: 'Beginner', duration: 6, xpReward: 25, questions: [
        Question(id: 'ar4q1', question: '"Umm" means:', options: ['Father', 'Mother', 'Sister', 'Aunt'], correctAnswer: 'Mother', type: 'multiple_choice'),
        Question(id: 'ar4q2', question: '"kardeş" in Arabic:', options: ['Akh/Ukht', 'Ab', 'Ibn', 'Amm'], correctAnswer: 'Akh/Ukht', type: 'multiple_choice'),
        Question(id: 'ar4q3', question: '"Jadd" is:', options: ['Uncle', 'Grandfather', 'Cousin', 'Brother'], correctAnswer: 'Grandfather', type: 'multiple_choice'),
        Question(id: 'ar4q4', question: '"Bint" means:', options: ['Son', 'Daughter', 'Niece', 'Sister'], correctAnswer: 'Daughter', type: 'multiple_choice'),
        Question(id: 'ar4q5', question: '"Ab" means:', options: ['Mother', 'Father', 'Brother', 'Uncle'], correctAnswer: 'Father', type: 'multiple_choice'),
      ]),
      Lesson(id: 'ar_5', targetLanguage: 'ar', title: 'الطعام والشراب', description: 'Food and drink words.', category: 'Vocabulary', difficulty: 'Elementary', duration: 7, xpReward: 30, questions: [
        Question(id: 'ar5q1', question: '"Maa\'" means:', options: ['Milk', 'Juice', 'Water', 'Tea'], correctAnswer: 'Water', type: 'multiple_choice'),
        Question(id: 'ar5q2', question: '"ekmek" in Arabic:', options: ['Aruzz', 'Khubz', 'Jubn', 'Lahm'], correctAnswer: 'Khubz', type: 'multiple_choice'),
        Question(id: 'ar5q3', question: '"Tuffaha" is:', options: ['Orange', 'Banana', 'Apple', 'Grape'], correctAnswer: 'Apple', type: 'multiple_choice'),
        Question(id: 'ar5q4', question: '"Shay" means:', options: ['Coffee', 'Tea', 'Water', 'Juice'], correctAnswer: 'Tea', type: 'multiple_choice'),
        Question(id: 'ar5q5', question: '"Ana ja\'i" means:', options: ['I am thirsty', 'I am hungry', 'I am tired', 'I am happy'], correctAnswer: 'I am hungry', type: 'multiple_choice'),
      ]),
      Lesson(id: 'ar_6', targetLanguage: 'ar', title: 'جمل بسيطة', description: 'Basic Arabic sentences.', category: 'Grammar', difficulty: 'Elementary', duration: 7, xpReward: 30, questions: [
        Question(id: 'ar6q1', question: '"Ana atakallam al-arabiyyah" means:', options: ['I learn Arabic', 'I speak Arabic', 'I read Arabic', 'I write Arabic'], correctAnswer: 'I speak Arabic', type: 'multiple_choice'),
        Question(id: 'ar6q2', question: '"Akul" means:', options: ['To drink', 'To eat', 'To run', 'To sleep'], correctAnswer: 'To eat', type: 'multiple_choice'),
        Question(id: 'ar6q3', question: '"Okula gidiyorum":', options: ['Adhhab ila al-bayt', 'Adhhab ila al-madrasa', 'Akul fi al-bayt', 'Adrus kathiran'], correctAnswer: 'Adhhab ila al-madrasa', type: 'multiple_choice'),
        Question(id: 'ar6q4', question: '"Hiya taskun fi Istanbul" means:', options: ['She lives in Istanbul', 'She likes Istanbul', 'She visits Istanbul', 'She goes to Istanbul'], correctAnswer: 'She lives in Istanbul', type: 'multiple_choice'),
        Question(id: 'ar6q5', question: '"Aktub" is:', options: ['To read', 'To write', 'To speak', 'To listen'], correctAnswer: 'To write', type: 'multiple_choice'),
      ]),
    ];
  }
}
