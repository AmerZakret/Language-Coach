import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Lesson } from './schemas/lesson.schema';
import { allLessons } from './data';

@Injectable()
export class LessonsService implements OnModuleInit {
  private readonly logger = new Logger(LessonsService.name);

  constructor(
    @InjectModel(Lesson.name) private readonly lessonModel: Model<Lesson>,
  ) {}

  async onModuleInit() {
    await this.seedLessons();
  }

  private async seedLessons() {
    try {
      const count = await this.lessonModel.countDocuments();
      if (count > 0) {
        this.logger.log(
          `Database already has ${count} lessons. Skipping seed.`,
        );
        return;
      }

      this.logger.log('Seeding lessons to MongoDB...');
      await this.lessonModel.insertMany(allLessons);
      this.logger.log(`Successfully seeded ${allLessons.length} lessons.`);
    } catch (error) {
      this.logger.error('Failed to seed lessons', error);
    }
  }

  async findAll(targetLanguage?: string, level?: string): Promise<Lesson[]> {
    const filter: Record<string, any> = {};
    if (targetLanguage) filter.targetLanguage = targetLanguage;
    if (level) filter.level = level;

    // Define level weights for proper sorting
    const levelWeights: Record<string, number> = {
      Beginner: 1,
      Elementary: 2,
      'Pre-Intermediate': 3,
    };

    const lessons = await this.lessonModel.find(filter).lean();

    // Sort in memory to correctly use custom level weights + order
    return lessons.sort((a, b) => {
      const weightA = levelWeights[a.level] || 99;
      const weightB = levelWeights[b.level] || 99;

      if (weightA !== weightB) {
        return weightA - weightB;
      }
      return (a.order || 0) - (b.order || 0);
    });
  }

  async findOne(id: string): Promise<Lesson | null> {
    const lesson = await this.lessonModel.findOne({ id }).lean();
    if (lesson) return lesson;

    // Fallback for legacy numeric IDs
    const index = parseInt(id, 10) - 1;
    if (!isNaN(index)) {
      const enLessons = await this.findAll('en');
      if (index >= 0 && index < enLessons.length) {
        return enLessons[index];
      }
    }

    return null;
  }
}
