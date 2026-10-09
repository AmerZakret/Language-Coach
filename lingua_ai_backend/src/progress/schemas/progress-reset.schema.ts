import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongoSchema } from 'mongoose';

// Durable receipts must outlive offline retries. No TTL.
@Schema({ timestamps: true })
export class ProgressReset extends Document {
  @Prop({ type: MongoSchema.Types.ObjectId, required: true })
  userId: string;

  @Prop({ required: true })
  operationId: string;

  @Prop({ required: true })
  expectedEpoch: number;

  @Prop({ required: true })
  progressEpoch: number;
}

export const ProgressResetSchema = SchemaFactory.createForClass(ProgressReset);
ProgressResetSchema.index({ userId: 1, operationId: 1 }, { unique: true });
