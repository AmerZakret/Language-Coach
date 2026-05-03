import { Controller, Get, Param } from '@nestjs/common';
import { LessonsService } from './lessons.service';

@Controller('lessons')
export class LessonsController {
  constructor(private readonly lessonsService: LessonsService) {}

  @Get()
  findAll() {
    return [
      {
        id: '1',
        title: 'Greetings & Basics',
        description: 'Learn essential greetings and basic English phrases.',
        level: 'Beginner',
        type: 'Vocabulary',
        durationMinutes: 10,
        xpReward: 50,
      },
      {
        id: '2',
        title: 'The "To Be" Verb',
        description: 'Master am, is, are for daily descriptions.',
        level: 'Beginner',
        type: 'Grammar',
        durationMinutes: 12,
        xpReward: 60,
      },
      {
        id: '3',
        title: 'Numbers & Counting',
        description: 'Learn numbers 1-100 and basic time expressions.',
        level: 'Beginner',
        type: 'Vocabulary',
        durationMinutes: 8,
        xpReward: 40,
      },
      {
        id: '4',
        title: 'Daily Activities',
        description:
          'Common verbs and sentence structures for your daily routine.',
        level: 'Beginner',
        type: 'Basic Sentences',
        durationMinutes: 15,
        xpReward: 75,
      },
      {
        id: '5',
        title: 'Travel: At the Airport',
        description: 'Essential phrases for check-in and security.',
        level: 'Beginner',
        type: 'Travel English',
        durationMinutes: 10,
        xpReward: 50,
      },
      {
        id: '6',
        title: 'In the Restaurant',
        description: 'How to order food and ask for the bill.',
        level: 'Beginner',
        type: 'Daily Conversation',
        durationMinutes: 12,
        xpReward: 60,
      },
      {
        id: '7',
        title: 'Family Members',
        description: 'Vocabulary for describing your family and relatives.',
        level: 'Beginner',
        type: 'Vocabulary',
        durationMinutes: 10,
        xpReward: 50,
      },
      {
        id: '8',
        title: 'Essential Questions',
        description: 'How to ask Who, What, Where, and Why.',
        level: 'Beginner',
        type: 'Basic Sentences',
        durationMinutes: 10,
        xpReward: 50,
      },
    ];
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    // For now, return a full lesson object for any ID
    return {
      id,
      title: 'Greetings & Basics',
      description: 'Learn essential greetings and basic English phrases.',
      level: 'Beginner',
      type: 'Vocabulary',
      durationMinutes: 10,
      xpReward: 50,
      questions: [
        {
          id: 'q1',
          text: 'How are you?',
          options: ['Nasılsın?', 'Nerelisin?', 'Kaç yaşındasın?', 'Adın ne?'],
          correctAnswer: 'Nasılsın?',
        },
        {
          id: 'q2',
          text: 'Nice to meet you.',
          options: [
            'Günaydın',
            'Tanıştığımıza memnun oldum',
            'Hoşçakal',
            'Lütfen',
          ],
          correctAnswer: 'Tanıştığımıza memnun oldum',
        },
        {
          id: 'q3',
          text: '___ name is John.',
          options: ['I', 'My', 'Me', 'Mine'],
          correctAnswer: 'My',
        },
        {
          id: 'q4',
          text: 'See you later.',
          options: [
            'Sonra görüşürüz',
            'Şimdi gidiyorum',
            'Hoşgeldiniz',
            'İyiyim',
          ],
          correctAnswer: 'Sonra görüşürüz',
        },
      ],
    };
  }
}
