import { BadRequestException, ConflictException, Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection, InjectModel, MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Module } from '@nestjs/common';
import { ClientSession, Connection, Document, Model, Schema as MongoSchema } from 'mongoose';
import { createHash } from 'node:crypto';

// NEVER_EXPIRE: deleted resources and cleared histories cannot prove safe replay.
@Schema({ timestamps: true })
export class MutationReceipt extends Document {
  @Prop({ required: true }) userId: string;
  @Prop({ required: true }) operationType: string;
  @Prop({ required: true }) operationId: string;
  @Prop({ required: true }) requestHash: string;
  @Prop({ type: MongoSchema.Types.Mixed }) result: any;
}
export const MutationReceiptSchema = SchemaFactory.createForClass(MutationReceipt);
MutationReceiptSchema.index({ userId: 1, operationType: 1, operationId: 1 }, { unique: true });

@Injectable()
export class MutationReceipts implements OnModuleInit {
  constructor(@InjectConnection() private readonly connection: Connection,
    @InjectModel(MutationReceipt.name) private readonly receipts: Model<MutationReceipt>) {}
  async onModuleInit() { await this.receipts.createIndexes(); }

  async execute(userId: string, operationId: string | undefined, operationType: string,
    input: Record<string, unknown>, work: (session: ClientSession) => Promise<any>) {
    try { return await this.executeTransaction(userId, operationId, operationType, input, work); }
    catch (error) {
      if (error?.getStatus) throw error;
      throw new ServiceUnavailableException({ code: 'RETRYABLE_SERVER_FAILURE', message: 'Mutation could not be acknowledged. Retry the same operation.' });
    }
  }

  private async executeTransaction(userId: string, operationId: string | undefined, operationType: string,
    input: Record<string, unknown>, work: (session: ClientSession) => Promise<any>) {
    if (typeof operationId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(operationId))
      throw new BadRequestException({ code: 'INVALID_OPERATION_ID', message: 'A valid X-Idempotency-Key is required' });
    const requestHash = createHash('sha256').update(JSON.stringify(
      Object.fromEntries(Object.entries(input).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)))).digest('hex');
    const identity = { userId, operationType, operationId };
    const replay = (receipt: MutationReceipt) => {
      if (receipt.requestHash !== requestHash) throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', message: 'Operation key payload changed' });
      return receipt.result;
    };
    const completed = await this.receipts.findOne(identity).exec();
    if (completed) return replay(completed);
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const existing = await this.receipts.findOne(identity).session(session).exec();
        if (existing) return replay(existing);
        const [claim] = await this.receipts.create([{ ...identity, requestHash }], { session });
        const result = await work(session);
        // Store a detached JSON result, including IDs/dates, as durable replay evidence.
        const durableResult = JSON.parse(JSON.stringify(result));
        await this.receipts.updateOne({ _id: claim._id }, { $set: { result: durableResult } }, { session }).exec();
        return durableResult;
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } catch (error) {
      if (error?.code === 11000) {
        const winner = await this.receipts.findOne(identity).exec();
        if (winner) return replay(winner);
      }
      throw error;
    } finally { await session.endSession(); }
  }
}

@Module({ imports: [MongooseModule.forFeature([{ name: MutationReceipt.name, schema: MutationReceiptSchema }])],
  providers: [MutationReceipts], exports: [MutationReceipts] })
export class MutationReceiptModule {}
