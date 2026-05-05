import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ChatMessage } from './schemas/chat-message.schema';

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
  private readonly logger = new Logger(AiCoachService.name);

  constructor(
    private configService: ConfigService,
    @InjectModel(ChatMessage.name) private chatMessageModel: Model<ChatMessage>,
  ) {}

  async sendMessage(userId: string, message: string, language: string) {
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

    const systemInstruction = `You are a beginner-friendly English learning coach for Turkish users.
The user is learning English. 
Your job is to gently correct grammar mistakes if any, and respond to their message encouragingly.
If the requested language is 'tr', your explanations should be in Turkish.
If the requested language is 'en', your explanations should be in English.

Return a JSON object with two fields:
- "reply": Your conversational response and explanation.
- "correction": The corrected version of their sentence (if perfect, just repeat it).
Do not include markdown code block formatting like \`\`\`json. Return pure JSON.`;

    const prompt = `User Message: "${message}"\nRequested Language: "${language}"\n\nPlease evaluate and respond in JSON format.`;

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

      const chatMessage = new this.chatMessageModel({
        userId,
        userMessage: message,
        assistantResponse: parsedResponse.reply,
        language,
      });
      await chatMessage.save();

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
}
