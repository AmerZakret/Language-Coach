import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Flashcard } from './schemas/flashcard.schema';
import { User } from '../users/schemas/user.schema';
import { SrsCalculatorService } from './services/srs-calculator.service';
import { AiContextService } from './services/ai-context.service';

@Injectable()
export class FlashcardsService {
  constructor(
    @InjectModel(Flashcard.name) private flashcardModel: Model<Flashcard>,
    @InjectModel(User.name) private userModel: Model<User>,
    private srsCalculator: SrsCalculatorService,
    private aiContext: AiContextService,
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

  async create(userId: string, targetWord: string, turkishTranslation: string) {
    let user = await this.findUser(userId);
    if (!user) {
      // Create user if not exists to ensure guest/local flows function gracefully
      user = await this.userModel.create({
        name: userId.split('@')[0].toUpperCase(),
        email: userId,
        passwordHash: 'placeholder-hash',
        totalXp: 0,
        streak: 0,
        level: 'Beginner',
      });
    }

    // Check if flashcard already exists for this user and word
    const existing = await this.flashcardModel.findOne({
      userId: user._id.toString(),
      targetWord,
    }).exec();

    if (existing) {
      existing.turkishTranslation = turkishTranslation;
      existing.nextReviewDate = new Date();
      existing.aiContext = await this.aiContext.generateContext(targetWord, turkishTranslation);
      return existing.save();
    }

    const aiContext = await this.aiContext.generateContext(targetWord, turkishTranslation);

    const flashcard = new this.flashcardModel({
      userId: user._id.toString(),
      targetWord,
      turkishTranslation,
      aiContext,
      nextReviewDate: new Date(), // Review immediately
    });

    return flashcard.save();
  }

  async getDueCards(userId: string) {
    let user = await this.findUser(userId);
    if (!user) return [];

    return this.flashcardModel.find({
      userId: user._id.toString(),
      nextReviewDate: { $lte: new Date() },
    }).sort({ nextReviewDate: 1 }).exec();
  }

  async review(cardId: string, score: number, authenticatedUserId: string) {
    const card = await this.flashcardModel.findById(cardId);
    if (!card) throw new NotFoundException('Flashcard not found');

    if (card.userId.toString() !== authenticatedUserId) {
      throw new ForbiddenException('Access denied: Cannot review another user\'s flashcards');
    }

    const { newEf, newInterval, nextReviewDate } = this.srsCalculator.calculate(
      card.easinessFactor,
      card.interval,
      score,
    );

    card.easinessFactor = newEf;
    card.interval = newInterval;
    card.nextReviewDate = nextReviewDate;
    card.history.push({ date: new Date(), score });

    return card.save();
  }

  async getAll(userId: string) {
    let user = await this.findUser(userId);
    if (!user) return [];

    return this.flashcardModel.find({ userId: user._id.toString() }).exec();
  }
}
