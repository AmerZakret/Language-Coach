import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { Progress } from './schemas/progress.schema';
import { User } from '../users/schemas/user.schema';
import { Lesson } from '../lessons/schemas/lesson.schema';

@Injectable()
export class ProgressService implements OnModuleInit {
  constructor(
    @InjectConnection() private readonly connection: Connection,
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
  private async findUser(userId: string, session: ClientSession | null = null): Promise<User | null> {
    const isObjectId = Types.ObjectId.isValid(userId);
    return this.userModel.findOne({
      $or: [
        { email: userId },
        ...(isObjectId ? [{ _id: new Types.ObjectId(userId) }] : []),
      ],
    }).session(session).exec();
  }

  /**
   * Fetches user statistics and progress scoped by target language:
   * 1. Returns total XP, current level, and streak info.
   * 2. Returns an array of completed lesson IDs.
   */
  async getUserProgress(userId: string, targetLanguage?: string) {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(() => this.getProgressSnapshot(userId, targetLanguage, session),
        { readConcern: { level: 'snapshot' } });
    } finally { await session.endSession(); }
  }

  private async getProgressSnapshot(userId: string, targetLanguage: string | undefined, session: ClientSession) {
    const user = await this.findUser(userId, session);
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
      .session(session)
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
    // The completion's unique key and the XP award commit together. MongoDB
    // retries write conflicts, including simultaneous different lessons.
    const session = await this.connection.startSession();
    try {
      const run = () => session.withTransaction(async () => {
        let user = await this.findUser(userId, session);
        if (!user) {
          if (!userId.includes('@') && userId !== 'guest') {
            throw new NotFoundException(`User with ID ${userId} not found`);
          }
          [user] = await this.userModel.create([{
            name: userId.split('@')[0].toUpperCase(), email: userId,
            passwordHash: 'placeholder-hash',
          }], { session });
        }
        const lesson = await this.lessonModel.findOne({ id: lessonId }).session(session);
        if (!lesson) throw new NotFoundException(`Lesson with ID ${lessonId} not found`);
        const names: Record<string, string> = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ar: 'Arabic' };
        const lang = names[lesson.targetLanguage] || lesson.targetLanguage || 'English';
        const existing = await this.progressModel.findOne({ userId: user._id.toString(), lessonId }).session(session);
        let xpEarned = 0;
        if (!existing) {
          await this.progressModel.create([{
            userId: user._id.toString(), lessonId, score, status: 'completed', targetLanguage: lang,
          }], { session });
          xpEarned = lesson.xpReward;
          if (!user.xpPerLanguage || !user.levelPerLanguage) {
            await this.userModel.updateOne({ _id: user._id }, { $set: {
              ...(!user.xpPerLanguage ? { xpPerLanguage: {} } : {}),
              ...(!user.levelPerLanguage ? { levelPerLanguage: {} } : {}),
            } }, { session });
          }
          user = (await this.userModel.findOneAndUpdate({ _id: user._id }, {
            $inc: { totalXp: xpEarned, [`xpPerLanguage.${lang}`]: xpEarned },
          }, { returnDocument: 'after', session }))!;
          const xp = user.xpPerLanguage.get(lang) || 0;
          const level = xp >= 2200 ? 'Advanced' : xp >= 1400 ? 'Upper-Intermediate'
            : xp >= 900 ? 'Intermediate' : xp >= 500 ? 'Pre-Intermediate'
            : xp >= 200 ? 'Elementary' : 'Beginner';
          await this.userModel.updateOne({ _id: user._id }, {
            $set: { level, [`levelPerLanguage.${lang}`]: level },
          }, { session });
        } else if (score > existing.score) {
          await this.progressModel.updateOne({ _id: existing._id }, { $max: { score } }, { session });
        }
        return { message: 'Lesson marked as completed', data: {
          userId: user.email, lessonId, score: Math.max(score, existing?.score ?? score),
          xpEarned, newTotalXp: user.xpPerLanguage?.get(lang) || 0,
        } };
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
      try { return await run(); }
      catch (error) {
        // Two first attempts may race on the unique completion index. Read the
        // winner in a fresh transaction; this path never awards its XP again.
        if (error?.code !== 11000) throw error;
        return await run();
      }
    } finally { await session.endSession(); }
  }

  async resetProgress(userId: string) {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const user = await this.findUser(userId, session);
        if (!user) throw new NotFoundException(`User with ID/Email ${userId} not found`);
        await this.progressModel.deleteMany({ userId: user._id.toString() }).session(session);
        await this.userModel.updateOne({ _id: user._id }, { $set: {
          totalXp: 0, streak: 0, level: 'Beginner', xpPerLanguage: {}, levelPerLanguage: {},
        } }, { session });
        return { message: 'Progress successfully reset', userId: user.email };
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } finally { await session.endSession(); }
  }
}
