import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  de: 'German',
  es: 'Spanish',
  fr: 'French',
  ar: 'Arabic',
  english: 'English',
  german: 'German',
  spanish: 'Spanish',
  french: 'French',
  arabic: 'Arabic',
};

@Injectable()
export class AiCoachService {
  private readonly logger = new Logger(AiCoachService.name);

  constructor(
    private configService: ConfigService,
    @InjectModel(ChatMessage.name)
    private chatMessageModel: Model<ChatMessage>,
    @InjectModel(User.name)
    private userModel: Model<User>,
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

  async sendMessage(
    userId: string,
    message: string,
    language: string,
    targetLanguage?: string,
  ) {
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

    const apiKey = this.configService.get<string>('GEMINI_API_KEY')?.trim();
    const model = (
      this.configService.get<string>('GEMINI_MODEL') || 'gemini-flash-latest'
    ).trim();

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

    // Resolve target language name
    const targetLangName =
      LANGUAGE_NAMES[targetLanguage?.toLowerCase() || ''] ||
      targetLanguage ||
      'English';
    const interfaceLangName = language === 'tr' ? 'Turkish' : 'English';

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
        const errorText = await response.text();
        this.logger.error(`Gemini API error: ${response.status} ${errorText}`);
        throw new Error(
          `Failed to fetch from Gemini: ${response.status} ${errorText}`,
        );
      }

      const data = (await response.json()) as GeminiResponse;
      const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!textResponse) {
        throw new Error('Invalid response from Gemini API');
      }

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

      // 1. Save user message
      await new this.chatMessageModel({
        userId: user._id.toString(),
        targetLanguage: targetLangName,
        role: 'user',
        message,
      }).save();

      // 2. Save assistant response
      await new this.chatMessageModel({
        userId: user._id.toString(),
        targetLanguage: targetLangName,
        role: 'assistant',
        message: parsedResponse.reply,
      }).save();

      return {
        reply: parsedResponse.reply,
        correction: parsedResponse.correction,
        saved: true,
      };
    } catch (error) {
      this.logger.error('Error communicating with AI Coach', error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        reply: `ERROR DEBUG: ${errorMessage}`,
        correction: message,
        saved: false,
      };
    }
  }

  async getHistory(userId: string, targetLanguage: string) {
    const user = await this.findUser(userId);
    if (!user) return [];

    const targetLangName =
      LANGUAGE_NAMES[targetLanguage?.toLowerCase() || ''] ||
      targetLanguage ||
      'English';

    return this.chatMessageModel
      .find({ userId: user._id.toString(), targetLanguage: targetLangName })
      .sort({ createdAt: 1 })
      .limit(50)
      .exec();
  }

  async clearHistory(userId: string, targetLanguage: string) {
    const user = await this.findUser(userId);
    if (!user) return { deletedCount: 0 };

    const targetLangName =
      LANGUAGE_NAMES[targetLanguage?.toLowerCase() || ''] ||
      targetLanguage ||
      'English';

    return this.chatMessageModel
      .deleteMany({ userId: user._id.toString(), targetLanguage: targetLangName })
      .exec();
  }
}
