import { BadRequestException, ConflictException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { Connection, Model, Types } from 'mongoose';
import type { ClientSession } from 'mongoose';
import { Flashcard } from './schemas/flashcard.schema';
import { FlashcardOperation } from './schemas/flashcard-operation.schema';

@Injectable()
export class FlashcardIdempotencyService implements OnModuleInit {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(FlashcardOperation.name) private readonly operations: Model<FlashcardOperation>,
    @InjectModel(Flashcard.name) private readonly cards: Model<Flashcard>,
  ) {}

  async onModuleInit() {
    // Explicitly ensure the deduplication constraint even when autoIndex is off.
    await this.operations.createIndexes();
  }

  async execute(
    userId: string, operationId: string | undefined, operationType: string,
    input: Record<string, unknown>, work: (session?: ClientSession) => Promise<any>,
  ) {
    // Existing online callers remain compatible; queued callers always supply a key.
    if (operationId === undefined) return work();
    if (typeof operationId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(operationId)) {
      throw new BadRequestException('Invalid X-Idempotency-Key');
    }
    // These DTOs contain only scalar fields. Bind the receipt to the resource
    // and payload too, so accidental key reuse cannot replay a different request.
    const requestHash = createHash('sha256').update(JSON.stringify(
      Object.fromEntries(Object.entries(input).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)),
    )).digest('hex');
    const identity = { userId, operationId, operationType };
    const replay = async (receipt: FlashcardOperation) => {
      if (receipt.requestHash !== requestHash) {
        throw new ConflictException('Idempotency key was used for a different request');
      }
      const card = await this.cards.findById(receipt.resourceId).exec();
      if (card && card.userId.toString() !== userId) {
        throw new ForbiddenException('Access denied: Flashcard owner changed');
      }
      if (operationType === 'delete-flashcard') {
        return { message: 'Flashcard deleted successfully' };
      }
      // Return current state rather than letting an old update overwrite newer
      // edits. A later-deleted card still acknowledges its committed operation.
      return card ?? { _id: receipt.resourceId.toString() };
    };

    // A completed retry needs no transaction and never invokes business logic.
    const completed = await this.operations.findOne(identity).exec();
    if (completed) return replay(completed);

    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const receipt = await this.operations.findOne(identity).session(session).exec();
        if (receipt) {
          // Resolve the result after committing this read-only transaction.
          return { receipt };
        }
        // Claim the unique key before business logic (including external AI).
        // This uncommitted receipt disappears if any later step aborts.
        const [claimed] = await this.operations.create([{
          ...identity, requestHash,
          resourceId: operationType === 'create-flashcard' ? new Types.ObjectId().toString() : String(input.id),
        }], { session });
        const result = await work(session);
        if (operationType === 'create-flashcard') {
          await this.operations.updateOne({ _id: claimed._id },
            { $set: { resourceId: result._id } }, { session }).exec();
        }
        return { result };
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } })
        .then(outcome => outcome!.receipt ? replay(outcome!.receipt) : outcome!.result);
    } catch (error) {
      // Concurrent requests can race on the unique receipt index. The loser's
      // entire mutation rolls back; only the committed winner may be replayed.
      if (error?.code === 11000) {
        const winner = await this.operations.findOne(identity).exec();
        if (winner) return replay(winner);
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }
}
