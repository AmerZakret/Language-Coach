import { targetLanguageCode, targetLanguageQuery, tryTargetLanguage } from '../common/target-language';
import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { Progress } from './schemas/progress.schema';
import { User } from '../users/schemas/user.schema';
import { Lesson } from '../lessons/schemas/lesson.schema';
import { ProgressReset } from './schemas/progress-reset.schema';
import { deriveLevel, validXp } from '../common/xp-level';

@Injectable()
export class ProgressService implements OnModuleInit {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Progress.name) private progressModel: Model<Progress>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Lesson.name) private lessonModel: Model<Lesson>,
    @InjectModel(ProgressReset.name) private resetModel: Model<ProgressReset>,
  ) {}

  async onModuleInit() { await this.resetModel.createIndexes(); }

  private assertEpoch(expected: number, current: number) {
    if (!Number.isSafeInteger(expected) || expected < 0) {
      throw new BadRequestException('A valid progress epoch is required');
    }
    if (expected !== current) throw new ConflictException({
      code: expected < current ? 'STALE_PROGRESS_EPOCH' : 'FUTURE_PROGRESS_EPOCH',
      message: expected < current ? 'Progress was reset; this work is obsolete' : 'Progress epoch is ahead of the server',
    });
  }

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
      ...(p.awardedXp !== undefined ? { awardedXp: p.awardedXp } : {}),
      ...(p.progressEpoch !== undefined ? { progressEpoch: p.progressEpoch } : {}),
      completedAt: (p as any).createdAt || new Date().toISOString(),
    }));

    // Preserve the existing language-scoped response fields. Unfiltered stats
    // are global; filtered stats/level describe that language. Reads never repair.
    let totalXp = validXp(user.totalXp);
    if (targetLanguage !== undefined) {
      const code = targetLanguageCode(targetLanguage);
      totalXp = this.languageXp(user, code);
    }

    return {
      userId: user._id.toString(),
      progressEpoch: user.progressEpoch ?? 0,
      stats: {
        totalXp,
        streak: user.streak,
        completedLessonsCount: completedLessons.length,
      },
      completedLessons,
      level: deriveLevel(totalXp),
    };
  }

  /**
   * Completes a Lesson:
   * 1. Validates the existence of the User and Lesson.
   * 2. Resolves language names.
   * 3. Checks if the user already completed this lesson to prevent double-crediting XP.
   * 4. Updates MongoDB, calculates CEFR level boundaries based on total XP, and saves.
   */
  async completeLesson(userId: string, lessonId: string, score: number, progressEpoch: number) {
    // The completion's unique key and the XP award commit together. MongoDB
    // retries write conflicts, including simultaneous different lessons.
    const session = await this.connection.startSession();
    try {
      const run = () => session.withTransaction(async () => {
        let user = await this.findUser(userId, session);
        this.assertEpoch(progressEpoch, user.progressEpoch ?? 0);
        const lesson = await this.lessonModel.findOne({ id: lessonId }).session(session).lean();
        if (!lesson) throw new NotFoundException(`Lesson with ID ${lessonId} not found`);
        const lang = targetLanguageCode(lesson.targetLanguage);
        const existing = await this.progressModel.findOne({ userId: user._id.toString(), lessonId }).session(session);
        let xpEarned = 0;
        if (!existing) {
          xpEarned = validXp(lesson.xpReward);
          // Check existing authoritative totals and overflow before any award.
          validXp(validXp(user.totalXp) + xpEarned);
          validXp(this.languageXp(user, lang) + xpEarned);
          await this.progressModel.create([{
            userId: user._id.toString(), lessonId, score, status: 'completed', targetLanguage: lang,
            awardedXp: xpEarned, progressEpoch,
          }], { session });
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
          await this.userModel.updateOne({ _id: user._id }, {
            $set: { level: deriveLevel(user.totalXp), [`levelPerLanguage.${lang}`]: deriveLevel(xp) },
          }, { session });
        } else if (score > existing.score) {
          await this.progressModel.updateOne({ _id: existing._id }, { $max: { score } }, { session });
        }
        // Even duplicate/score-only completions must contend on the owner with
        // reset. A read-only epoch check could otherwise commit after a reset.
        await this.userModel.updateOne({ _id: user._id }, { $inc: { progressWriteRevision: 1 } }, { session });
        return { message: 'Lesson marked as completed', data: {
          userId: user._id.toString(), lessonId, score: Math.max(score, existing?.score ?? score),
          progressEpoch,
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
    // Keep Phase 5D's additive alias compatibility. Historical overlap cannot
    // be inferred from bucket values, so never merge/dedupe/rewrite those keys.
    // Every new award increments only the canonical bucket, exactly once.
    return [...(user.xpPerLanguage ?? [])].reduce((total, [key, xp]) =>
      tryTargetLanguage(key) === code ? validXp(total + validXp(xp)) : total, 0);
  }

  async resetProgress(userId: string, expectedEpoch: number, operationId: string) {
    if (typeof operationId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(operationId)) {
      throw new BadRequestException('A valid X-Idempotency-Key is required');
    }
    if (!Number.isSafeInteger(expectedEpoch) || expectedEpoch < 0 || expectedEpoch >= Number.MAX_SAFE_INTEGER) {
      throw new BadRequestException('A valid expected epoch is required');
    }
    const result = (receipt: ProgressReset) => {
      if (receipt.expectedEpoch !== expectedEpoch) throw new ConflictException('Idempotency key was used for a different request');
      return { message: 'Progress successfully reset', userId, progressEpoch: receipt.progressEpoch };
    };
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const user = await this.findUser(userId, session);
        const receipt = await this.resetModel.findOne({ userId: user._id.toString(), operationId }).session(session);
        if (receipt) return result(receipt);
        this.assertEpoch(expectedEpoch, user.progressEpoch ?? 0);
        const [saved] = await this.resetModel.create([{
          userId: user._id.toString(), operationId, expectedEpoch, progressEpoch: expectedEpoch + 1,
        }], { session });
        await this.progressModel.deleteMany({ userId: user._id.toString() }).session(session);
        await this.userModel.updateOne({ _id: user._id }, { $set: {
          totalXp: 0, streak: 0, level: 'Beginner', xpPerLanguage: {}, levelPerLanguage: {},
          progressEpoch: expectedEpoch + 1,
        } }, { session });
        return result(saved);
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } catch (error) {
      if (error?.code === 11000) {
        const winner = await this.resetModel.findOne({ userId, operationId });
        if (winner) return result(winner);
      }
      throw error;
    } finally { await session.endSession(); }
  }
}
