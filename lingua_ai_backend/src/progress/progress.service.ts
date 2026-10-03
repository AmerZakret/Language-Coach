import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Progress } from './schemas/progress.schema';
import { User } from '../users/schemas/user.schema';
import { Lesson } from '../lessons/schemas/lesson.schema';

@Injectable()
export class ProgressService implements OnModuleInit {
  constructor(
    @InjectModel(Progress.name) private progressModel: Model<Progress>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Lesson.name) private lessonModel: Model<Lesson>,
  ) {}

  /**
   * NestJS Lifecycle Hook:
   * Triggers automatically when the module is fully initialized.
   * Runs the database data migration helper.
   */
  async onModuleInit() {
    await this.migrateLegacyProgress();
  }

  /**
   * Database Migration Helper:
   * Older database schemas saved targetLanguage using short codes ('en', 'de').
   * This migration script scans progress records missing standard fields and resolves them to full names (e.g. 'English').
   */
  private async migrateLegacyProgress() {
    try {
      const legacyProgressList = await this.progressModel.find({ targetLanguage: { $exists: false } }).exec();
      if (legacyProgressList.length === 0) return;

      const shortToFull: Record<string, string> = {
        en: 'English',
        de: 'German',
        es: 'Spanish',
        fr: 'French',
        ar: 'Arabic',
        English: 'English',
        German: 'German',
        Spanish: 'Spanish',
        French: 'French',
        Arabic: 'Arabic',
      };

      for (const p of legacyProgressList) {
        const lesson = await this.lessonModel.findOne({ id: p.lessonId }).exec();
        p.targetLanguage = lesson ? (shortToFull[lesson.targetLanguage] || lesson.targetLanguage) : 'English';
        await p.save();
      }
      console.log(`Migrated ${legacyProgressList.length} legacy progress records.`);
    } catch (e) {
      console.error('Failed to migrate legacy progress records', e);
    }
  }

  /**
   * Helper function to find a user profile in MongoDB by email or ObjectId.
   */
  private async findUser(userId: string): Promise<User | null> {
    const isObjectId = Types.ObjectId.isValid(userId);
    return this.userModel.findOne({
      $or: [
        { email: userId },
        ...(isObjectId ? [{ _id: new Types.ObjectId(userId) }] : []),
      ],
    }).exec();
  }

  /**
   * Fetches user statistics and progress scoped by target language:
   * 1. Returns total XP, current level, and streak info.
   * 2. Returns an array of completed lesson IDs.
   */
  async getUserProgress(userId: string, targetLanguage?: string) {
    const user = await this.findUser(userId);
    if (!user) {
      // Return default empty state instead of crashing if user is not yet created
      return {
        userId,
        stats: {
          totalXp: 0,
          streak: 0,
          completedLessonsCount: 0,
        },
        completedLessons: [],
        level: 'Beginner',
      };
    }

    const filter: Record<string, any> = { userId: user._id.toString() };
    if (targetLanguage) {
      const shortToFull: Record<string, string> = {
        en: 'English',
        de: 'German',
        es: 'Spanish',
        fr: 'French',
        ar: 'Arabic',
        English: 'English',
        German: 'German',
        Spanish: 'Spanish',
        French: 'French',
        Arabic: 'Arabic',
      };
      const lang = shortToFull[targetLanguage] || targetLanguage;
      filter.targetLanguage = lang; // Filter completed records by target language
    }

    const completedProgressList = await this.progressModel
      .find(filter)
      .exec();

    const completedLessons = completedProgressList.map((p) => ({
      lessonId: p.lessonId,
      score: p.score,
      completedAt: (p as any).createdAt || new Date().toISOString(),
    }));

    // Extract language-scoped XP and Levels from User schemas maps
    let totalXp = user.totalXp;
    let level = user.level || 'Beginner';
    if (targetLanguage) {
      const shortToFull: Record<string, string> = {
        en: 'English',
        de: 'German',
        es: 'Spanish',
        fr: 'French',
        ar: 'Arabic',
        English: 'English',
        German: 'German',
        Spanish: 'Spanish',
        French: 'French',
        Arabic: 'Arabic',
      };
      const lang = shortToFull[targetLanguage] || targetLanguage;
      if (user.xpPerLanguage) {
        totalXp = user.xpPerLanguage.get(lang) || 0;
      } else {
        totalXp = 0;
      }
      if (user.levelPerLanguage) {
        level = user.levelPerLanguage.get(lang) || 'Beginner';
      } else {
        level = 'Beginner';
      }
    }

    return {
      userId: user.email,
      stats: {
        totalXp,
        streak: user.streak,
        completedLessonsCount: completedLessons.length,
      },
      completedLessons,
      level,
    };
  }

  /**
   * Completes a Lesson:
   * 1. Validates the existence of the User and Lesson.
   * 2. Resolves language names.
   * 3. Checks if the user already completed this lesson to prevent double-crediting XP.
   * 4. Updates MongoDB, calculates CEFR level boundaries based on total XP, and saves.
   */
  async completeLesson(userId: string, lessonId: string, score: number) {
    let user = await this.findUser(userId);
    if (!user) {
      if (userId.includes('@') || userId === 'guest') {
        user = await this.userModel.create({
          name: userId.split('@')[0].toUpperCase(),
          email: userId,
          passwordHash: 'placeholder-hash',
          totalXp: 0,
          streak: 0,
          level: 'Beginner',
          xpPerLanguage: {},
          levelPerLanguage: {},
        });
      } else {
        throw new NotFoundException(`User with ID ${userId} not found`);
      }
    }

    const lesson = await this.lessonModel.findOne({ id: lessonId }).exec();
    if (!lesson) {
      throw new NotFoundException(`Lesson with ID ${lessonId} not found`);
    }

    const shortToFull: Record<string, string> = {
      en: 'English',
      de: 'German',
      es: 'Spanish',
      fr: 'French',
      ar: 'Arabic',
      English: 'English',
      German: 'German',
      Spanish: 'Spanish',
      French: 'French',
      Arabic: 'Arabic',
    };
    const lang = shortToFull[lesson.targetLanguage] || lesson.targetLanguage || 'English';

    // Query composite unique index to prevent duplicate completion logs
    let progress = await this.progressModel
      .findOne({ userId: user._id.toString(), lessonId })
      .exec();

    let newXpEarned = 0;
    if (!progress) {
      // Create fresh progress log
      progress = await this.progressModel.create({
        userId: user._id.toString(),
        lessonId,
        score,
        status: 'completed',
        targetLanguage: lang,
      });

      newXpEarned = lesson.xpReward;

      // Initialize language maps if null
      if (!user.xpPerLanguage) {
        user.xpPerLanguage = new Map();
      }
      if (!user.levelPerLanguage) {
        user.levelPerLanguage = new Map();
      }

      // Add XP and recalculate language levels thresholds
      const currentLangXp = user.xpPerLanguage.get(lang) || 0;
      const newLangXp = currentLangXp + newXpEarned;
      user.xpPerLanguage.set(lang, newLangXp);

      let level = 'Beginner';
      if (newLangXp >= 2200) level = 'Advanced';
      else if (newLangXp >= 1400) level = 'Upper-Intermediate';
      else if (newLangXp >= 900) level = 'Intermediate';
      else if (newLangXp >= 500) level = 'Pre-Intermediate';
      else if (newLangXp >= 200) level = 'Elementary';
      user.levelPerLanguage.set(lang, level);

      // Save global user progress variables
      user.totalXp += newXpEarned;
      user.level = level;

      // Mark map modifications so Mongoose knows it needs to serialize updates
      user.markModified('xpPerLanguage');
      user.markModified('levelPerLanguage');
      await user.save();
    } else {
      // If already completed, overwrite only if the new quiz score is higher
      if (score > progress.score) {
        progress.score = score;
        await progress.save();
      }
    }

    const langXp = user.xpPerLanguage ? (user.xpPerLanguage.get(lang) || 0) : user.totalXp;

    return {
      message: 'Lesson marked as completed',
      data: {
        userId: user.email,
        lessonId,
        score,
        xpEarned: newXpEarned,
        newTotalXp: langXp,
      },
    };
  }

  /**
   * Reset User Progress:
   * Deletes all progress documents and wipes XP/level maps on the User profile.
   */
  async resetProgress(userId: string) {
    const user = await this.findUser(userId);
    if (!user) {
      throw new NotFoundException(`User with ID/Email ${userId} not found`);
    }

    // Clear progress collection references
    await this.progressModel.deleteMany({ userId: user._id.toString() }).exec();

    // Reset XP metrics
    user.totalXp = 0;
    user.streak = 0;
    user.level = 'Beginner';
    user.xpPerLanguage = new Map();
    user.levelPerLanguage = new Map();
    
    user.markModified('xpPerLanguage');
    user.markModified('levelPerLanguage');
    await user.save();

    return {
      message: 'Progress successfully reset',
      userId: user.email,
    };
  }
}
