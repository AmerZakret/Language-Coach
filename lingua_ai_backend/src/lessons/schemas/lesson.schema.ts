import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
class Question {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  question: string;

  @Prop({ type: [String], required: true })
  options: string[];

  @Prop({ required: true })
  correctAnswer: string;

  @Prop({ required: true })
  type: string;
}

@Schema({ timestamps: true })
export class Lesson extends Document {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  targetLanguage: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  category: string;

  @Prop({ required: true })
  difficulty: string;

  @Prop({ required: true })
  level: string;

  @Prop({ required: true })
  order: number;

  @Prop({ required: true })
  duration: number;

  @Prop({ required: true })
  xpReward: number;

  @Prop({ type: [Question], default: [] })
  questions: Question[];
}

export const LessonSchema = SchemaFactory.createForClass(Lesson);
