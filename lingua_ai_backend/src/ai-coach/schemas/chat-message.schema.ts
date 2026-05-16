import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ChatMessageDocument = ChatMessage & Document;

@Schema({ timestamps: true })
export class ChatMessage {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, index: true })
  targetLanguage: string;

  @Prop({ required: true, enum: ['user', 'assistant'] })
  role: 'user' | 'assistant';

  @Prop({ required: true })
  message: string;

  createdAt: Date;
}

export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);

// Add index for faster history retrieval
ChatMessageSchema.index({ userId: 1, targetLanguage: 1, createdAt: -1 });
