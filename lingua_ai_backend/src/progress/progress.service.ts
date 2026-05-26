import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Progress } from './schemas/progress.schema';
import { User } from '../users/schemas/user.schema';
import { Lesson } from '../lessons/schemas/lesson.schema';

@Injectable()
export class ProgressService {
  constructor(
    @InjectModel(Progress.name) private progressModel: Model<Progress>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Lesson.name) private lessonModel: Model<Lesson>,
  ) {}

  private async findUser(userId: string): Promise<User | null> {
    const isObjectId = Types.ObjectId.isValid(userId);
    return this.userModel.findOne({
      $or: [
        { email: userId },
        ...(isObjectId ? [{ _id: new Types.ObjectId(userId) }] : []),
      ],
    }).exec();
  }

  async getUserProgress(userId: string) {
    const user = await this.findUser(userId);
    if (!user) {
      return {
        userId,
        stats: {
          totalXp: 0,
          streak: 0,
          completedLessonsCount: 0,
        },
        completedLessons: [],
        level: 'Beginner',
      };
    }

    const completedProgressList = await this.progressModel
      .find({ userId: user._id.toString() })
      .exec();

    const completedLessons = completedProgressList.map((p) => ({
      lessonId: p.lessonId,
      score: p.score,
      completedAt: (p as any).createdAt || new Date().toISOString(),
    }));

    return {
      userId: user.email,
      stats: {
        totalXp: user.totalXp,
        streak: user.streak,
        completedLessonsCount: completedLessons.length,
      },
      completedLessons,
      level: user.level || 'Beginner',
    };
  }

  async completeLesson(userId: string, lessonId: string, score: number) {
    let user = await this.findUser(userId);
    if (!user) {
      if (userId.includes('@') || userId === 'guest') {
        // Create user if not exists to ensure graceful operation for guest sync
        user = await this.userModel.create({
          name: userId.split('@')[0].toUpperCase(),
          email: userId,
          passwordHash: 'placeholder-hash',
          totalXp: 0,
          streak: 0,
          level: 'Beginner',
        });
      } else {
        throw new NotFoundException(`User with ID ${userId} not found`);
      }
    }

    const lesson = await this.lessonModel.findOne({ id: lessonId }).exec();
    if (!lesson) {
      throw new NotFoundException(`Lesson with ID ${lessonId} not found`);
    }

    let progress = await this.progressModel
      .findOne({ userId: user._id.toString(), lessonId })
      .exec();

    let newXpEarned = 0;
    if (!progress) {
      progress = await this.progressModel.create({
        userId: user._id.toString(),
        lessonId,
        score,
        status: 'completed',
      });

      newXpEarned = lesson.xpReward;
      user.totalXp += newXpEarned;

      // Update level based on XP thresholds
      if (user.totalXp >= 2200) user.level = 'Advanced';
      else if (user.totalXp >= 1400) user.level = 'Upper-Intermediate';
      else if (user.totalXp >= 900) user.level = 'Intermediate';
      else if (user.totalXp >= 500) user.level = 'Pre-Intermediate';
      else if (user.totalXp >= 200) user.level = 'Elementary';
      else user.level = 'Beginner';

      await user.save();
    } else {
      if (score > progress.score) {
        progress.score = score;
        await progress.save();
      }
    }

    return {
      message: 'Lesson marked as completed',
      data: {
        userId: user.email,
        lessonId,
        score,
        xpEarned: newXpEarned,
        newTotalXp: user.totalXp,
      },
    };
  }

  async resetProgress(userId: string) {
    const user = await this.findUser(userId);
    if (!user) {
      throw new NotFoundException(`User with ID/Email ${userId} not found`);
    }

    // Delete all progress records for this user
    await this.progressModel.deleteMany({ userId: user._id.toString() }).exec();

    // Reset user statistics
    user.totalXp = 0;
    user.streak = 0;
    user.level = 'Beginner';
    await user.save();

    return {
      message: 'Progress successfully reset',
      userId: user.email,
    };
  }
}
