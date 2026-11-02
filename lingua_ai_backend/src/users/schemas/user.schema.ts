import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class User extends Document {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ default: false })
  isGuest: boolean;

  @Prop({ default: 'Beginner' })
  level: string;

  @Prop({ default: 0 })
  totalXp: number;

  @Prop({ default: 0, min: 0 })
  progressEpoch: number;

  // Serializes score-only/duplicate completion checks with an owner reset.
  @Prop({ default: 0 })
  progressWriteRevision: number;

  @Prop({ default: 0 })
  streak: number;

  @Prop({ default: 'en' })
  targetLanguage: string;

  @Prop({ type: Map, of: Number, default: {} })
  xpPerLanguage: Map<string, number>;

  @Prop({ type: Map, of: String, default: {} })
  levelPerLanguage: Map<string, string>;
}

export const UserSchema = SchemaFactory.createForClass(User);
