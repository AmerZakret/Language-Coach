import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.userModel.findOne({ email }).exec();
  }

  async create(name: string, email: string, passwordHash: string): Promise<User> {
    const user = new this.userModel({
      name,
      email,
      passwordHash,
      level: 'Beginner',
      totalXp: 0,
      streak: 0,
      targetLanguage: 'English',
    });
    return user.save();
  }

  async findById(id: string): Promise<User | null> {
    return this.userModel.findById(id).exec();
  }

  async updateProfile(userId: string, name?: string, targetLanguage?: string): Promise<User | null> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) return null;
    if (name !== undefined) user.name = name;
    if (targetLanguage !== undefined) user.targetLanguage = targetLanguage;
    return user.save();
  }
}
