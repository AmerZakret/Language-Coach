import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

// Only committed mutations have receipts. Never expire them: a durable client
// queue can retry an old operation at any time.
@Schema({ timestamps: true })
export class FlashcardOperation extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId: string;

  @Prop({ required: true })
  operationId: string;

  @Prop({ required: true })
  operationType: string;

  @Prop({ required: true })
  requestHash: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  resourceId: string;
}

export const FlashcardOperationSchema = SchemaFactory.createForClass(FlashcardOperation);
FlashcardOperationSchema.index(
  { userId: 1, operationId: 1, operationType: 1 }, { unique: true },
);
