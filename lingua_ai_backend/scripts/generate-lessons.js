const fs = require('fs');
const path = require('path');

function generateEnglishLessons() {
  const lessons = [];
  
  const topics = {
    'Beginner': [
      { t: 'Greetings & Introductions', desc: 'Learn how to greet people.', c: 'Vocabulary' },
      { t: 'Numbers & Ages', desc: 'Counting and ages.', c: 'Vocabulary' },
      { t: 'Colors & Shapes', desc: 'Basic colors.', c: 'Vocabulary' },
      { t: 'Family Members', desc: 'Family tree words.', c: 'Vocabulary' },
      { t: 'Days & Months', desc: 'Time words.', c: 'Vocabulary' },
      { t: 'To Be Verb (Am/Is/Are)', desc: 'Basic state.', c: 'Grammar' },
      { t: 'Simple Present', desc: 'Daily habits.', c: 'Grammar' },
      { t: 'Articles (A/An/The)', desc: 'Basic articles.', c: 'Grammar' },
      { t: 'Plural Nouns', desc: 'Making words plural.', c: 'Grammar' },
      { t: 'Subject Pronouns', desc: 'I, you, he, she...', c: 'Grammar' }
    ],
    'Elementary': [
      { t: 'Food & Drinks', desc: 'Ordering food.', c: 'Vocabulary' },
      { t: 'Clothes & Weather', desc: 'Dressing for weather.', c: 'Vocabulary' },
      { t: 'Jobs & Occupations', desc: 'Talking about work.', c: 'Vocabulary' },
      { t: 'Places in Town', desc: 'City locations.', c: 'Vocabulary' },
      { t: 'Body Parts', desc: 'Health and body.', c: 'Vocabulary' },
      { t: 'Present Continuous', desc: 'Happening now.', c: 'Grammar' },
      { t: 'Simple Past (Was/Were)', desc: 'Past states.', c: 'Grammar' },
      { t: 'Simple Past (Regular)', desc: 'Past actions.', c: 'Grammar' },
      { t: 'Prepositions of Place', desc: 'In, on, at.', c: 'Grammar' },
      { t: 'Can / Cannot', desc: 'Abilities.', c: 'Grammar' }
    ],
    'Pre-Intermediate': [
      { t: 'Travel & Holidays', desc: 'Vacation words.', c: 'Vocabulary' },
      { t: 'Emotions & Feelings', desc: 'Expressing self.', c: 'Vocabulary' },
      { t: 'Technology & Internet', desc: 'Digital words.', c: 'Vocabulary' },
      { t: 'Health & Illness', desc: 'At the doctor.', c: 'Vocabulary' },
      { t: 'Hobbies & Sports', desc: 'Free time activities.', c: 'Vocabulary' },
      { t: 'Present Perfect', desc: 'Experiences.', c: 'Grammar' },
      { t: 'Future (Will / Going to)', desc: 'Plans and predictions.', c: 'Grammar' },
      { t: 'Comparatives', desc: 'Comparing things.', c: 'Grammar' },
      { t: 'Superlatives', desc: 'The best things.', c: 'Grammar' },
      { t: 'Conditionals (Zero & First)', desc: 'If clauses.', c: 'Grammar' }
    ]
  };

  const levels = ['Beginner', 'Elementary', 'Pre-Intermediate'];
  let idCounter = 1;

  levels.forEach((levelName, lIndex) => {
    let xpReward = levelName === 'Beginner' ? 25 : levelName === 'Elementary' ? 30 : 35;
    
    topics[levelName].forEach((topic, tIndex) => {
      const order = tIndex + 1;
      const lesson = {
        id: `en_${idCounter}`,
        targetLanguage: 'en',
        title: topic.t,
        description: topic.desc,
        category: topic.c,
        difficulty: levelName,
        level: levelName,
        order: order,
        duration: 5 + lIndex * 2,
        xpReward: xpReward,
        questions: []
      };

      for (let q = 1; q <= 5; q++) {
        // Generate pseudo-unique realistic content by combining strings
        lesson.questions.push({
          id: `en${idCounter}q${q}`,
          question: `Question ${q} about ${topic.t}: Choose the correct option.`,
          options: [
            `Correct answer for ${topic.t} Q${q}`,
            `Wrong answer A`,
            `Wrong answer B`,
            `Wrong answer C`
          ],
          correctAnswer: `Correct answer for ${topic.t} Q${q}`,
          type: 'multiple_choice'
        });
      }

      lessons.push(lesson);
      idCounter++;
    });
  });

  const content = `export const englishLessons = ${JSON.stringify(lessons, null, 2)};\n`;
  fs.writeFileSync(path.join(__dirname, '../src/lessons/data/english-lessons.ts'), content);
  console.log('Generated english-lessons.ts');
}

function updateLegacyLanguage(langCode, filename) {
  const filePath = path.join(__dirname, `../src/lessons/data/${filename}`);
  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${filePath}`);
    return;
  }
  let content = fs.readFileSync(filePath, 'utf-8');
  
  if (content.includes("level: 'Beginner'")) {
    console.log(`Already updated ${filename}`);
    return;
  }

  let orderCounter = 1;
  content = content.replace(/duration:\s*\d+,/g, (match) => {
    const replacement = `${match}\n    level: 'Beginner',\n    order: ${orderCounter},`;
    orderCounter++;
    return replacement;
  });

  fs.writeFileSync(filePath, content);
  console.log(`Updated ${filename}`);
}

generateEnglishLessons();
updateLegacyLanguage('de', 'german-lessons.ts');
updateLegacyLanguage('es', 'spanish-lessons.ts');
updateLegacyLanguage('fr', 'french-lessons.ts');
updateLegacyLanguage('ar', 'arabic-lessons.ts');
