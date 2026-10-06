import { targetLanguageCode, targetLanguageQuery, tryTargetLanguage, languageResponse } from '../common/target-language';
import { Injectable, NotFoundException, ForbiddenException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { ClientSession } from 'mongoose';
import { Flashcard } from './schemas/flashcard.schema';
import { User } from '../users/schemas/user.schema';
import { SrsCalculatorService } from './services/srs-calculator.service';
import { AiContextService } from './services/ai-context.service';

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
   * Language compatibility is handled on reads without backfilling documents.
   */
  async onModuleInit() {
    try {
      // Drop the old index if it exists to avoid conflicts when creating the new index
      await this.flashcardModel.collection.dropIndex('userId_1_targetWord_1');
      console.log('Successfully dropped old flashcard unique index.');
    } catch (e) {
      // Index might not exist, which is fine
    }

  }

  /**
   * Resolve only the MongoDB identity supplied by an authenticated controller.
   */
  private async findUser(userId: string, session?: ClientSession): Promise<User> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('Authenticated user not found');
    }
    const query = this.userModel.findById(userId);
    const user = await (session ? query.session(session) : query).exec();
    if (!user) throw new NotFoundException('Authenticated user not found');
    return user;
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
    session?: ClientSession,
  ) {
    const user = await this.findUser(userId, session);

    const mappedTargetLanguage = targetLanguageCode(targetLanguage);
    const finalNativeLanguage = nativeLanguage || 'Turkish';
    const finalNativeTranslation = nativeTranslation || turkishTranslation || '';
    const finalTurkishTranslation = turkishTranslation || nativeTranslation || '';

    // Check if flashcard already exists for this user, word, and target language
    const existingQuery = this.flashcardModel.findOne({
      userId: user._id.toString(),
      $or: [{ targetLanguage: targetLanguageQuery(mappedTargetLanguage) },
        ...(tryTargetLanguage(user.targetLanguage ?? 'en') === mappedTargetLanguage
          ? [{ targetLanguage: { $exists: false } }] : [])],
      targetWord,
    });
    const existing = await (session ? existingQuery.session(session) : existingQuery).exec();

    // If it exists, update the details and trigger AI Context regeneration
    if (existing) {
      existing.turkishTranslation = finalTurkishTranslation;
      existing.nativeTranslation = finalNativeTranslation;
      existing.nativeLanguage = finalNativeLanguage;
      if (exampleSentence !== undefined) existing.exampleSentence = exampleSentence;
      if (note !== undefined) existing.note = note;
      existing.nextReviewDate = new Date();
      existing.aiContext = await this.aiContext.generateContext(targetWord, finalTurkishTranslation, mappedTargetLanguage);
      return existing.save({ session });
    }

    // Call Gemini helper to fetch definition context and study tips
    const aiContext = await this.aiContext.generateContext(targetWord, finalTurkishTranslation, mappedTargetLanguage);

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

    return flashcard.save({ session });
  }

  /**
   * Update Flashcard Details:
   * 1. Validates card exists.
   * 2. Checks authorization: ensures caller matches the card owner to prevent security leaks.
   * 3. Regenerates AI mnemonic details and saves modifications.
   */
  async update(
    cardId: string,
    targetWord?: string,
    turkishTranslation?: string,
    targetLanguage?: string,
    nativeLanguage?: string,
    nativeTranslation?: string,
    exampleSentence?: string,
    note?: string,
    authenticatedUserId?: string,
    session?: ClientSession,
  ) {
    const query = this.flashcardModel.findById(cardId);
    const card = await (session ? query.session(session) : query);
    if (!card) throw new NotFoundException('Flashcard not found');

    // Access control validation guard
    if (authenticatedUserId && card.userId.toString() !== authenticatedUserId) {
      throw new ForbiddenException('Access denied: Cannot edit another user\'s flashcards');
    }

    if (targetWord !== undefined) card.targetWord = targetWord;
    if (turkishTranslation !== undefined) card.turkishTranslation = turkishTranslation;
    if (nativeTranslation !== undefined) card.nativeTranslation = nativeTranslation;
    if (targetLanguage !== undefined) {
      const language = targetLanguageCode(targetLanguage);
      // Preserve same-language historical index keys until an explicit migration
      // can reconcile full-name/code duplicates. New language values use codes.
      if (tryTargetLanguage(card.targetLanguage) !== language) card.targetLanguage = language;
    }
    if (nativeLanguage !== undefined) {
      card.nativeLanguage = nativeLanguage;
    }
    if (exampleSentence !== undefined) card.exampleSentence = exampleSentence;
    if (note !== undefined) card.note = note;

    const language = card.targetLanguage ?? (await this.findUser(card.userId.toString(), session)).targetLanguage ?? 'en';
    card.aiContext = await this.aiContext.generateContext(card.targetWord, card.turkishTranslation, targetLanguageCode(language));

    return card.save({ session });
  }

  /**
   * Delete Flashcard:
   * Validates target document existence and confirms ownership before deleting.
   */
  async delete(cardId: string, authenticatedUserId: string, session?: ClientSession) {
    const query = this.flashcardModel.findById(cardId);
    const card = await (session ? query.session(session) : query);
    if (!card) throw new NotFoundException('Flashcard not found');

    // Ownership guard
    if (card.userId.toString() !== authenticatedUserId) {
      throw new ForbiddenException('Access denied: Cannot delete another user\'s flashcards');
    }

    await this.flashcardModel.deleteOne({ _id: card._id, userId: authenticatedUserId }, { session }).exec();
    return { message: 'Flashcard deleted successfully' };
  }

  /**
   * Get Due Review Cards:
   * Fetches flashcards where nextReviewDate <= current time, ordered by priority.
   */
  async getDueCards(userId: string, targetLanguage?: string) {
    const user = await this.findUser(userId);

    const query: any = {
      userId: user._id.toString(),
      nextReviewDate: { $lte: new Date() }, // due date has arrived or passed
    };

    if (targetLanguage !== undefined) {
      const language = targetLanguageCode(targetLanguage);
      const match = targetLanguageQuery(language);
      query.$or = [{ targetLanguage: match },
        ...(tryTargetLanguage(user.targetLanguage ?? 'en') === language ? [{ targetLanguage: { $exists: false } }] : [])];
    }

    const cards = await this.flashcardModel.find(query).sort({ nextReviewDate: 1 }).exec();
    return cards.map(card => languageResponse({ ...card.toObject(), targetLanguage: card.targetLanguage ?? user.targetLanguage ?? 'en' }));
  }

  /**
   * Submit Flashcard Review:
   * 1. Resolves card and validates owner.
   * 2. Passes previous Easiness Factor and interval statistics to the SRS Calculator service.
   * 3. Updates card intervals, schedules the new review date, and appends rating scores history.
   */
  async review(cardId: string, score: number, authenticatedUserId: string, session?: ClientSession) {
    const query = this.flashcardModel.findById(cardId);
    const card = await (session ? query.session(session) : query);
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

    return card.save({ session });
  }

  /**
   * Get All Flashcards:
   * Returns list of all cards owned by the target user.
   */
  async getAll(userId: string, targetLanguage?: string) {
    const user = await this.findUser(userId);

    const query: any = { userId: user._id.toString() };
    if (targetLanguage !== undefined) {
      const language = targetLanguageCode(targetLanguage);
      const match = targetLanguageQuery(language);
      query.$or = [{ targetLanguage: match },
        ...(tryTargetLanguage(user.targetLanguage ?? 'en') === language ? [{ targetLanguage: { $exists: false } }] : [])];
    }

    const cards = await this.flashcardModel.find(query).exec();
    return cards.map(card => languageResponse({ ...card.toObject(), targetLanguage: card.targetLanguage ?? user.targetLanguage ?? 'en' }));
  }
}
