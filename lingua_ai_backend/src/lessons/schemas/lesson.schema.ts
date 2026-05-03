import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
class Question {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  text: string;

  @Prop({ type: [String], required: true })
  options: string[];

  @Prop({ required: true })
  correctAnswer: string;
}

@Schema({ timestamps: true })
export class Lesson extends Document {
  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  level: string;

  @Prop({ required: true })
  type: string;

  @Prop({ required: true })
  durationMinutes: number;

  @Prop({ required: true })
  xpReward: number;

  @Prop({ type: [Question], default: [] })
  questions: Question[];
}

export const LessonSchema = SchemaFactory.createForClass(Lesson);
