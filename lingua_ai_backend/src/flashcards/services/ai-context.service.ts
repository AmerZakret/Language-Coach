import { providerJson, ProviderFailure } from '../../operations/provider-client';
import { telemetry } from '../../operations/telemetry';
import { targetLanguageCode, TARGET_LANGUAGE_NAMES } from '../../common/target-language';
import { Injectable, Optional, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { featureEnabled } from '../../config/runtime-config';
import { ProviderBudget } from '../../security/provider-budget';
import { OUTPUT_TOKENS } from '../../security/abuse-policy';

@Injectable()
export class AiContextService {
  constructor(private configService: ConfigService, @Optional() private readonly budget?: ProviderBudget) {}

  async generateContext(word: string, translation: string, targetLanguage: string) {
    const language = TARGET_LANGUAGE_NAMES[targetLanguageCode(targetLanguage)];
    const apiKey = this.configService.get<string>('GEMINI_API_KEY')?.trim();
    const model = (this.configService.get<string>('GEMINI_MODEL') || 'gemini-2.5-flash').trim();

    if (!featureEnabled(this.configService, 'AI_ENABLED') || !apiKey) {
      telemetry.emit('provider.disabled', { dependency: 'flashcard' });
      return { 
        sentences: [`Example sentence for ${word}`], 
        mnemonic: 'Mnemonic not available without API key' 
      };
    }

    const systemPrompt = `You are a creative language teacher. 
    For the ${language} word "${word}" (Turkish translation: "${translation}"), provide:
    1. 3 short ${language} sentences using the word contextually.
    2. 1 phonetic mnemonic bridging the ${language} word to a Turkish concept.
    
    Return pure JSON with fields: "sentences" (array of strings) and "mnemonic" (string).
    Do not include markdown code block formatting.`;

    try {
      const data = await providerJson(this.configService, this.budget, 'flashcard',
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: systemPrompt }] }],
            generationConfig: {
              maxOutputTokens: OUTPUT_TOKENS.flashcard,
              responseMimeType: 'application/json'
            },
          }),
        },
      );
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) throw new Error('Empty response from Gemini');

      const context = JSON.parse(text);
      if (!context || !Array.isArray(context.sentences) || !context.sentences.length || context.sentences.some((sentence: unknown) => typeof sentence !== 'string') || typeof context.mnemonic !== 'string')
        throw new ProviderFailure('PROVIDER_INVALID_RESPONSE', false);
      return context;
    } catch (error) {
      if (error instanceof HttpException && !(error instanceof ProviderFailure)) throw error;
      telemetry.emit('provider.fallback', { dependency: 'flashcard', code: error instanceof ProviderFailure ? error.code : 'PROVIDER_INVALID_RESPONSE' }, 'warn');
      return {
        sentences: [`He used the word ${word} in a sentence.`],
        mnemonic: 'Try to associate the sound with something familiar.'
      };
    }
  }
}
