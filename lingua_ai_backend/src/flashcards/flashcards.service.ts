import { Injectable, NotFoundException, ForbiddenException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Flashcard } from './schemas/flashcard.schema';
import { User } from '../users/schemas/user.schema';
import { SrsCalculatorService } from './services/srs-calculator.service';
import { AiContextService } from './services/ai-context.service';

const shortToFull: Record<string, string> = {
  en: 'English',
  de: 'German',
  es: 'Spanish',
  fr: 'French',
  ar: 'Arabic',
  tr: 'Turkish',
  English: 'English',
  German: 'German',
  Spanish: 'Spanish',
  French: 'French',
  Arabic: 'Arabic',
  Turkish: 'Turkish',
};

@Injectable()
export class FlashcardsService implements OnModuleInit {
  constructor(
    @InjectModel(Flashcard.name) private flashcardModel: Model<Flashcard>,
    @InjectModel(User.name) private userModel: Model<User>,
    private srsCalculator: SrsCalculatorService,
    private aiContext: AiContextService,
  ) {}

  /**
   * NestJS Lifecycle Hook:
   * 1. Drops legacy unique index userId_1_targetWord_1 to prevent Mongoose schema errors on launch.
   * 2. Migrates older flashcard schema documents.
   */
  async onModuleInit() {
    try {
      // Drop the old index if it exists to avoid conflicts when creating the new index
      await this.flashcardModel.collection.dropIndex('userId_1_targetWord_1');
      console.log('Successfully dropped old flashcard unique index.');
    } catch (e) {
      // Index might not exist, which is fine
    }
    await this.migrateLegacyFlashcards();
  }

  /**
   * Schema Migration Helper:
   * Maps older flashcard documents missing standard fields like targetLanguage or nativeTranslation values.
   */
  private async migrateLegacyFlashcards() {
    try {
      const legacyCards = await this.flashcardModel.find({ targetLanguage: { $exists: false } }).exec();
      if (legacyCards.length === 0) return;

      for (const card of legacyCards) {
        const user = await this.userModel.findById(card.userId).exec();
        card.targetLanguage = user?.targetLanguage ? (shortToFull[user.targetLanguage] || user.targetLanguage) : 'English';
        card.nativeLanguage = 'Turkish';
        card.nativeTranslation = card.turkishTranslation;
        await card.save();
      }
      console.log(`Migrated ${legacyCards.length} legacy flashcards.`);
    } catch (e) {
      console.error('Failed to migrate legacy flashcards', e);
    }
  }

  /**
   * Helper function to find a user profile in MongoDB by email or ObjectId.
   */
  private async findUser(userId: string): Promise<User | null> {
    const queryEmail = userId === 'guest' ? 'guest@lingua.ai' : userId;
    const isObjectId = Types.ObjectId.isValid(userId);
    return this.userModel.findOne({
      $or: [
        { email: queryEmail },
        ...(isObjectId ? [{ _id: new Types.ObjectId(userId) }] : []),
      ],
    }).exec();
  }

  /**
   * Create or Update Flashcard:
   * 1. Resolves language codes.
   * 2. Checks if the word is already created for this user and target language.
   * 3. Calls Gemini AI to generate customized mnemonics context (sentences, tips).
   * 4. Persists the flashcard in MongoDB.
   */
  async create(
    userId: string,
    targetWord: string,
    turkishTranslation: string,
    targetLanguage: string,
    nativeLanguage?: string,
    nativeTranslation?: string,
    exampleSentence?: string,
    note?: string,
  ) {
    let user = await this.findUser(userId);
    if (!user) {
      user = await this.userModel.create({
        name: userId.split('@')[0].toUpperCase(),
        email: userId,
        passwordHash: 'placeholder-hash',
        totalXp: 0,
        streak: 0,
        level: 'Beginner',
      });
    }

    const mappedTargetLanguage = shortToFull[targetLanguage] || targetLanguage || 'English';
    const finalNativeLanguage = nativeLanguage || 'Turkish';
    const finalNativeTranslation = nativeTranslation || turkishTranslation || '';
    const finalTurkishTranslation = turkishTranslation || nativeTranslation || '';

    // Check if flashcard already exists for this user, word, and target language
    const existing = await this.flashcardModel.findOne({
      userId: user._id.toString(),
      targetLanguage: mappedTargetLanguage,
      targetWord,
    }).exec();

    // If it exists, update the details and trigger AI Context regeneration
    if (existing) {
      existing.turkishTranslation = finalTurkishTranslation;
      existing.nativeTranslation = finalNativeTranslation;
      existing.nativeLanguage = finalNativeLanguage;
      if (exampleSentence !== undefined) existing.exampleSentence = exampleSentence;
      if (note !== undefined) existing.note = note;
      existing.nextReviewDate = new Date();
      existing.aiContext = await this.aiContext.generateContext(targetWord, finalTurkishTranslation);
      return existing.save();
    }

    // Call Gemini helper to fetch definition context and study tips
    const aiContext = await this.aiContext.generateContext(targetWord, finalTurkishTranslation);

    const flashcard = new this.flashcardModel({
      userId: user._id.toString(),
      targetWord,
      turkishTranslation: finalTurkishTranslation,
      targetLanguage: mappedTargetLanguage,
      nativeLanguage: finalNativeLanguage,
      nativeTranslation: finalNativeTranslation,
      exampleSentence,
      note,
      aiContext,
      nextReviewDate: new Date(), // Set next review date to immediately so it appears in study deck
    });

    return flashcard.save();
  }

