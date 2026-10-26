import { MutationTimeline } from '../operations/mutation-timeline';
import { targetLanguageCode } from '../common/target-language';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly timeline: MutationTimeline,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.userModel.findOne({ email }).exec();
  }

  async create(
    name: string,
    email: string,
    passwordHash: string,
    isGuest = false,
  ): Promise<User> {
    return this.timeline.transaction('account-create', (session) => {
      // A transaction retry needs a new document: aborted saves change isNew.
      const user = new this.userModel({
        name,
        email,
        passwordHash,
        isGuest,
        level: 'Beginner',
        totalXp: 0,
        streak: 0,
        targetLanguage: 'en',
      });
      return user.save({ session });
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.userModel.findById(id).exec();
  }

  async updateProfile(
    userId: string,
    name?: string,
    targetLanguage?: string,
  ): Promise<User | null> {
    return this.timeline.transaction('profile', async (session) => {
      const user = await this.userModel
        .findById(userId)
        .session(session)
        .exec();
      if (!user) return null;
      if (name !== undefined) user.name = name;
      if (targetLanguage !== undefined)
        user.targetLanguage = targetLanguageCode(targetLanguage);
      return user.save({ session });
    });
  }
}
