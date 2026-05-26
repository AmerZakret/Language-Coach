import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AiContextService {
  private readonly logger = new Logger(AiContextService.name);

  constructor(private configService: ConfigService) {}

  async generateContext(word: string, translation: string) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY')?.trim();
    const model = (this.configService.get<string>('GEMINI_MODEL') || 'gemini-flash-latest').trim();

    if (!apiKey) {
      this.logger.warn('GEMINI_API_KEY not found, returning placeholder context');
      return { 
        sentences: [`Example sentence for ${word}`], 
        mnemonic: 'Mnemonic not available without API key' 
      };
    }

    const systemPrompt = `You are a creative language teacher. 
    For the English word "${word}" (Turkish translation: "${translation}"), provide:
    1. 3 short English sentences using the word contextually.
    2. 1 phonetic mnemonic bridging the English word to a Turkish concept.
    
    Return pure JSON with fields: "sentences" (array of strings) and "mnemonic" (string).
    Do not include markdown code block formatting.`;

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: systemPrompt }] }],
            generationConfig: { 
              responseMimeType: 'application/json'
            },
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!text) throw new Error('Empty response from Gemini');
      
      return JSON.parse(text);
    } catch (e) {
      this.logger.error('Failed to generate AI context for flashcard', e);
      return { 
        sentences: [`He used the word ${word} in a sentence.`], 
        mnemonic: 'Try to associate the sound with something familiar.' 
      };
    }
  }
}
