import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Module,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  InjectModel,
  MongooseModule,
  Prop,
  Schema,
  SchemaFactory,
} from '@nestjs/mongoose';
import {
  ClientSession,
  Document,
  Model,
  Schema as MongoSchema,
  mongo,
} from 'mongoose';
import { createHash } from 'node:crypto';
import { initializeDevelopmentIndexes } from '../operations/schema-startup';
import { TIMELINE_ID_PATTERN } from '../operations/timeline-contract';
import {
  MutationTimeline,
  MutationTimelineModule,
} from '../operations/mutation-timeline';
import { receiptEvent } from '../operations/telemetry';

// NEVER_EXPIRE: deleted resources and cleared histories cannot prove safe replay.
@Schema({ timestamps: true })
export class MutationReceipt extends Document {
  @Prop({
    type: String,
    immutable: true,
    match: new RegExp(TIMELINE_ID_PATTERN),
  })
  dataTimelineId?: string;

  @Prop({ required: true }) userId: string;
  @Prop({ required: true }) operationType: string;
  @Prop({ required: true }) operationId: string;
  @Prop({ required: true }) requestHash: string;
  @Prop({ type: MongoSchema.Types.Mixed }) result: any;
}
export const MutationReceiptSchema =
  SchemaFactory.createForClass(MutationReceipt);
MutationReceiptSchema.index(
  { userId: 1, operationType: 1, operationId: 1 },
  { unique: true },
);

@Injectable()
export class MutationReceipts implements OnModuleInit {
  constructor(
    @InjectModel(MutationReceipt.name)
    private readonly receipts: Model<MutationReceipt>,
    private readonly timeline: MutationTimeline,
  ) {}
  async onModuleInit() {
    await initializeDevelopmentIndexes(this.receipts);
  }
  async scoped<T>(work: () => Promise<T>): Promise<T> {
    const admission = await this.timeline.admission();
    return this.timeline.run(admission, work);
  }
  async execute<T>(
    userId: string,
    operationId: string | undefined,
    operationType: string,
    input: Record<string, unknown>,
    work: (session: ClientSession) => Promise<T>,
    prepare?: () => Promise<void>,
  ): Promise<T> {
    const scope = await this.timeline.admission();
    if (
      typeof operationId !== 'string' ||
      !/^[A-Za-z0-9._:-]{1,128}$/.test(operationId)
    )
      throw new BadRequestException({
        code: 'INVALID_OPERATION_ID',
        message: 'A valid X-Idempotency-Key is required',
      });
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
    const identity = { userId, operationType, operationId };
    const replay = (existing: MutationReceipt): T => {
      this.timeline.assertReceipt(existing, scope);
      if (existing.requestHash !== requestHash) {
        receiptEvent('receipt.conflict', operationType, userId, operationId);
        throw new ConflictException({
          code: 'IDEMPOTENCY_CONFLICT',
          message: 'Operation key payload changed',
        });
      }
      receiptEvent('receipt.replay', operationType, userId, operationId);
      return existing.result as T;
    };
    let created = false;
    const run = () =>
      this.timeline.transaction(
        operationType,
        async (session) => {
          created = false;
          const existing = await this.receipts
            .findOne(identity)
            .session(session)
            .exec();
          if (existing) return replay(existing);
          const [claim] = await this.receipts.create(
            [
              {
                ...identity,
                requestHash,
                dataTimelineId: scope.dataTimelineId,
              },
            ],
            { session },
          );
          const result = await work(session);
          const durableResult = JSON.parse(JSON.stringify(result)) as T;
          await this.receipts
            .updateOne(
              { _id: claim._id },
              { $set: { result: durableResult } },
              { session },
            )
            .exec();
          created = true;
          return durableResult;
        },
        scope,
      );
    try {
      if (prepare) {
        const probe = await this.timeline.transaction(
          operationType + '-prepare',
          async (session) => {
            const existing = await this.receipts
              .findOne(identity)
              .session(session)
              .exec();
            return existing
              ? { found: true as const, result: replay(existing) }
              : { found: false as const };
          },
          scope,
        );
        if (probe.found) return probe.result;
        await this.timeline.fresh(scope);
        await this.timeline.run(scope, prepare);
      }
      let result: T;
      try {
        result = await run();
      } catch (error) {
        if (!(error instanceof mongo.MongoServerError) || error.code !== 11000)
          throw error;
        result = await run();
      }
      if (created)
        receiptEvent('receipt.created', operationType, userId, operationId);
      return result;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({
        code: 'RETRYABLE_SERVER_FAILURE',
        message:
          'Mutation could not be acknowledged. Retry the same operation.',
      });
    }
  }
}
@Module({
  imports: [
    MutationTimelineModule,
    MongooseModule.forFeature([
      { name: MutationReceipt.name, schema: MutationReceiptSchema },
    ]),
  ],
  providers: [MutationReceipts],
  exports: [MutationReceipts],
})
export class MutationReceiptModule {}
