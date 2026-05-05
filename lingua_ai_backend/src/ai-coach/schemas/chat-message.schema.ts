import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class ChatMessage extends Document {
  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  userMessage: string;

  @Prop({ required: true })
  assistantResponse: string;

  @Prop({ required: true })
  language: string;
}

export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);
