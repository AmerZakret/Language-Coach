import { providerJson, ProviderFailure } from '../operations/provider-client';
import { telemetry } from '../operations/telemetry';
import { targetLanguageCode, targetLanguageQuery, TARGET_LANGUAGE_NAMES, languageResponse } from '../common/target-language';
import { Injectable, NotFoundException, HttpException, HttpStatus, ServiceUnavailableException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { ChatMessage } from './schemas/chat-message.schema';
import { MutationReceipts } from '../common/mutation-receipt';
import { ChatBarrier } from './schemas/chat-barrier.schema';
import { User } from '../users/schemas/user.schema';
import { featureEnabled } from '../config/runtime-config';
import { initializeDevelopmentIndexes } from '../operations/schema-startup';
import { ProviderBudget } from '../security/provider-budget';
import { OUTPUT_TOKENS } from '../security/abuse-policy';

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

interface ParsedAIResponse {
  reply: string;
  correction: string;
}

@Injectable()
export class AiCoachService {
  constructor(
    private configService: ConfigService,
    @InjectModel(ChatMessage.name)
    private chatMessageModel: Model<ChatMessage>,
    @InjectModel(User.name)
    private userModel: Model<User>,
    private readonly receipts: MutationReceipts,
    @InjectModel(ChatBarrier.name) private readonly barriers: Model<ChatBarrier>,
    @Optional() private readonly budget?: ProviderBudget,
  ) {}

  async onModuleInit() { await initializeDevelopmentIndexes(this.barriers); }

  /**
   * Resolve only the MongoDB identity supplied by an authenticated controller.
   */
  private async findUser(userId: string): Promise<User> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('Authenticated user not found');
    }
    const user = await this.userModel.findById(userId).exec();
    if (!user) throw new NotFoundException('Authenticated user not found');
    return user;
  }

  /**
   * Main AI Coach Chat Handler:
   * 1. Resolves the authenticated user profile.
   * 2. Resolves API configuration and system instructions (translated explanations for TR interface).
   * 3. Submits user message securely to Gemini API requesting structured JSON.
   * 4. Parses the reply, checks grammar, and saves records to MongoDB.
   */
  async sendMessage(
    userId: string,
    message: string,
    language: string,
    targetLanguage?: string,
    operationId?: string,
  ) {
    const user = await this.findUser(userId);

    const targetCode = targetLanguageCode(targetLanguage ?? 'en');
    await this.ensureBarrier(userId, targetCode);
    let generated: ParsedAIResponse | undefined;
    return this.receipts.execute(userId, operationId, 'ai-send',
      { message, language, targetLanguage: targetCode }, async session => {
        // Every send and clear writes the same owner/language barrier. MongoDB
        // retries conflicting transactions, giving committed operations a total
        // order. A completed receipt bypasses both provider and history writes.
        await this.advanceBarrier(userId, targetCode, session);
        generated ??= await this.generateReply(message, language, targetCode);
        const savedUserMsg = new this.chatMessageModel({ userId: user._id.toString(), targetLanguage: targetCode, role: 'user', message });
        const savedAssistantMsg = new this.chatMessageModel({ userId: user._id.toString(), targetLanguage: targetCode, role: 'assistant', message: generated.reply });
        await savedUserMsg.save({ session });
        await savedAssistantMsg.save({ session });
        return { userMessage: savedUserMsg, assistantMessage: savedAssistantMsg,
          reply: generated.reply, correction: generated.correction, saved: true };
      });
  }

  private async ensureBarrier(userId: string, targetLanguage: string) {
    try { await this.barriers.updateOne({ userId, targetLanguage }, { $setOnInsert: { revision: 0 } }, { upsert: true, writeConcern: { w: 'majority' } }).exec(); }
    catch (error) {
      if (error?.code !== 11000) throw new ServiceUnavailableException({ code: 'RETRYABLE_SERVER_FAILURE', message: 'History ordering could not be acknowledged. Retry the same operation.' });
    }
  }

  private async advanceBarrier(userId: string, targetLanguage: string, session: ClientSession) {
    const result = await this.barriers.updateOne({ userId, targetLanguage }, { $inc: { revision: 1 } }, { session }).exec();
    if (result.matchedCount !== 1) throw new ServiceUnavailableException({ code: 'RETRYABLE_SERVER_FAILURE', message: 'History ordering could not be acknowledged. Retry the same operation.' });
  }

  private async generateReply(message: string, language: string, targetCode: ReturnType<typeof targetLanguageCode>): Promise<ParsedAIResponse> {
    if (!featureEnabled(this.configService, 'AI_ENABLED')) throw new ServiceUnavailableException({ code: 'FEATURE_DISABLED', message: 'AI features are disabled.' });
    // Retrieve secret variables securely from NestJS config provider (protects key from client bundles)
    const targetLangName = TARGET_LANGUAGE_NAMES[targetCode];
    const apiKey = this.configService.get<string>('GEMINI_API_KEY')?.trim();
    const model = (
      this.configService.get<string>('GEMINI_MODEL') || 'gemini-2.5-flash'
    ).trim();

    // Configuration failures remain retryable and never create history or a receipt.
    if (!apiKey || apiKey === 'your_gemini_api_key') {
      telemetry.emit('provider.configuration', { dependency: 'chat' }, 'warn');
      throw new ProviderFailure('PROVIDER_CONFIGURATION', false);
    }

    // Convert interface and target language codes to human-readable names for prompt construction

    const interfaceLangName = language === 'tr' ? 'Turkish' : 'English';

    // System instruction defining the AI's persona, tasks, and response schema.
    // Specifying "Turkish" as explanations language ensures bilingual support.
    const systemInstruction = `You are a friendly language learning coach.
The user is learning ${targetLangName}.
Your job is to:
1. Gently correct any ${targetLangName} grammar or vocabulary mistakes.
2. Respond to their message encouragingly.
3. Provide all explanations and feedback in ${interfaceLangName}.
4. The corrected sentence must be in ${targetLangName}.

Return a JSON object with two fields:
- "reply": Your conversational response, feedback, and explanation in ${interfaceLangName}.
- "correction": The corrected version of the user's sentence in ${targetLangName} (if already perfect, just repeat it).
Do not include markdown code block formatting like \`\`\`json. Return pure JSON.`;

    const prompt = `User Message: "${message}"\nTarget Language: "${targetLangName}"\nInterface Language: "${interfaceLangName}"\n\nPlease evaluate and respond in JSON format.`;

    try {
      // Execute async request to Google Gemini API
      const data = await providerJson(this.configService, this.budget, 'chat',
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: {
              parts: [{ text: systemInstruction }],
            },
            contents: [
              {
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              maxOutputTokens: OUTPUT_TOKENS.chat,
              responseMimeType: 'application/json', // Force Gemini to return a clean JSON payload
            },
          }),
        },
      );

      // Handle raw network/API error codes (intercept quota limits securely)
      const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!textResponse) {
        throw new Error('Invalid response from Gemini API');
      }

      const parsedResponse = JSON.parse(textResponse) as ParsedAIResponse;
      if (!parsedResponse || typeof parsedResponse.reply !== 'string' || !parsedResponse.reply.trim()
        || typeof parsedResponse.correction !== 'string') throw new Error('Invalid provider response');
      return parsedResponse;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      telemetry.emit('provider.invalid_response', { dependency: 'chat', failureCategory: 'invalid_response' }, 'warn');
      throw new ProviderFailure('PROVIDER_INVALID_RESPONSE', false);
    }
  }

  /**
   * AI Essay Evaluator (Writing Practice):
   * 1. Submits essay text to Gemini AI alongside prompt/topic context.
   * 2. Requests scoring breakdown (Grammar, Vocabulary, Clarity) and errors array.
   * 3. Normalizes score math and returns formatted report structure.
   */
  async checkWriting(
    userId: string,
    topic: string,
    text: string,
    language: string,
    targetLanguage: string,
  ) {
    await this.findUser(userId);

    if (!featureEnabled(this.configService, 'AI_ENABLED')) throw new ServiceUnavailableException({ code: 'FEATURE_DISABLED', message: 'AI features are disabled.' });

    const targetCode = targetLanguageCode(targetLanguage ?? 'en');
    const targetLangName = TARGET_LANGUAGE_NAMES[targetCode];
    const apiKey = this.configService.get<string>('GEMINI_API_KEY')?.trim();
    const model = (
      this.configService.get<string>('GEMINI_MODEL') || 'gemini-2.5-flash'
    ).trim();

    if (!apiKey || apiKey === 'your_gemini_api_key') {
      throw new ProviderFailure('PROVIDER_CONFIGURATION', false);
    }

    const interfaceLangName = language === 'tr' ? 'Turkish' : 'English';

    // System instruction layout for structured JSON return (includes corrections array schema)
    const systemInstruction = `You are a supportive language teacher.
Evaluate the user's writing about the topic: "${topic}".
The target language is ${targetLangName}.
Explanations and general feedback must be in ${interfaceLangName}.

You must return a JSON object with the following structure:
{
  "grammarScore": number, (0-100 score for grammar)
  "vocabularyScore": number, (0-100 score for vocabulary)
  "clarityScore": number, (0-100 score for clarity and style)
  "overallScore": number, (0-100 overall score)
  "corrections": [
    {
      "original": "the exact mistaken word or phrase from user text",
      "correction": "the corrected word or phrase",
      "explanation": "Brief explanation of why it was a mistake and how to fix it in ${interfaceLangName}"
    }
  ],
  "feedback": "Your overall encouraging feedback and suggestions for improvement in ${interfaceLangName}",
  "improvedVersion": "A polished, natural-sounding rewrite of the user's text in ${targetLangName}"
}

Return ONLY this JSON. Do not include markdown formatting like \`\`\`json.`;

    const prompt = `Evaluate the following user writing:\nTopic: "${topic}"\nUser text: "${text}"`;

    try {
      const data = await providerJson(this.configService, this.budget, 'writing',
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: {
              parts: [{ text: systemInstruction }],
            },
            contents: [
              {
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              maxOutputTokens: OUTPUT_TOKENS.writing,
              responseMimeType: 'application/json',
            },
          }),
        },
      );
      const textResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      let evaluation: any;
      try {
        evaluation = JSON.parse(textResponse ?? '');
      } catch {
        throw new ProviderFailure('PROVIDER_INVALID_RESPONSE', false);
      }
      const scoreFields = ['grammarScore', 'vocabularyScore', 'clarityScore', 'overallScore'];
      if (!evaluation || scoreFields.some(field => typeof evaluation[field] !== 'number'
        || !Number.isFinite(evaluation[field]) || evaluation[field] < 0 || evaluation[field] > 100)
        || typeof evaluation.feedback !== 'string' || typeof evaluation.improvedVersion !== 'string'
        || !Array.isArray(evaluation.corrections)
        || evaluation.corrections.some((item: any) => !item || ['original', 'correction', 'explanation']
          .some(field => typeof item[field] !== 'string'))) {
        throw new ProviderFailure('PROVIDER_INVALID_RESPONSE', false);
      }
      // Scores are percentages (0-100), including decimals; never infer a second scale.
      return {
        grammarScore: evaluation.grammarScore,
        vocabularyScore: evaluation.vocabularyScore,
        clarityScore: evaluation.clarityScore,
        overallScore: evaluation.overallScore,
        corrections: evaluation.corrections.map(({ original, correction, explanation }) => ({ original, correction, explanation })),
        feedback: evaluation.feedback,
        improvedVersion: evaluation.improvedVersion,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof SyntaxError) {
        throw new ProviderFailure('PROVIDER_INVALID_RESPONSE', false);
      }
      telemetry.emit('provider.invalid_response', { dependency: 'writing' }, 'warn');
      throw new HttpException('Writing evaluation is temporarily unavailable. Please try again.', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  /**
   * Fetches chat history between specific user and AI coach.
   * Sorted chronologically and limited to most recent 50 messages to save database packet size.
   */
  async getHistory(userId: string, targetLanguage: string) {
    const user = await this.findUser(userId);

    const targetCode = targetLanguageCode(targetLanguage ?? 'en');
    return this.chatMessageModel
      .find({ userId: user._id.toString(), targetLanguage: targetLanguageQuery(targetCode) })
      .sort({ createdAt: -1, _id: -1 })
      .limit(50)
      .exec().then(messages => messages.reverse().map(languageResponse));
  }

  /**
   * Deletes all chat history log mappings for a user.
   */
  async clearHistory(userId: string, targetLanguage: string, operationId?: string) {
    const user = await this.findUser(userId);
    const targetCode = targetLanguageCode(targetLanguage ?? 'en');
    await this.ensureBarrier(userId, targetCode);
    return this.receipts.execute(userId, operationId, 'ai-clear', { targetLanguage: targetCode }, async session => {
      await this.advanceBarrier(userId, targetCode, session);
      const deleted = await this.chatMessageModel.deleteMany({ userId: user._id.toString(), targetLanguage: targetLanguageQuery(targetCode) }, { session }).exec();
      return { success: true, deletedCount: deleted.deletedCount };
    });
  }
}
