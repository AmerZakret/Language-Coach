import { targetLanguageCode, languageResponse } from '../common/target-language';
import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { LessonsService } from './lessons.service';

@Controller('lessons')
export class LessonsController {
  constructor(private readonly lessonsService: LessonsService) {}

  @Get()
  async findAll(
    @Query('targetLanguage') targetLanguage?: string,
    @Query('level') level?: string,
  ) {
    const code = targetLanguage === undefined ? undefined : targetLanguageCode(targetLanguage);

    const lessons = await this.lessonsService.findAll(code, level);

    // Return summary (no questions) for list view
    return lessons.map((l) => ({
      id: l.id,
      targetLanguage: targetLanguageCode(l.targetLanguage),
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
      throw new NotFoundException('Lesson not found');
    }
    return languageResponse(lesson);
  }
}
