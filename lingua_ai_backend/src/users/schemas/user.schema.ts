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

  @Prop({ default: 'Beginner' })
  level: string;

  @Prop({ default: 0 })
  totalXp: number;

  @Prop({ default: 0 })
  streak: number;
}

export const UserSchema = SchemaFactory.createForClass(User);
