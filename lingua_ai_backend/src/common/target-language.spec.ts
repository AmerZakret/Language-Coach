import { ConfigService } from '@nestjs/config';
import { AiContextService } from '../flashcards/services/ai-context.service';
import { PronunciationService } from '../pronunciation/pronunciation.service';
import { TARGET_LANGUAGE_NAMES, targetLanguageCode, targetLanguageQuery, tryTargetLanguage } from './target-language';

describe('Target language normalization and provider mapping', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(Object.entries(TARGET_LANGUAGE_NAMES))('%s and %s normalize without fallback', (code, name) => {
    expect(targetLanguageCode(code)).toBe(code);
    expect(targetLanguageCode(name)).toBe(code);
    expect(targetLanguageCode(` ${name.toUpperCase()} `)).toBe(code);
    expect(targetLanguageQuery(code).test(name)).toBe(true);
    expect(targetLanguageQuery(name).test(code)).toBe(true);
    expect(targetLanguageQuery(code).test('unsupported')).toBe(false);
  });
  it.each(['İngilizce', 'Almanca', 'İspanyolca', 'Fransızca', 'Arapça'])('known localized alias %s is explicit', name => {
    expect(tryTargetLanguage(name)).toBeDefined();
  });
  it.each(['unknown', '', 'tr', 'Turkish', 'Italian', null, 12, {}, []])('unsupported %p cannot become English', value => {
    expect(tryTargetLanguage(value)).toBeUndefined();
    expect(() => targetLanguageCode(value)).toThrow('Unsupported target language');
  });

  it.each(Object.entries(TARGET_LANGUAGE_NAMES))('flashcard AI prompt uses actual %s language', async (code, name) => {
    const provider = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{"sentences":[],"mnemonic":"hint"}' }] } }] }),
    } as Response);
    const service = new AiContextService(new ConfigService({ GEMINI_API_KEY: 'fixture' }));
    await service.generateContext('word', 'translation', code);
    const body = JSON.parse(provider.mock.calls[0][1]!.body as string);
    const prompt = body.contents[0].parts[0].text;
    expect(prompt).toContain(`For the ${name} word`);
    expect(prompt).toContain(`3 short ${name} sentences`);
    expect(prompt).toContain(`bridging the ${name} word`);
    if (code !== 'en') expect(prompt).not.toContain('English word');
  });

  it.each(Object.entries(TARGET_LANGUAGE_NAMES))('pronunciation sends %s to Whisper even for legacy %s input', async (code, name) => {
    const provider = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true,
      json: async () => ({ recognizedText: 'word', detectedLanguage: code, languageProbability: 1 }),
    } as Response);
    const service = new PronunciationService(new ConfigService());
    const file = { buffer: Buffer.from('fixture'), mimetype: 'audio/wav', originalname: 'audio.wav' } as Express.Multer.File;
    const result = await service.assess(file, { targetText: 'word', targetLanguage: name });
    expect((provider.mock.calls[0][1]!.body as FormData).get('language')).toBe(code);
    expect(result.targetLanguage).toBe(code);
  });
});
