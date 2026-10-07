import { targetLanguageCode, targetLanguageQuery, TARGET_LANGUAGE_NAMES, languageResponse } from '../common/target-language';
import { Injectable, Logger, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ChatMessage } from './schemas/chat-message.schema';
import { User } from '../users/schemas/user.schema';

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
  // Logger instance for tracing API interactions and errors in backend logs
  private readonly logger = new Logger(AiCoachService.name);

  constructor(
    private configService: ConfigService,
    @InjectModel(ChatMessage.name)
    private chatMessageModel: Model<ChatMessage>,
    @InjectModel(User.name)
    private userModel: Model<User>,
  ) {}

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
  ) {
    const user = await this.findUser(userId);

    // Retrieve secret variables securely from NestJS config provider (protects key from client bundles)
    const targetCode = targetLanguageCode(targetLanguage ?? 'en');
    const targetLangName = TARGET_LANGUAGE_NAMES[targetCode];
    const apiKey = this.configService.get<string>('GEMINI_API_KEY')?.trim();
    const model = (
      this.configService.get<string>('GEMINI_MODEL') || 'gemini-2.5-flash'
    ).trim();

    // Configuration guard: return clean unconfigured warning instead of crashing if key is missing
    if (!apiKey || apiKey === 'your_gemini_api_key') {
      this.logger.warn('GEMINI_API_KEY is not configured');
      return {
        reply:
          language === 'tr'
            ? 'YZ Koç henüz yapılandırılmadı.'
            : 'AI Coach is not configured yet.',
        correction: message,
        saved: false,
      };
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
      const response = await fetch(
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
              responseMimeType: 'application/json', // Force Gemini to return a clean JSON payload
            },
          }),
        },
      );

      // Handle raw network/API error codes (intercept quota limits securely)
      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Gemini API error: ${response.status} ${errorText}`);
        if (response.status === 429) {
          throw new Error('QUOTA_EXCEEDED');
        }
        throw new Error(
          `Failed to fetch from Gemini: ${response.status} ${errorText}`,
        );
      }

      const data = (await response.json()) as GeminiResponse;
      const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!textResponse) {
        throw new Error('Invalid response from Gemini API');
      }

      // Safe JSON parsing wrapper: fall back to plain message instead of breaking the chat
      let parsedResponse: ParsedAIResponse;
      try {
        parsedResponse = JSON.parse(textResponse) as ParsedAIResponse;
      } catch {
        this.logger.error(`Failed to parse Gemini response: ${textResponse}`);
        parsedResponse = {
          reply:
            'I understood your message, but had trouble formatting my response. Keep practicing!',
          correction: message,
        };
      }

      // 1. Save user's message document to MongoDB
      const savedUserMsg = await new this.chatMessageModel({
        userId: user._id.toString(),
        targetLanguage: targetCode,
        role: 'user',
        message,
      }).save();

      // 2. Save coach's reply document to MongoDB
      const savedAssistantMsg = await new this.chatMessageModel({
        userId: user._id.toString(),
        targetLanguage: targetCode,
        role: 'assistant',
        message: parsedResponse.reply,
      }).save();

      return {
        userMessage: {
          _id: savedUserMsg._id.toString(),
          userId: savedUserMsg.userId,
          role: savedUserMsg.role,
          message: savedUserMsg.message,
          targetLanguage: savedUserMsg.targetLanguage,
          createdAt: savedUserMsg.createdAt,
        },
        assistantMessage: {
          _id: savedAssistantMsg._id.toString(),
          userId: savedAssistantMsg.userId,
          role: savedAssistantMsg.role,
          message: savedAssistantMsg.message,
          targetLanguage: savedAssistantMsg.targetLanguage,
          createdAt: savedAssistantMsg.createdAt,
        },
        reply: parsedResponse.reply,
        correction: parsedResponse.correction,
        saved: true,
      };
    } catch (error) {
      // Catch-all block: intercept errors and return friendly localized feedback (avoids stack leaks)
      this.logger.error('Error communicating with AI Coach', error);
      const isQuotaError =
        error instanceof Error &&
        (error.message.includes('429') || error.message === 'QUOTA_EXCEEDED');
      const fallbackReply = isQuotaError
        ? language === 'tr'
          ? 'Üzgünüm, günlük Gemini yapay zeka kotam doldu. Lütfen biraz sonra tekrar deneyin!'
          : "I'm sorry, my Gemini API quota limit is currently exceeded. Please try again in a minute!"
        : language === 'tr'
        ? 'Yapay zeka koçu ile iletişim kurarken bir hata oluştu. Lütfen tekrar deneyin.'
        : 'An error occurred while communicating with the AI Coach. Please try again.';
      
      throw new HttpException(fallbackReply, HttpStatus.INTERNAL_SERVER_ERROR);
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

    const targetCode = targetLanguageCode(targetLanguage ?? 'en');
    const targetLangName = TARGET_LANGUAGE_NAMES[targetCode];
    const apiKey = this.configService.get<string>('GEMINI_API_KEY')?.trim();
    const model = (
      this.configService.get<string>('GEMINI_MODEL') || 'gemini-2.5-flash'
    ).trim();

    if (!apiKey || apiKey === 'your_gemini_api_key') {
      throw new HttpException('Writing evaluation is not configured yet.', HttpStatus.SERVICE_UNAVAILABLE);
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
      const response = await fetch(
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
              responseMimeType: 'application/json',
            },
          }),
        },
      );

      if (!response.ok) {
        this.logger.warn(`Writing provider returned HTTP ${response.status}`);
        throw new HttpException(
          'Writing evaluation is temporarily unavailable. Please try again.',
          response.status === 429 ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.BAD_GATEWAY,
        );
      }

      const data = (await response.json()) as GeminiResponse;
      const textResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      let evaluation: any;
      try {
        evaluation = JSON.parse(textResponse ?? '');
      } catch {
        throw new HttpException('Writing provider returned an invalid evaluation.', HttpStatus.BAD_GATEWAY);
      }
      const scoreFields = ['grammarScore', 'vocabularyScore', 'clarityScore', 'overallScore'];
      if (!evaluation || scoreFields.some(field => typeof evaluation[field] !== 'number'
        || !Number.isFinite(evaluation[field]) || evaluation[field] < 0 || evaluation[field] > 100)
        || typeof evaluation.feedback !== 'string' || typeof evaluation.improvedVersion !== 'string'
        || !Array.isArray(evaluation.corrections)
        || evaluation.corrections.some((item: any) => !item || ['original', 'correction', 'explanation']
          .some(field => typeof item[field] !== 'string'))) {
        throw new HttpException('Writing provider returned an invalid evaluation.', HttpStatus.BAD_GATEWAY);
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
        throw new HttpException('Writing provider returned an invalid evaluation.', HttpStatus.BAD_GATEWAY);
      }
      this.logger.warn('Writing evaluation provider could not be reached');
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
  async clearHistory(userId: string, targetLanguage: string) {
    const user = await this.findUser(userId);

    const targetCode = targetLanguageCode(targetLanguage ?? 'en');
    return this.chatMessageModel
      .deleteMany({ userId: user._id.toString(), targetLanguage: targetLanguageQuery(targetCode) })
      .exec();
  }
}
