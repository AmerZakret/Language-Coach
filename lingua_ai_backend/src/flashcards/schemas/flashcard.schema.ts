import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Flashcard extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId: string;

  @Prop({ required: true })
  targetWord: string;

  @Prop({ required: true })
  turkishTranslation: string;

  @Prop({ required: false })
  exampleSentence?: string;

  @Prop({ required: false })
  note?: string;

  @Prop({ default: 0 })
  interval: number;

  @Prop({ default: 2.5 })
  easinessFactor: number;

  @Prop({ default: Date.now })
  nextReviewDate: Date;

  @Prop({ default: 0 })
  reviewCount: number;

  @Prop({ type: [{ date: Date, score: Number }] })
  history: { date: Date; score: number }[];

  @Prop({ type: Object, required: false })
  aiContext?: {
    sentences: string[];
    mnemonic: string;
  };
}

export const FlashcardSchema = SchemaFactory.createForClass(Flashcard);
FlashcardSchema.index({ userId: 1, targetWord: 1 }, { unique: true });
