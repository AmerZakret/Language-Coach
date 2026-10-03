import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class CommunityPost extends Document {
  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  userName: string;

  @Prop({ required: true })
  learningLanguage: string;

  @Prop()
  text?: string;

  @Prop()
  imageUrl?: string;

  @Prop({ type: [String], default: [] })
  likes: string[];

  @Prop({ default: 0 })
  likesCount: number;
}

export const CommunityPostSchema = SchemaFactory.createForClass(CommunityPost);
export type CommunityPostDocument = CommunityPost & Document;