  /**
   * Update Flashcard Details:
   * 1. Validates card exists.
   * 2. Checks authorization: ensures caller matches the card owner to prevent security leaks.
   * 3. Regenerates AI mnemonic details and saves modifications.
   */
  async update(
    cardId: string,
    targetWord: string,
    turkishTranslation: string,
    targetLanguage?: string,
    nativeLanguage?: string,
    nativeTranslation?: string,
    exampleSentence?: string,
    note?: string,
    authenticatedUserId?: string,
  ) {
    const card = await this.flashcardModel.findById(cardId);
    if (!card) throw new NotFoundException('Flashcard not found');

    // Access control validation guard
    if (authenticatedUserId && card.userId.toString() !== authenticatedUserId) {
      throw new ForbiddenException('Access denied: Cannot edit another user\'s flashcards');
    }

    const finalNativeTranslation = nativeTranslation || turkishTranslation || '';
    const finalTurkishTranslation = turkishTranslation || nativeTranslation || '';

    card.targetWord = targetWord;
    card.turkishTranslation = finalTurkishTranslation;
    card.nativeTranslation = finalNativeTranslation;
    if (targetLanguage) {
      card.targetLanguage = shortToFull[targetLanguage] || targetLanguage;
    }
    if (nativeLanguage) {
      card.nativeLanguage = nativeLanguage;
    }
    card.exampleSentence = exampleSentence;
    card.note = note;

    card.aiContext = await this.aiContext.generateContext(targetWord, finalTurkishTranslation);

    return card.save();
  }

  /**
   * Delete Flashcard:
   * Validates target document existence and confirms ownership before deleting.
   */
  async delete(cardId: string, authenticatedUserId: string) {
    const card = await this.flashcardModel.findById(cardId);
    if (!card) throw new NotFoundException('Flashcard not found');

    // Ownership guard
    if (card.userId.toString() !== authenticatedUserId) {
      throw new ForbiddenException('Access denied: Cannot delete another user\'s flashcards');
    }

    await this.flashcardModel.deleteOne({ _id: card._id }).exec();
    return { message: 'Flashcard deleted successfully' };
  }

  /**
   * Get Due Review Cards:
   * Fetches flashcards where nextReviewDate <= current time, ordered by priority.
   */
  async getDueCards(userId: string, targetLanguage?: string) {
    let user = await this.findUser(userId);
    if (!user) return [];

    const query: any = {
      userId: user._id.toString(),
      nextReviewDate: { $lte: new Date() }, // due date has arrived or passed
    };

    if (targetLanguage) {
      query.targetLanguage = shortToFull[targetLanguage] || targetLanguage;
    }

    return this.flashcardModel.find(query).sort({ nextReviewDate: 1 }).exec();
  }

  /**
   * Submit Flashcard Review:
   * 1. Resolves card and validates owner.
   * 2. Passes previous Easiness Factor and interval statistics to the SRS Calculator service.
   * 3. Updates card intervals, schedules the new review date, and appends rating scores history.
   */
  async review(cardId: string, score: number, authenticatedUserId: string) {
    const card = await this.flashcardModel.findById(cardId);
    if (!card) throw new NotFoundException('Flashcard not found');

    // Ownership guard
    if (card.userId.toString() !== authenticatedUserId) {
      throw new ForbiddenException('Access denied: Cannot review another user\'s flashcards');
    }

    // Call local SM-2 calculation algorithm
    const { newEf, newInterval, nextReviewDate } = this.srsCalculator.calculate(
      card.easinessFactor,
      card.interval,
      score,
    );

    card.easinessFactor = newEf;
    card.interval = newInterval;
    card.nextReviewDate = nextReviewDate;
    card.reviewCount = (card.reviewCount || 0) + 1;
    card.history.push({ date: new Date(), score });

    return card.save();
  }

  /**
   * Get All Flashcards:
   * Returns list of all cards owned by the target user.
   */
  async getAll(userId: string, targetLanguage?: string) {
    let user = await this.findUser(userId);
    if (!user) return [];

    const query: any = { userId: user._id.toString() };
    if (targetLanguage) {
      query.targetLanguage = shortToFull[targetLanguage] || targetLanguage;
    }

    return this.flashcardModel.find(query).exec();
  }
}
