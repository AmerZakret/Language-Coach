import { MutationTimeline } from '../operations/mutation-timeline';
import { observedTransaction } from '../operations/observed-transaction';
import { receiptEvent } from '../operations/telemetry';
import { targetLanguageCode, targetLanguageQuery, tryTargetLanguage } from '../common/target-language';
import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types, mongo } from 'mongoose';
import { Progress } from './schemas/progress.schema';
import { User } from '../users/schemas/user.schema';
import { Lesson } from '../lessons/schemas/lesson.schema';
import { ProgressReset } from './schemas/progress-reset.schema';
import { deriveLevel, validXp } from '../common/xp-level';
import { initializeDevelopmentIndexes } from '../operations/schema-startup';

@Injectable()
export class ProgressService implements OnModuleInit {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Progress.name) private progressModel: Model<Progress>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Lesson.name) private lessonModel: Model<Lesson>,
    @InjectModel(ProgressReset.name) private resetModel: Model<ProgressReset>,
    private readonly timeline: MutationTimeline,
  ) {}

  async onModuleInit() { await initializeDevelopmentIndexes(this.resetModel); }

  private assertEpoch(expected: number, current: number, reset = false) {
    if (!Number.isSafeInteger(expected) || expected < 0) {
      throw new BadRequestException({
        code:
          expected === undefined
            ? 'MISSING_PROGRESS_EPOCH'
            : 'INVALID_PROGRESS_EPOCH',
        message: 'A valid progress epoch is required',
      });
    }
    if (expected !== current)
      throw new ConflictException({
        code: reset
          ? expected < current
            ? 'STALE_RESET_EPOCH'
            : 'FUTURE_RESET_EPOCH'
          : expected < current
            ? 'STALE_PROGRESS_EPOCH'
            : 'FUTURE_PROGRESS_EPOCH',
        message:
          expected < current
            ? 'Progress was reset; this work is obsolete'
            : 'Progress epoch is ahead of the server',
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
      return await observedTransaction(session, 'progress', () => this.getProgressSnapshot(userId, targetLanguage, session),
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
  async completeLesson(
    userId: string,
    lessonId: string,
    score: number,
    progressEpoch: number,
  ) {
    // The completion's unique key and the XP award commit together. MongoDB
    // retries write conflicts, including simultaneous different lessons.
    const scope = await this.timeline.admission();
    const run = () =>
      this.timeline.transaction(
        'progress',
        async (session) => {
          let user = await this.findUser(userId, session);
          this.assertEpoch(progressEpoch, user.progressEpoch ?? 0);
          const lesson = await this.lessonModel
            .findOne({ id: lessonId })
            .session(session)
            .lean();
          if (!lesson)
            throw new NotFoundException(`Lesson with ID ${lessonId} not found`);
          const lang = targetLanguageCode(lesson.targetLanguage);
          const existing = await this.progressModel
            .findOne({ userId: user._id.toString(), lessonId })
            .session(session);
          let xpEarned = 0;
          if (!existing) {
            xpEarned = validXp(lesson.xpReward);
            // Check existing authoritative totals and overflow before any award.
            validXp(validXp(user.totalXp) + xpEarned);
            validXp(this.languageXp(user, lang) + xpEarned);
            await this.progressModel.create(
              [
                {
                  userId: user._id.toString(),
                  lessonId,
                  score,
                  status: 'completed',
                  targetLanguage: lang,
                  awardedXp: xpEarned,
                  progressEpoch,
                },
              ],
              { session },
            );
            if (!user.xpPerLanguage || !user.levelPerLanguage) {
              await this.userModel.updateOne(
                { _id: user._id },
                {
                  $set: {
                    ...(!user.xpPerLanguage ? { xpPerLanguage: {} } : {}),
                    ...(!user.levelPerLanguage ? { levelPerLanguage: {} } : {}),
                  },
                },
                { session },
              );
            }
            user = (await this.userModel.findOneAndUpdate(
              { _id: user._id },
              {
                $inc: {
                  totalXp: xpEarned,
                  [`xpPerLanguage.${lang}`]: xpEarned,
                },
              },
              { returnDocument: 'after', session },
            ))!;
            const xp = this.languageXp(user, lang);
            await this.userModel.updateOne(
              { _id: user._id },
              {
                $set: {
                  level: deriveLevel(user.totalXp),
                  [`levelPerLanguage.${lang}`]: deriveLevel(xp),
                },
              },
              { session },
            );
          } else if (score > existing.score) {
            await this.progressModel.updateOne(
              { _id: existing._id },
              { $max: { score } },
              { session },
            );
          }
          // Even duplicate/score-only completions must contend on the owner with
          // reset. A read-only epoch check could otherwise commit after a reset.
          await this.userModel.updateOne(
            { _id: user._id },
            { $inc: { progressWriteRevision: 1 } },
            { session },
          );
          return {
            message: 'Lesson marked as completed',
            data: {
              userId: user._id.toString(),
              lessonId,
              score: Math.max(score, existing?.score ?? score),
              progressEpoch,
              targetLanguage: lang,
              xpEarned,
              newTotalXp: this.languageXp(user, lang),
            },
          };
        },
        scope,
      );
    try {
      return await run();
    } catch (error) {
      // Two first attempts may race on the unique completion index. Read the
      // winner in a fresh transaction; this path never awards its XP again.
      if (error?.code !== 11000) throw error;
      return await run();
    }
  }

  private languageXp(user: User, code: string): number {
    // Keep Phase 5D's additive alias compatibility. Historical overlap cannot
    // be inferred from bucket values, so never merge/dedupe/rewrite those keys.
    // Every new award increments only the canonical bucket, exactly once.
    return [...(user.xpPerLanguage ?? [])].reduce((total, [key, xp]) =>
      tryTargetLanguage(key) === code ? validXp(total + validXp(xp)) : total, 0);
  }

  private validateResetRequest(expectedEpoch: number, operationId: string) {
    if (typeof operationId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(operationId)) {
      throw new BadRequestException({ code: 'INVALID_OPERATION_ID', message: 'A valid X-Idempotency-Key is required' });
    }
    if (!Number.isSafeInteger(expectedEpoch) || expectedEpoch < 0 || expectedEpoch >= Number.MAX_SAFE_INTEGER) {
      throw new BadRequestException({ code: expectedEpoch === undefined ? 'MISSING_PROGRESS_EPOCH' : 'INVALID_PROGRESS_EPOCH', message: 'A valid expected epoch is required' });
    }
  }

  private resetResult(userId: string, expectedEpoch: number, receipt: ProgressReset) {
    if (receipt.expectedEpoch !== expectedEpoch) {
      receiptEvent('receipt.conflict', 'progress_reset', userId, receipt.operationId);
      throw new ConflictException({
      code: 'RESET_IDEMPOTENCY_CONFLICT', message: 'Idempotency key was used for a different request',
      });
    }
    return { message: 'Progress successfully reset', userId, progressEpoch: receipt.progressEpoch,
      operationId: receipt.operationId, expectedEpoch: receipt.expectedEpoch };
  }

  // Read a durable result only. Recovery must never execute a quarantined reset.
  async getResetReceipt(
    userId: string,
    expectedEpoch: number,
    operationId: string,
  ) {
    const scope = await this.timeline.admission();
    return this.timeline.transaction(
      'reset-recovery',
      async (session) => {
        this.validateResetRequest(expectedEpoch, operationId);
        const user = await this.findUser(userId, session);
        const receipt = await this.resetModel
          .findOne({ userId: user._id.toString(), operationId })
          .session(session);
        if (!receipt)
          throw new NotFoundException({
            code: 'RESET_NOT_COMMITTED',
            message: 'No committed reset receipt found',
          });
        this.timeline.assertReceipt(receipt, scope);
        const result = this.resetResult(userId, expectedEpoch, receipt);
        receiptEvent('reset.recovered', 'progress_reset', userId, operationId);
        return result;
      },
      scope,
    );
  }

  async resetProgress(
    userId: string,
    expectedEpoch: number,
    operationId: string,
  ) {
    const scope = await this.timeline.admission();
    this.validateResetRequest(expectedEpoch, operationId);
    const result = (receipt: ProgressReset) => this.resetResult(userId, expectedEpoch, receipt);
    let created = false;
    const run = () =>
      this.timeline.transaction(
        'progress-reset',
        async (session) => {
          created = false;
          const user = await this.findUser(userId, session);
          const receipt = await this.resetModel
            .findOne({ userId: user._id.toString(), operationId })
            .session(session);
          if (receipt) {
            this.timeline.assertReceipt(receipt, scope);
            receiptEvent(
              'receipt.replay',
              'progress_reset',
              userId,
              operationId,
            );
            return result(receipt);
          }
          this.assertEpoch(expectedEpoch, user.progressEpoch ?? 0, true);
          const [saved] = await this.resetModel.create(
            [
              {
                userId: user._id.toString(),
                operationId,
                expectedEpoch,
                progressEpoch: expectedEpoch + 1,
                dataTimelineId: scope.dataTimelineId,
              },
            ],
            { session },
          );
          await this.progressModel
            .deleteMany({ userId: user._id.toString() })
            .session(session);
          await this.userModel.updateOne(
            { _id: user._id },
            {
              $set: {
                totalXp: 0,
                streak: 0,
                level: 'Beginner',
                xpPerLanguage: {},
                levelPerLanguage: {},
                progressEpoch: expectedEpoch + 1,
              },
            },
            { session },
          );
          created = true;
          return result(saved);
        },
        scope,
      );
    let outcome: Awaited<ReturnType<typeof run>>;
    try {
      outcome = await run();
    } catch (error) {
      if (!(error instanceof mongo.MongoServerError) || error.code !== 11000)
        throw error;
      outcome = await run();
    }
    if (created)
      receiptEvent('receipt.created', 'progress_reset', userId, operationId);
    return outcome;
  }
}
