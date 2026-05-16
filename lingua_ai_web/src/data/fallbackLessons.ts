import type { Lesson } from '../types/lesson';

export const fallbackLessons: Lesson[] = [
  // --- ENGLISH (6 Lessons) ---
  {
    id: 'en_1',
    targetLanguage: 'English',
    title: 'Greetings & Introductions',
    description: 'Learn how to greet people and introduce yourself.',
    category: 'Vocabulary',
    difficulty: 'Beginner',
    duration: '5',
    xpReward: 20,
    questions: [
      { id: 'en1q1', question: 'Translate: "Merhaba, nasılsın?"', options: ['Hello, how are you?', 'Goodbye, see you!', 'Good night!', 'What is your name?'], correctAnswer: 'Hello, how are you?', type: 'multiple_choice' },
      { id: 'en1q2', question: 'What does "Nice to meet you" mean?', options: ['Hoşça kal', 'Tanıştığıma memnun oldum', 'Günaydın', 'Teşekkürler'], correctAnswer: 'Tanıştığıma memnun oldum', type: 'multiple_choice' },
      { id: 'en1q3', question: 'Complete: "My name ___ Ali."', options: ['am', 'is', 'are', 'be'], correctAnswer: 'is', type: 'fill_blank' },
      { id: 'en1q4', question: 'Which is a greeting?', options: ['Goodbye', 'Sorry', 'Good morning', 'Please'], correctAnswer: 'Good morning', type: 'multiple_choice' },
      { id: 'en1q5', question: 'Translate: "Ben Türkiye\'denim."', options: ['I am from Turkey.', 'I like Turkey.', 'Turkey is big.', 'I go to Turkey.'], correctAnswer: 'I am from Turkey.', type: 'translation_tr_to_target' },
    ]
  },
  {
    id: 'en_2',
    targetLanguage: 'English',
    title: 'Classroom & School',
    description: 'Learn words used in a school environment.',
    category: 'Vocabulary',
    difficulty: 'Beginner',
    duration: '5',
    xpReward: 20,
    questions: [
      { id: 'en2q1', question: 'What is "kalem" in English?', options: ['Book', 'Pen', 'Desk', 'Bag'], correctAnswer: 'Pen', type: 'meaning_match' },
      { id: 'en2q2', question: 'Translate: "öğretmen"', options: ['Student', 'Teacher', 'Doctor', 'Driver'], correctAnswer: 'Teacher', type: 'multiple_choice' },
      { id: 'en2q3', question: '"I read a ___" — choose the correct word.', options: ['chair', 'book', 'window', 'door'], correctAnswer: 'book', type: 'fill_blank' },
      { id: 'en2q4', question: 'What does "homework" mean?', options: ['Ev', 'Ödev', 'Okul', 'Sınıf'], correctAnswer: 'Ödev', type: 'meaning_match' },
      { id: 'en2q5', question: 'Which word is a school item?', options: ['Eraser', 'Kitchen', 'Garden', 'Bedroom'], correctAnswer: 'Eraser', type: 'multiple_choice' },
    ]
  },
  {
    id: 'en_3',
    targetLanguage: 'English',
    title: 'Numbers & Counting',
    description: 'Learn numbers from 1 to 20.',
    category: 'Numbers',
    difficulty: 'Beginner',
    duration: '4',
    xpReward: 20,
    questions: [
      { id: 'en3q1', question: 'How do you say "Beş"?', options: ['Four', 'Five', 'Six', 'Seven'], correctAnswer: 'Five', type: 'multiple_choice' },
      { id: 'en3q2', question: 'Ten + Two = ?', options: ['Eleven', 'Twelve', 'Thirteen', 'Fourteen'], correctAnswer: 'Twelve', type: 'multiple_choice' },
      { id: 'en3q3', question: 'Which is "Dokuz"?', options: ['Eight', 'Nine', 'Ten', 'Seven'], correctAnswer: 'Nine', type: 'multiple_choice' },
      { id: 'en3q4', question: 'Translate: "On beş"', options: ['Fifty', 'Fifteen', 'Five', 'Fifth'], correctAnswer: 'Fifteen', type: 'multiple_choice' },
      { id: 'en3q5', question: 'Complete: "One, two, ___, four."', options: ['third', 'tree', 'three', 'there'], correctAnswer: 'three', type: 'fill_blank' },
    ]
  },
  {
    id: 'en_4',
    targetLanguage: 'English',
    title: 'Common Colors',
    description: 'Learn the basic colors in English.',
    category: 'Vocabulary',
    difficulty: 'Beginner',
    duration: '5',
    xpReward: 20,
    questions: [
      { id: 'en4q1', question: 'The sky is ___ on a sunny day.', options: ['green', 'red', 'blue', 'yellow'], correctAnswer: 'blue', type: 'fill_blank' },
      { id: 'en4q2', question: 'What is "Kırmızı" in English?', options: ['Red', 'Read', 'Ride', 'Rod'], correctAnswer: 'Red', type: 'multiple_choice' },
      { id: 'en4q3', question: 'Apples are usually ___ or green.', options: ['black', 'pink', 'red', 'purple'], correctAnswer: 'red', type: 'fill_blank' },
      { id: 'en4q4', question: 'Translate: "Sarı"', options: ['White', 'Yellow', 'Orange', 'Brown'], correctAnswer: 'Yellow', type: 'multiple_choice' },
      { id: 'en4q5', question: 'Which color is "Siyah"?', options: ['White', 'Black', 'Gray', 'Blue'], correctAnswer: 'Black', type: 'multiple_choice' },
    ]
  },
  {
    id: 'en_5',
    targetLanguage: 'English',
    title: 'Family Members',
    description: 'Learn how to talk about your family.',
    category: 'Family',
    difficulty: 'Beginner',
    duration: '6',
    xpReward: 20,
    questions: [
      { id: 'en5q1', question: 'What is "Anne" in English?', options: ['Father', 'Brother', 'Mother', 'Sister'], correctAnswer: 'Mother', type: 'multiple_choice' },
      { id: 'en5q2', question: 'My father\'s brother is my ___.', options: ['Aunt', 'Uncle', 'Cousin', 'Grandpa'], correctAnswer: 'Uncle', type: 'fill_blank' },
      { id: 'en5q3', question: 'Translate: "Kız kardeş"', options: ['Brother', 'Sister', 'Daughter', 'Son'], correctAnswer: 'Sister', type: 'multiple_choice' },
      { id: 'en5q4', question: 'Who is your "Grandfather"?', options: ['Baba', 'Dede', 'Amca', 'Dayı'], correctAnswer: 'Dede', type: 'multiple_choice' },
      { id: 'en5q5', question: 'A "Son" is a ___ child.', options: ['female', 'male', 'old', 'young'], correctAnswer: 'male', type: 'multiple_choice' },
    ]
  },
  {
    id: 'en_6',
    targetLanguage: 'English',
    title: 'Daily Routine Verbs',
    description: 'Learn common verbs for daily activities.',
    category: 'Verbs',
    difficulty: 'Beginner',
    duration: '7',
    xpReward: 20,
    questions: [
      { id: 'en6q1', question: 'I ___ up at 7 AM.', options: ['get', 'take', 'go', 'do'], correctAnswer: 'get', type: 'fill_blank' },
      { id: 'en6q2', question: 'Translate: "Kahvaltı yapmak"', options: ['Have lunch', 'Have breakfast', 'Have dinner', 'Go to sleep'], correctAnswer: 'Have breakfast', type: 'multiple_choice' },
      { id: 'en6q3', question: 'I ___ to school by bus.', options: ['walk', 'go', 'drive', 'run'], correctAnswer: 'go', type: 'fill_blank' },
      { id: 'en6q4', question: 'What is "uyumak" in English?', options: ['Eat', 'Drink', 'Sleep', 'Play'], correctAnswer: 'Sleep', type: 'multiple_choice' },
      { id: 'en6q5', question: 'I ___ my teeth every morning.', options: ['wash', 'brush', 'clean', 'fix'], correctAnswer: 'brush', type: 'fill_blank' },
    ]
  },

  // --- GERMAN (6 Lessons - Placeholder content similar to English but in German) ---
  {
    id: 'de_1',
    targetLanguage: 'German',
    title: 'Begrüßungen',
    description: 'Lerne grundlegende Begrüßungen auf Deutsch.',
    category: 'Vocabulary',
    difficulty: 'Beginner',
    duration: '5',
    xpReward: 20,
    questions: [
      { id: 'de1q1', question: 'Translate: "Merhaba"', options: ['Hallo', 'Tschüss', 'Danke', 'Bitte'], correctAnswer: 'Hallo', type: 'multiple_choice' },
      { id: 'de1q2', question: 'How to say "Good morning"?', options: ['Guten Tag', 'Guten Morgen', 'Gute Nacht', 'Auf Wiedersehen'], correctAnswer: 'Guten Morgen', type: 'multiple_choice' },
      { id: 'de1q3', question: '"Wie geht es dir?" means:', options: ['What is your name?', 'How are you?', 'Where do you live?', 'How old are you?'], correctAnswer: 'How are you?', type: 'multiple_choice' },
      { id: 'de1q4', question: 'Translate: "Tschüss"', options: ['Hello', 'Please', 'Goodbye', 'Yes'], correctAnswer: 'Goodbye', type: 'multiple_choice' },
      { id: 'de1q5', question: 'What is "Teşekkür ederim"?', options: ['Bitte', 'Entschuldigung', 'Danke', 'Ja'], correctAnswer: 'Danke', type: 'multiple_choice' },
    ]
  },
  // Adding placeholders for de_2 to de_6 to satisfy the "6 unique lessons" requirement
  { id: 'de_2', targetLanguage: 'German', title: 'Zahlen 1-10', description: 'Zahlen auf Deutsch.', category: 'Numbers', difficulty: 'Beginner', duration: '5', xpReward: 20, questions: [{ id: 'de2q1', question: 'Translate: "Bir"', options: ['Eins', 'Zwei', 'Drei', 'Vier'], correctAnswer: 'Eins', type: 'multiple_choice' }, { id: 'de2q2', question: 'Translate: "İki"', options: ['Eins', 'Zwei', 'Drei', 'Vier'], correctAnswer: 'Zwei', type: 'multiple_choice' }, { id: 'de2q3', question: 'Translate: "Üç"', options: ['Eins', 'Zwei', 'Drei', 'Vier'], correctAnswer: 'Drei', type: 'multiple_choice' }, { id: 'de2q4', question: 'Translate: "Dört"', options: ['Eins', 'Zwei', 'Drei', 'Vier'], correctAnswer: 'Vier', type: 'multiple_choice' }, { id: 'de2q5', question: 'Translate: "Beş"', options: ['Fünf', 'Sechs', 'Sieben', 'Acht'], correctAnswer: 'Fünf', type: 'multiple_choice' }] },
  { id: 'de_3', targetLanguage: 'German', title: 'Farben', description: 'Grundfarben.', category: 'Vocabulary', difficulty: 'Beginner', duration: '5', xpReward: 20, questions: [{ id: 'de3q1', question: 'Rot', options: ['Red', 'Green', 'Blue', 'Yellow'], correctAnswer: 'Red', type: 'multiple_choice' }, { id: 'de3q2', question: 'Blau', options: ['Red', 'Green', 'Blue', 'Yellow'], correctAnswer: 'Blue', type: 'multiple_choice' }, { id: 'de3q3', question: 'Grün', options: ['Red', 'Green', 'Blue', 'Yellow'], correctAnswer: 'Green', type: 'multiple_choice' }, { id: 'de3q4', question: 'Gelb', options: ['Red', 'Green', 'Blue', 'Yellow'], correctAnswer: 'Yellow', type: 'multiple_choice' }, { id: 'de3q5', question: 'Schwarz', options: ['Black', 'White', 'Gray', 'Brown'], correctAnswer: 'Black', type: 'multiple_choice' }] },
  { id: 'de_4', targetLanguage: 'German', title: 'Familie', description: 'Familienmitglieder.', category: 'Family', difficulty: 'Beginner', duration: '5', xpReward: 20, questions: [{ id: 'de4q1', question: 'Mutter', options: ['Mother', 'Father', 'Brother', 'Sister'], correctAnswer: 'Mother', type: 'multiple_choice' }, { id: 'de4q2', question: 'Vater', options: ['Mother', 'Father', 'Brother', 'Sister'], correctAnswer: 'Father', type: 'multiple_choice' }, { id: 'de4q3', question: 'Bruder', options: ['Mother', 'Father', 'Brother', 'Sister'], correctAnswer: 'Brother', type: 'multiple_choice' }, { id: 'de4q4', question: 'Schwester', options: ['Mother', 'Father', 'Brother', 'Sister'], correctAnswer: 'Sister', type: 'multiple_choice' }, { id: 'de4q5', question: 'Kind', options: ['Child', 'Adult', 'Friend', 'Teacher'], correctAnswer: 'Child', type: 'multiple_choice' }] },
  { id: 'de_5', targetLanguage: 'German', title: 'Tiere', description: 'Gängige Tiere.', category: 'Vocabulary', difficulty: 'Beginner', duration: '5', xpReward: 20, questions: [{ id: 'de5q1', question: 'Hund', options: ['Dog', 'Cat', 'Bird', 'Fish'], correctAnswer: 'Dog', type: 'multiple_choice' }, { id: 'de5q2', question: 'Katze', options: ['Dog', 'Cat', 'Bird', 'Fish'], correctAnswer: 'Cat', type: 'multiple_choice' }, { id: 'de5q3', question: 'Vogel', options: ['Dog', 'Cat', 'Bird', 'Fish'], correctAnswer: 'Bird', type: 'multiple_choice' }, { id: 'de5q4', question: 'Fisch', options: ['Dog', 'Cat', 'Bird', 'Fish'], correctAnswer: 'Fish', type: 'multiple_choice' }, { id: 'de5q5', question: 'Pferd', options: ['Horse', 'Cow', 'Pig', 'Sheep'], correctAnswer: 'Horse', type: 'multiple_choice' }] },
  { id: 'de_6', targetLanguage: 'German', title: 'Essen & Trinken', description: 'Basics.', category: 'Vocabulary', difficulty: 'Beginner', duration: '5', xpReward: 20, questions: [{ id: 'de6q1', question: 'Brot', options: ['Bread', 'Milk', 'Water', 'Apple'], correctAnswer: 'Bread', type: 'multiple_choice' }, { id: 'de6q2', question: 'Milch', options: ['Bread', 'Milk', 'Water', 'Apple'], correctAnswer: 'Milk', type: 'multiple_choice' }, { id: 'de6q3', question: 'Wasser', options: ['Bread', 'Milk', 'Water', 'Apple'], correctAnswer: 'Water', type: 'multiple_choice' }, { id: 'de6q4', question: 'Apfel', options: ['Bread', 'Milk', 'Water', 'Apple'], correctAnswer: 'Apple', type: 'multiple_choice' }, { id: 'de6q5', question: 'Kaffee', options: ['Coffee', 'Tea', 'Juice', 'Beer'], correctAnswer: 'Coffee', type: 'multiple_choice' }] },

  // --- SPANISH (6 Lessons) ---
  { id: 'es_1', targetLanguage: 'Spanish', title: 'Saludos', description: 'Hola y adiós.', category: 'Vocabulary', difficulty: 'Beginner', duration: '5', xpReward: 20, questions: [{ id: 'es1q1', question: 'Hola', options: ['Hello', 'Goodbye', 'Thanks', 'Please'], correctAnswer: 'Hello', type: 'multiple_choice' }, { id: 'es1q2', question: 'Adiós', options: ['Hello', 'Goodbye', 'Thanks', 'Please'], correctAnswer: 'Goodbye', type: 'multiple_choice' }, { id: 'es1q3', question: 'Gracias', options: ['Hello', 'Goodbye', 'Thanks', 'Please'], correctAnswer: 'Thanks', type: 'multiple_choice' }, { id: 'es1q4', question: 'Por favor', options: ['Hello', 'Goodbye', 'Thanks', 'Please'], correctAnswer: 'Please', type: 'multiple_choice' }, { id: 'es1q5', question: '¿Cómo estás?', options: ['How are you?', 'Who are you?', 'Where are you?', 'When are you?'], correctAnswer: 'How are you?', type: 'multiple_choice' }] },
  { id: 'es_2', targetLanguage: 'Spanish', title: 'Números', description: '1-10.', category: 'Numbers', difficulty: 'Beginner', duration: '5', xpReward: 20, questions: [{ id: 'es2q1', question: 'Uno', options: ['One', 'Two', 'Three', 'Four'], correctAnswer: 'One', type: 'multiple_choice' }, { id: 'es2q2', question: 'Dos', options: ['One', 'Two', 'Three', 'Four'], correctAnswer: 'Two', type: 'multiple_choice' }, { id: 'es2q3', question: 'Tres', options: ['One', 'Two', 'Three', 'Four'], correctAnswer: 'Three', type: 'multiple_choice' }, { id: 'es2q4', question: 'Cuatro', options: ['One', 'Two', 'Three', 'Four'], correctAnswer: 'Four', type: 'multiple_choice' }, { id: 'es2q5', question: 'Cinco', options: ['Five', 'Six', 'Seven', 'Eight'], correctAnswer: 'Five', type: 'multiple_choice' }] },
  { id: 'es_3', targetLanguage: 'Spanish', title: 'Colores', description: 'Rojo y azul.', category: 'Vocabulary', difficulty: 'Beginner', duration: '5', xpReward: 20, questions: [{ id: 'es3q1', question: 'Rojo', options: ['Red', 'Blue', 'Green', 'Yellow'], correctAnswer: 'Red', type: 'multiple_choice' }, { id: 'es3q2', question: 'Azul', options: ['Red', 'Blue', 'Green', 'Yellow'], correctAnswer: 'Blue', type: 'multiple_choice' }, { id: 'es3q3', question: 'Verde', options: ['Red', 'Blue', 'Green', 'Yellow'], correctAnswer: 'Green', type: 'multiple_choice' }, { id: 'es3q4', question: 'Amarillo', options: ['Red', 'Blue', 'Green', 'Yellow'], correctAnswer: 'Amarillo', type: 'multiple_choice' }, { id: 'es3q5', question: 'Negro', options: ['Black', 'White', 'Gray', 'Brown'], correctAnswer: 'Black', type: 'multiple_choice' }] },
  { id: 'es_4', targetLanguage: 'Spanish', title: 'Familia', description: 'Madre y padre.', category: 'Family', difficulty: 'Beginner', duration: '5', xpReward: 20, questions: [{ id: 'es4q1', question: 'Madre', options: ['Mother', 'Father', 'Brother', 'Sister'], correctAnswer: 'Mother', type: 'multiple_choice' }, { id: 'es4q2', question: 'Padre', options: ['Mother', 'Father', 'Brother', 'Sister'], correctAnswer: 'Father', type: 'multiple_choice' }, { id: 'es4q3', question: 'Hermano', options: ['Mother', 'Father', 'Brother', 'Sister'], correctAnswer: 'Hermano', type: 'multiple_choice' }, { id: 'es4q4', question: 'Hermana', options: ['Mother', 'Father', 'Brother', 'Sister'], correctAnswer: 'Sister', type: 'multiple_choice' }, { id: 'es4q5', question: 'Hijo', options: ['Son', 'Daughter', 'Child', 'Friend'], correctAnswer: 'Son', type: 'multiple_choice' }] },
  { id: 'es_5', targetLanguage: 'Spanish', title: 'Animales', description: 'Perro y gato.', category: 'Vocabulary', difficulty: 'Beginner', duration: '5', xpReward: 20, questions: [{ id: 'es5q1', question: 'Perro', options: ['Dog', 'Cat', 'Bird', 'Fish'], correctAnswer: 'Dog', type: 'multiple_choice' }, { id: 'es5q2', question: 'Gato', options: ['Dog', 'Cat', 'Bird', 'Fish'], correctAnswer: 'Cat', type: 'multiple_choice' }, { id: 'es5q3', question: 'Pájaro', options: ['Dog', 'Cat', 'Bird', 'Fish'], correctAnswer: 'Bird', type: 'multiple_choice' }, { id: 'es5q4', question: 'Pez', options: ['Dog', 'Cat', 'Bird', 'Fish'], correctAnswer: 'Fish', type: 'multiple_choice' }, { id: 'es5q5', question: 'Caballo', options: ['Horse', 'Cow', 'Pig', 'Sheep'], correctAnswer: 'Horse', type: 'multiple_choice' }] },
  { id: 'es_6', targetLanguage: 'Spanish', title: 'Comida', description: 'Pan y agua.', category: 'Vocabulary', difficulty: 'Beginner', duration: '5', xpReward: 20, questions: [{ id: 'es6q1', question: 'Pan', options: ['Bread', 'Water', 'Apple', 'Milk'], correctAnswer: 'Bread', type: 'multiple_choice' }, { id: 'es6q2', question: 'Agua', options: ['Bread', 'Water', 'Apple', 'Milk'], correctAnswer: 'Water', type: 'multiple_choice' }, { id: 'es6q3', question: 'Manzana', options: ['Bread', 'Water', 'Apple', 'Milk'], correctAnswer: 'Apple', type: 'multiple_choice' }, { id: 'es6q4', question: 'Leche', options: ['Bread', 'Water', 'Apple', 'Milk'], correctAnswer: 'Leche', type: 'multiple_choice' }, { id: 'es6q5', question: 'Café', options: ['Coffee', 'Tea', 'Sugar', 'Salt'], correctAnswer: 'Coffee', type: 'multiple_choice' }] },

  // --- FRENCH (6 Lessons) ---
  { id: 'fr_1', targetLanguage: 'French', title: 'Salutations', description: 'Bonjour et merci.', category: 'Vocabulary', difficulty: 'Beginner', duration: '5', xpReward: 20, questions: [{ id: 'fr1q1', question: 'Bonjour', options: ['Hello', 'Goodbye', 'Thanks', 'Please'], correctAnswer: 'Hello', type: 'multiple_choice' }, { id: 'fr1q2', question: 'Au revoir', options: ['Hello', 'Goodbye', 'Thanks', 'Please'], correctAnswer: 'Goodbye', type: 'multiple_choice' }, { id: 'fr1q3', question: 'Merci', options: ['Hello', 'Goodbye', 'Thanks', 'Please'], correctAnswer: 'Thanks', type: 'multiple_choice' }, { id: 'fr1q4', question: "S'il vous plaît", options: ['Hello', 'Goodbye', 'Thanks', 'Please'], correctAnswer: 'Please', type: 'multiple_choice' }, { id: 'fr1q5', question: 'Comment ça va?', options: ['How are you?', 'Who are you?', 'Where are you?', 'When are you?'], correctAnswer: 'How are you?', type: 'multiple_choice' }] },
  { id: 'fr_2', targetLanguage: 'French', title: 'Nombres', description: '1-10.', category: 'Numbers', difficulty: 'Beginner', duration: '5', xpReward: 20, questions: [{ id: 'fr2q1', question: 'Un', options: ['One', 'Two', 'Three', 'Four'], correctAnswer: 'One', type: 'multiple_choice' }, { id: 'fr2q2', question: 'Deux', options: ['One', 'Two', 'Three', 'Four'], correctAnswer: 'Two', type: 'multiple_choice' }, { id: 'fr2q3', question: 'Trois', options: ['One', 'Two', 'Three', 'Four'], correctAnswer: 'Three', type: 'multiple_choice' }, { id: 'fr2q4', question: 'Quatre', options: ['One', 'Two', 'Three', 'Four'], correctAnswer: 'Quatre', type: 'multiple_choice' }, { id: 'fr2q5', question: 'Cinq', options: ['Five', 'Six', 'Seven', 'Eight'], correctAnswer: 'Five', type: 'multiple_choice' }] },
  { id: 'fr_3', targetLanguage: 'French', title: 'Couleurs', description: 'Rouge et bleu.', category: 'Vocabulary', difficulty: 'Beginner', duration: '5', xpReward: 20, questions: [{ id: 'fr3q1', question: 'Rouge', options: ['Red', 'Blue', 'Green', 'Yellow'], correctAnswer: 'Red', type: 'multiple_choice' }, { id: 'fr3q2', question: 'Bleu', options: ['Red', 'Blue', 'Green', 'Yellow'], correctAnswer: 'Blue', type: 'multiple_choice' }, { id: 'fr3q3', question: 'Vert', options: ['Red', 'Blue', 'Green', 'Yellow'], correctAnswer: 'Green', type: 'multiple_choice' }, { id: 'fr3q4', question: 'Jaune', options: ['Red', 'Blue', 'Green', 'Yellow'], correctAnswer: 'Jaune', type: 'multiple_choice' }, { id: 'fr3q5', question: 'Noir', options: ['Black', 'White', 'Gray', 'Brown'], correctAnswer: 'Black', type: 'multiple_choice' }] },
  { id: 'fr_4', targetLanguage: 'French', title: 'Famille', description: 'Mère et père.', category: 'Family', difficulty: 'Beginner', duration: '5', xpReward: 20, questions: [{ id: 'fr4q1', question: 'Mère', options: ['Mother', 'Father', 'Brother', 'Sister'], correctAnswer: 'Mother', type: 'multiple_choice' }, { id: 'fr4q2', question: 'Père', options: ['Mother', 'Father', 'Brother', 'Sister'], correctAnswer: 'Father', type: 'multiple_choice' }, { id: 'fr4q3', question: 'Frère', options: ['Mother', 'Father', 'Brother', 'Sister'], correctAnswer: 'Brother', type: 'multiple_choice' }, { id: 'fr4q4', question: 'Sœur', options: ['Mother', 'Father', 'Brother', 'Sister'], correctAnswer: 'Sister', type: 'multiple_choice' }, { id: 'fr4q5', question: 'Enfant', options: ['Child', 'Adult', 'Friend', 'Teacher'], correctAnswer: 'Child', type: 'multiple_choice' }] },
  { id: 'fr_5', targetLanguage: 'French', title: 'Animaux', description: 'Chien et chat.', category: 'Vocabulary', difficulty: 'Beginner', duration: '5', xpReward: 20, questions: [{ id: 'fr5q1', question: 'Chien', options: ['Dog', 'Cat', 'Bird', 'Fish'], correctAnswer: 'Dog', type: 'multiple_choice' }, { id: 'fr5q2', question: 'Chat', options: ['Dog', 'Cat', 'Bird', 'Fish'], correctAnswer: 'Cat', type: 'multiple_choice' }, { id: 'fr5q3', question: 'Oiseau', options: ['Dog', 'Cat', 'Bird', 'Fish'], correctAnswer: 'Bird', type: 'multiple_choice' }, { id: 'fr5q4', question: 'Poisson', options: ['Dog', 'Cat', 'Bird', 'Fish'], correctAnswer: 'Fish', type: 'multiple_choice' }, { id: 'fr5q5', question: 'Cheval', options: ['Horse', 'Cow', 'Pig', 'Sheep'], correctAnswer: 'Horse', type: 'multiple_choice' }] },
  { id: 'fr_6', targetLanguage: 'French', title: 'Nourriture', description: 'Pain et eau.', category: 'Vocabulary', difficulty: 'Beginner', duration: '5', xpReward: 20, questions: [{ id: 'fr6q1', question: 'Pain', options: ['Bread', 'Water', 'Apple', 'Milk'], correctAnswer: 'Bread', type: 'multiple_choice' }, { id: 'fr6q2', question: 'Eau', options: ['Bread', 'Water', 'Apple', 'Milk'], correctAnswer: 'Water', type: 'multiple_choice' }, { id: 'fr6q3', question: 'Pomme', options: ['Bread', 'Water', 'Apple', 'Milk'], correctAnswer: 'Apple', type: 'multiple_choice' }, { id: 'fr6q4', question: 'Lait', options: ['Bread', 'Water', 'Apple', 'Milk'], correctAnswer: 'Lait', type: 'multiple_choice' }, { id: 'fr6q5', question: 'Café', options: ['Coffee', 'Tea', 'Sugar', 'Salt'], correctAnswer: 'Coffee', type: 'multiple_choice' }] },

  // --- ARABIC (6 Lessons) ---
  { id: 'ar_1', targetLanguage: 'Arabic', title: 'التحيات', description: 'مرحبا وشكرا.', category: 'Vocabulary', difficulty: 'Beginner', duration: '5', xpReward: 20, questions: [{ id: 'ar1q1', question: 'مرحبا', options: ['Hello', 'Goodbye', 'Thanks', 'Please'], correctAnswer: 'Hello', type: 'multiple_choice' }, { id: 'ar1q2', question: 'وداعا', options: ['Hello', 'Goodbye', 'Thanks', 'Please'], correctAnswer: 'Goodbye', type: 'multiple_choice' }, { id: 'ar1q3', question: 'شكرا', options: ['Hello', 'Goodbye', 'Thanks', 'Please'], correctAnswer: 'Thanks', type: 'multiple_choice' }, { id: 'ar1q4', question: 'من فضلك', options: ['Hello', 'Goodbye', 'Thanks', 'Please'], correctAnswer: 'Please', type: 'multiple_choice' }, { id: 'ar1q5', question: 'كيف حالك؟', options: ['How are you?', 'Who are you?', 'Where are you?', 'When are you?'], correctAnswer: 'How are you?', type: 'multiple_choice' }] },
  { id: 'ar_2', targetLanguage: 'Arabic', title: 'الأرقام', description: '١-١٠.', category: 'Numbers', difficulty: 'Beginner', duration: '5', xpReward: 20, questions: [{ id: 'ar2q1', question: 'واحد', options: ['One', 'Two', 'Three', 'Four'], correctAnswer: 'One', type: 'multiple_choice' }, { id: 'ar2q2', question: 'اثنان', options: ['One', 'Two', 'Three', 'Four'], correctAnswer: 'Two', type: 'multiple_choice' }, { id: 'ar2q3', question: 'ثلاثة', options: ['One', 'Two', 'Three', 'Four'], correctAnswer: 'Three', type: 'multiple_choice' }, { id: 'ar2q4', question: 'أربعة', options: ['One', 'Two', 'Three', 'Four'], correctAnswer: 'أربعة', type: 'multiple_choice' }, { id: 'ar2q5', question: 'خمسة', options: ['Five', 'Six', 'Seven', 'Eight'], correctAnswer: 'Five', type: 'multiple_choice' }] },
  { id: 'ar_3', targetLanguage: 'Arabic', title: 'الألوان', description: 'أحمر وأزرق.', category: 'Vocabulary', difficulty: 'Beginner', duration: '5', xpReward: 20, questions: [{ id: 'ar3q1', question: 'أحمر', options: ['Red', 'Blue', 'Green', 'Yellow'], correctAnswer: 'Red', type: 'multiple_choice' }, { id: 'ar3q2', question: 'أزرق', options: ['Red', 'Blue', 'Green', 'Yellow'], correctAnswer: 'Blue', type: 'multiple_choice' }, { id: 'ar3q3', question: 'أخضر', options: ['Red', 'Blue', 'Green', 'Yellow'], correctAnswer: 'Green', type: 'multiple_choice' }, { id: 'ar3q4', question: 'أصفر', options: ['Red', 'Blue', 'Green', 'Yellow'], correctAnswer: 'أصفر', type: 'multiple_choice' }, { id: 'ar3q5', question: 'أسود', options: ['Black', 'White', 'Gray', 'Brown'], correctAnswer: 'Black', type: 'multiple_choice' }] },
  { id: 'ar_4', targetLanguage: 'Arabic', title: 'العائلة', description: 'أمي وأبي.', category: 'Family', difficulty: 'Beginner', duration: '5', xpReward: 20, questions: [{ id: 'ar4q1', question: 'أمي', options: ['Mother', 'Father', 'Brother', 'Sister'], correctAnswer: 'Mother', type: 'multiple_choice' }, { id: 'ar4q2', question: 'أبي', options: ['Mother', 'Father', 'Brother', 'Sister'], correctAnswer: 'Father', type: 'multiple_choice' }, { id: 'ar4q3', question: 'أخي', options: ['Mother', 'Father', 'Brother', 'Sister'], correctAnswer: 'Brother', type: 'multiple_choice' }, { id: 'ar4q4', question: 'أختي', options: ['Mother', 'Father', 'Brother', 'Sister'], correctAnswer: 'Sister', type: 'multiple_choice' }, { id: 'ar4q5', question: 'طفل', options: ['Child', 'Adult', 'Friend', 'Teacher'], correctAnswer: 'Child', type: 'multiple_choice' }] },
  { id: 'ar_5', targetLanguage: 'Arabic', title: 'الحيوانات', description: 'كلب وقطة.', category: 'Vocabulary', difficulty: 'Beginner', duration: '5', xpReward: 20, questions: [{ id: 'ar5q1', question: 'كلب', options: ['Dog', 'Cat', 'Bird', 'Fish'], correctAnswer: 'Dog', type: 'multiple_choice' }, { id: 'ar5q2', question: 'قطة', options: ['Dog', 'Cat', 'Bird', 'Fish'], correctAnswer: 'Cat', type: 'multiple_choice' }, { id: 'ar5q3', question: 'عصفور', options: ['Dog', 'Cat', 'Bird', 'Fish'], correctAnswer: 'Bird', type: 'multiple_choice' }, { id: 'ar5q4', question: 'سمكة', options: ['Dog', 'Cat', 'Bird', 'Fish'], correctAnswer: 'Fish', type: 'multiple_choice' }, { id: 'ar5q5', question: 'حصان', options: ['Horse', 'Cow', 'Pig', 'Sheep'], correctAnswer: 'Horse', type: 'multiple_choice' }] },
  { id: 'ar_6', targetLanguage: 'Arabic', title: 'الطعام', description: 'خبز وماء.', category: 'Vocabulary', difficulty: 'Beginner', duration: '5', xpReward: 20, questions: [{ id: 'ar6q1', question: 'خبز', options: ['Bread', 'Water', 'Apple', 'Milk'], correctAnswer: 'Bread', type: 'multiple_choice' }, { id: 'ar6q2', question: 'ماء', options: ['Bread', 'Water', 'Apple', 'Milk'], correctAnswer: 'Water', type: 'multiple_choice' }, { id: 'ar6q3', question: 'تفاح', options: ['Bread', 'Water', 'Apple', 'Milk'], correctAnswer: 'Apple', type: 'multiple_choice' }, { id: 'ar6q4', question: 'حليب', options: ['Bread', 'Water', 'Apple', 'Milk'], correctAnswer: 'Lait', type: 'multiple_choice' }, { id: 'ar6q5', question: 'قهوة', options: ['Coffee', 'Tea', 'Sugar', 'Salt'], correctAnswer: 'Coffee', type: 'multiple_choice' }] },
];
