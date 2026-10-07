import { targetLanguageCode, TARGET_LANGUAGE_NAMES } from '../common/target-language';
import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssessPronunciationDto } from './dto/assess-pronunciation.dto';

@Injectable()
export class PronunciationService {
  private readonly logger = new Logger(PronunciationService.name);

  constructor(private readonly configService: ConfigService) {}

  async assess(file: Express.Multer.File, dto: AssessPronunciationDto) {
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

      const response = await fetch(`${whisperUrl}/transcribe`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errText = await response.text();
        this.logger.error(`Python Whisper service returned error: ${response.status} - ${errText}`);
        throw new Error(`Whisper service error: ${response.status}`);
      }

      const data = (await response.json()) as {
        recognizedText: string;
        detectedLanguage: string;
        languageProbability: number;
      };

      recognizedText = data.recognizedText || '';
      detectedLanguage = data.detectedLanguage || targetCode;
      languageProbability = data.languageProbability ?? 1.0;
    } catch (error) {
      this.logger.error('Failed to communicate with Python Whisper service', error);
      throw new HttpException(
        'The pronunciation service is currently offline or unreachable. Please check if the Whisper service is running.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
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

    if (!apiKey) {
      this.logger.warn('GEMINI_API_KEY not configured, using fallback feedback.');
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
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Gemini status code: ${response.status}`);
      }

      const data = await response.json();
      const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

      return aiResponse || fallbackMessages[result];
    } catch (error) {
      this.logger.error('Failed to generate Gemini pronunciation feedback', error);
      return fallbackMessages[result];
    }
  }
}
