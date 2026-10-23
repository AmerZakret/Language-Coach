import { providerJson, ProviderFailure } from '../operations/provider-client';
import { telemetry } from '../operations/telemetry';
import { targetLanguageCode, TARGET_LANGUAGE_NAMES } from '../common/target-language';
import { Injectable, HttpException, HttpStatus, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssessPronunciationDto } from './dto/assess-pronunciation.dto';
import { featureEnabled } from '../config/runtime-config';
import { ProviderBudget } from '../security/provider-budget';
import { OUTPUT_TOKENS } from '../security/abuse-policy';

@Injectable()
export class PronunciationService {
  constructor(private readonly configService: ConfigService, @Optional() private readonly budget?: ProviderBudget) {}

  async assess(file: Express.Multer.File, dto: AssessPronunciationDto) {
    if (!featureEnabled(this.configService, 'PRONUNCIATION_ENABLED')) {
      throw new HttpException({ code: 'FEATURE_DISABLED', message: 'Pronunciation is disabled.' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    if (!file) {
      throw new HttpException('Audio file is required', HttpStatus.BAD_REQUEST);
    }
    if (!dto.targetText) {
      throw new HttpException('targetText is required', HttpStatus.BAD_REQUEST);
    }
    if (!dto.targetLanguage) {
      throw new HttpException('targetLanguage is required', HttpStatus.BAD_REQUEST);
    }

    const targetCode = targetLanguageCode(dto.targetLanguage);
    const whisperUrl = (
      this.configService.get<string>('PRONUNCIATION_SERVICE_URL') ||
      'http://localhost:8001'
    ).trim();

    // 1. Send Audio to Python Whisper service
    let recognizedText = '';
    let detectedLanguage: string = targetCode;
    let languageProbability = 1.0;

    try {
      const whisperLanguage = targetCode;

      const formData = new FormData();
      // Create a Blob from the file buffer to upload via native fetch
      const fileBlob = new Blob([file.buffer as any], { type: file.mimetype });
      formData.append('audio', fileBlob, file.originalname || 'audio.wav');
      formData.append('language', whisperLanguage);

      const data = await providerJson(this.configService, this.budget, 'pronunciation',`${whisperUrl}/transcribe`, {
        method: 'POST',
        body: formData,
      });

      if (typeof data.recognizedText !== 'string' || data.recognizedText.length > 4000) throw new Error('Invalid transcription response');
      recognizedText = data.recognizedText;
      detectedLanguage = data.detectedLanguage || targetCode;
      languageProbability = data.languageProbability ?? 1.0;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      telemetry.emit('provider.invalid_response', { dependency: 'pronunciation' }, 'warn');
      throw new ProviderFailure('PROVIDER_INVALID_RESPONSE', false);
    }

    // 2. Normalize and compute similarity
    const score = this.calculateSimilarity(dto.targetText, recognizedText);

    // 3. Decide result category
    let result: 'correct' | 'almost' | 'try_again' = 'try_again';
    if (score >= 90) {
      result = 'correct';
    } else if (score >= 70) {
      result = 'almost';
    }

    // 4. Ask Gemini for friendly feedback
    const aiFeedback = await this.generateGeminiFeedback(
      dto.targetText,
      TARGET_LANGUAGE_NAMES[targetCode],
      recognizedText,
      score,
      result,
    );

    return {
      targetText: dto.targetText,
      recognizedText: recognizedText || '(No speech detected)',
      targetLanguage: targetCode,
      pronunciationScore: score,
      result,
      aiFeedback,
      provider: 'faster_whisper_local_gemini_feedback',
    };
  }

  // Text normalization helper
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD') // Decompose diacritics
      .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'’]/g, '') // Remove punctuation
      .replace(/\s+/g, ' ') // Collapse multiple spaces
      .trim();
  }

  // Levenshtein similarity distance helper
  private calculateSimilarity(text1: string, text2: string): number {
    const norm1 = this.normalizeText(text1);
    const norm2 = this.normalizeText(text2);

    if (!norm1 && !norm2) return 100;
    if (!norm1 || !norm2) return 0;

    const matrix: number[][] = [];

    for (let i = 0; i <= norm2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= norm1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= norm2.length; i++) {
      for (let j = 1; j <= norm1.length; j++) {
        if (norm2.charAt(i - 1) === norm1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            Math.min(
              matrix[i][j - 1] + 1, // insertion
              matrix[i - 1][j] + 1, // deletion
            ),
          );
        }
      }
    }

    const distance = matrix[norm2.length][norm1.length];
    const maxLength = Math.max(norm1.length, norm2.length);

    return Math.round((1 - distance / maxLength) * 100);
  }

  // Gemini Feedback Generator
  private async generateGeminiFeedback(
    targetText: string,
    targetLanguage: string,
    recognizedText: string,
    score: number,
    result: 'correct' | 'almost' | 'try_again',
  ): Promise<string> {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY')?.trim();
    const model = (this.configService.get<string>('GEMINI_MODEL') || 'gemini-2.5-flash').trim();

    const fallbackMessages = {
      correct: 'Excellent job! Your pronunciation is clear and correct.',
      almost: 'Very close! Just a tiny adjustment is needed. Keep trying!',
      try_again: 'Keep practicing! Focus on each word slowly and try again.',
    };

    if (!featureEnabled(this.configService, 'AI_ENABLED') || !apiKey) {
      telemetry.emit('provider.disabled', { dependency: 'feedback' });
      return fallbackMessages[result];
    }

    const prompt = `You are an encouraging language learning coach.
    A user is practicing pronunciation for the target text "${targetText}" in the language "${targetLanguage}".
    The speech-to-text system transcribed their voice as "${recognizedText || '(nothing recognized)'}".
    The computed pronunciation similarity score is ${score}/100, resulting in the status of "${result}".

    Based on this, write a short, friendly, and helpful feedback message.
    - Keep it very encouraging, positive, and constructive.
    - Write it in English (or simple target language if helpful).
    - If the score is low, offer a simple pronunciation tip for the word/phrase.
    - Do not claim phoneme-level accuracy.
    - Keep it under 2 short sentences.`;

    try {
      const data = await providerJson(this.configService, this.budget, 'feedback',
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: OUTPUT_TOKENS.feedback },
          }),
        },
      );
      const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

      if (!aiResponse) throw new ProviderFailure('PROVIDER_INVALID_RESPONSE', false);
      return aiResponse;
    } catch (error) {
      telemetry.emit('provider.fallback', { dependency: 'feedback', code: error instanceof ProviderFailure ? error.code
        : error instanceof HttpException ? (error.getStatus() === 429 ? 'RATE_LIMITED' : 'LOCAL_PROVIDER_CONTROL') : 'PROVIDER_INVALID_RESPONSE' }, 'warn');
      return fallbackMessages[result];
    }
  }
}
