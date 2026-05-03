import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

@Schema({ timestamps: true })
export class Progress extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Lesson', required: true })
  lessonId: string;

  @Prop({ default: 'completed' })
  status: string;

  @Prop({ required: true })
  score: number;
}

export const ProgressSchema = SchemaFactory.createForClass(Progress);
