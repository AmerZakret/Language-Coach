import { Controller, Get, Param, Query } from '@nestjs/common';
import { LessonsService } from './lessons.service';

// Maps Flutter language codes (en, de, es, fr, ar) to full names used by web
const LANG_CODE_MAP: Record<string, string> = {
  en: 'en',
  de: 'de',
  es: 'es',
  fr: 'fr',
  ar: 'ar',
  English: 'en',
  German: 'de',
  Spanish: 'es',
  French: 'fr',
  Arabic: 'ar',
};

@Controller('lessons')
export class LessonsController {
  constructor(private readonly lessonsService: LessonsService) {}

  @Get()
  async findAll(
    @Query('targetLanguage') targetLanguage?: string,
    @Query('level') level?: string,
  ) {
    let code: string | undefined = undefined;
    if (targetLanguage) {
      code = LANG_CODE_MAP[targetLanguage] || targetLanguage;
    }

    const lessons = await this.lessonsService.findAll(code, level);

    // Return summary (no questions) for list view
    return lessons.map((l) => ({
      id: l.id,
      targetLanguage: l.targetLanguage,
      title: l.title,
      description: l.description,
      category: l.category,
      difficulty: l.difficulty,
      level: l.level,
      order: l.order,
      duration: l.duration,
      xpReward: l.xpReward,
    }));
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const lesson = await this.lessonsService.findOne(id);
    if (!lesson) {
      return { error: 'Lesson not found', id };
    }
    return lesson;
  }
}
