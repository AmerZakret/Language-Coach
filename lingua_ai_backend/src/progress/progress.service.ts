import { targetLanguageCode, targetLanguageQuery, tryTargetLanguage } from '../common/target-language';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { Progress } from './schemas/progress.schema';
import { User } from '../users/schemas/user.schema';
import { Lesson } from '../lessons/schemas/lesson.schema';

@Injectable()
export class ProgressService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Progress.name) private progressModel: Model<Progress>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Lesson.name) private lessonModel: Model<Lesson>,
  ) {}

  /**
   * Resolve only the MongoDB identity supplied by an authenticated controller.
   */
  private async findUser(userId: string, session: ClientSession | null = null): Promise<User> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('Authenticated user not found');
    }
    const user = await this.userModel.findById(userId).session(session).exec();
    if (!user) throw new NotFoundException('Authenticated user not found');
    return user;
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

    const filter: Record<string, any> = { userId: user._id.toString() };
    if (targetLanguage !== undefined) {
      const language = targetLanguageQuery(targetLanguage);
      const legacyLessons = await this.lessonModel.find({ targetLanguage: language }).session(session).select('id').lean();
      filter.$or = [{ targetLanguage: language },
        { targetLanguage: { $exists: false }, lessonId: { $in: legacyLessons.map(lesson => lesson.id) } }];
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
    if (targetLanguage !== undefined) {
      const code = targetLanguageCode(targetLanguage);
      totalXp = this.languageXp(user, code);
      level = user.levelPerLanguage?.get(code)
        ?? [...(user.levelPerLanguage ?? [])].find(([key]) => tryTargetLanguage(key) === code)?.[1]
        ?? 'Beginner';
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
        const lesson = await this.lessonModel.findOne({ id: lessonId }).session(session);
        if (!lesson) throw new NotFoundException(`Lesson with ID ${lessonId} not found`);
        const lang = targetLanguageCode(lesson.targetLanguage);
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
          const xp = this.languageXp(user, lang);
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
          xpEarned, newTotalXp: this.languageXp(user, lang),
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

  private languageXp(user: User, code: string): number {
    return [...(user.xpPerLanguage ?? [])].reduce((total, [key, xp]) =>
      total + (tryTargetLanguage(key) === code ? xp : 0), 0);
  }

  async resetProgress(userId: string) {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const user = await this.findUser(userId, session);
        await this.progressModel.deleteMany({ userId: user._id.toString() }).session(session);
        await this.userModel.updateOne({ _id: user._id }, { $set: {
          totalXp: 0, streak: 0, level: 'Beginner', xpPerLanguage: {}, levelPerLanguage: {},
        } }, { session });
        return { message: 'Progress successfully reset', userId: user.email };
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } finally { await session.endSession(); }
  }
}
