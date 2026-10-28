import { MutationTimeline } from '../operations/mutation-timeline';
import { receiptEvent } from '../operations/telemetry';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { Connection, Model, Types, mongo } from 'mongoose';
import type { ClientSession } from 'mongoose';
import { initializeDevelopmentIndexes } from '../operations/schema-startup';
import { Flashcard } from './schemas/flashcard.schema';
import { FlashcardOperation } from './schemas/flashcard-operation.schema';

@Injectable()
export class FlashcardIdempotencyService implements OnModuleInit {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(FlashcardOperation.name)
    private readonly operations: Model<FlashcardOperation>,
    @InjectModel(Flashcard.name) private readonly cards: Model<Flashcard>,
    private readonly timeline: MutationTimeline,
  ) {}

  async onModuleInit() {
    await initializeDevelopmentIndexes(this.operations);
  }

  async execute<T>(
    userId: string,
    operationId: string | undefined,
    operationType: string,
    input: Record<string, unknown>,
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T | Flashcard | { _id: string } | { message: string }> {
    const scope = await this.timeline.admission();
    if (
      operationId !== undefined &&
      (typeof operationId !== 'string' ||
        !/^[A-Za-z0-9._:-]{1,128}$/.test(operationId))
    )
      throw new BadRequestException('Invalid X-Idempotency-Key');
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify(
          Object.fromEntries(
            Object.entries(input).sort(([a], [b]) =>
              a < b ? -1 : a > b ? 1 : 0,
            ),
          ),
        ),
      )
      .digest('hex');
    const identity = { userId, operationId, operationType };
    const run = () =>
      this.timeline.transaction(
        'flashcard',
        async (session) => {
          if (operationId === undefined) return work(session); // Legacy unkeyed writes are still transactional and fenced.
          const receipt = await this.operations
            .findOne(identity)
            .session(session)
            .exec();
          if (receipt) {
            this.timeline.assertReceipt(receipt, scope);
            if (receipt.requestHash !== requestHash)
              throw new ConflictException(
                'Idempotency key was used for a different request',
              );
            const card = await this.cards
              .findById(receipt.resourceId)
              .session(session)
              .exec();
            if (card && card.userId.toString() !== userId)
              throw new ForbiddenException(
                'Access denied: Flashcard owner changed',
              );
            receiptEvent('receipt.replay', operationType, userId, operationId);
            if (operationType === 'delete-flashcard')
              return { message: 'Flashcard deleted successfully' };
            return card ?? { _id: receipt.resourceId.toString() };
          }
          const [claimed] = await this.operations.create(
            [
              {
                ...identity,
                requestHash,
                dataTimelineId: scope.dataTimelineId,
                resourceId:
                  operationType === 'create-flashcard'
                    ? new Types.ObjectId().toString()
                    : String(input.id),
              },
            ],
            { session },
          );
          const result = await work(session);
          if (operationType === 'create-flashcard') {
            const card = result as { _id: unknown };
            await this.operations
              .updateOne(
                { _id: claimed._id },
                { $set: { resourceId: card._id } },
                { session },
              )
              .exec();
          }
          return result;
        },
        scope,
      );
    try {
      return await run();
    } catch (error) {
      if (error instanceof mongo.MongoServerError && error.code === 11000)
        return run();
      throw error;
    }
  }
}
