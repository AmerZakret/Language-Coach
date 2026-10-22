import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
@Schema()
export class ChatBarrier extends Document {
  @Prop({ required: true }) userId: string;
  @Prop({ required: true }) targetLanguage: string;
  @Prop({ default: 0 }) revision: number;
}
export const ChatBarrierSchema = SchemaFactory.createForClass(ChatBarrier);
ChatBarrierSchema.index({ userId: 1, targetLanguage: 1 }, { unique: true });
