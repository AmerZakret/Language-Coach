import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { AbuseControls, RateLimitError } from './abuse-controls';
import { ProviderBudget } from './provider-budget';
import { rule } from './abuse-policy';
import { AiContextService } from '../flashcards/services/ai-context.service';
import { PronunciationService } from '../pronunciation/pronunciation.service';
import { AiCoachService } from '../ai-coach/ai-coach.service';

describe('8C bounded provider permits, budgets and safe downstream handling', () => {
  let controls: AbuseControls, budget: ProviderBudget;
  const identity = (owner = 'owner', ip = '198.51.100.1', guest = false) => ({
    owner,
    ip,
    guest,
  });
  beforeEach(() => {
    controls = new AbuseControls();
    budget = new ProviderBudget(controls);
  });
  afterEach(() => {
    controls.onModuleDestroy();
    jest.restoreAllMocks();
  });
  const run = <T>(
    work: () => Promise<T>,
    owner = 'owner',
    ip = '198.51.100.1',
  ) => budget.context.run(identity(owner, ip), () => budget.run('chat', work));

  test('one owner cannot hold unlimited calls; permits release after success and exceptions', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls = [run(() => held), run(() => held)];
    await expect(run(async () => 'denied')).rejects.toBeInstanceOf(
      RateLimitError,
    );
    release();
    await Promise.all(calls);
    await expect(
      run(async () => {
        throw new Error('failure');
      }),
    ).rejects.toThrow('failure');
    await expect(run(async () => 'ok')).resolves.toBe('ok');
    await expect(run(async () => 'ok')).resolves.toBe('ok');
  });
  test('process concurrency is bounded across distinct users and IPs; permits are not leaked', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls = Array.from({ length: 8 }, (_, n) =>
      run(() => held, `owner${n}`, `198.51.100.${n + 1}`),
    );
    await expect(
      run(async () => 'denied', 'new', '203.0.113.1'),
    ).rejects.toBeInstanceOf(RateLimitError);
    release();
    await Promise.all(calls);
    await expect(run(async () => 'ok', 'new', '203.0.113.1')).resolves.toBe(
      'ok',
    );
  });
  test('timeout rejection releases permit and missing authoritative HTTP context fails closed', async () => {
    await expect(
      run(() =>
        Promise.reject(
          Object.assign(new Error('deadline'), { name: 'TimeoutError' }),
        ),
      ),
    ).rejects.toThrow('deadline');
    await expect(run(async () => 'ok')).resolves.toBe('ok');
    await expect(
      budget.run('chat', async () => 'should not run'),
    ).rejects.toMatchObject({ status: 503 });
  });
  test('permits release once, and a denied combined budget does not debit other buckets', () => {
    const permit = [{ name: 'permit', identity: 'one', max: 1 }];
    const release = controls.acquire(permit);
    release();
    release();
    const second = controls.acquire(permit);
    expect(() => controls.acquire(permit)).toThrow(RateLimitError);
    second();
    controls.consume([rule('full', 'one', 1)]);
    expect(() =>
      controls.consume([rule('spare', 'two', 1), rule('full', 'one', 1)]),
    ).toThrow(RateLimitError);
    expect(() => controls.consume([rule('spare', 'two', 1)])).not.toThrow();
  });
  test('expired windows recover; daily budgets survive minute-window rollover', async () => {
    let now = 100000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    for (let minute = 0; minute < 6; minute++) {
      for (let n = 0; n < 5; n++)
        await budget.context.run(identity('guest', '198.51.100.1', true), () =>
          budget.run('chat', async () => 'ok'),
        );
      now += 61000;
    }
    await expect(
      budget.context.run(identity('guest', '198.51.100.1', true), () =>
        budget.run('chat', async () => 'denied'),
      ),
    ).rejects.toBeInstanceOf(RateLimitError);
    now += 24 * 60 * 60000;
    await expect(
      budget.context.run(identity('guest', '198.51.100.1', true), () =>
        budget.run('chat', async () => 'ok'),
      ),
    ).resolves.toBe('ok');
  });
  test('bounded memory fails closed without evicting active identity limits', () => {
    let now = 100000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    controls.consume(
      Array.from({ length: 20000 }, (_, n) =>
        rule('capacity', `identity${n}`, 1),
      ),
    );
    expect(() => controls.consume([rule('new', 'new', 1)])).toThrow(
      'Service is temporarily busy',
    );
    expect(() => controls.consume([rule('capacity', 'identity0', 1)])).toThrow(
      RateLimitError,
    );
    now += 61000;
    expect(() => controls.consume([rule('new', 'new', 1)])).not.toThrow();
  });
  test('flashcard AI holds permits through response consumption, caps output, and hides provider failures', async () => {
    const service = new AiContextService(
      new ConfigService({
        AI_ENABLED: true,
        GEMINI_API_KEY: 'mock-provider-key',
      }),
      budget,
    );
    let finish!: (body: unknown) => void;
    const json = new Promise((resolve) => {
      finish = resolve;
    });
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true, json: () => json } as any);
    const invoke = () =>
      budget.context.run(identity(), () =>
        service.generateContext('hello', 'merhaba', 'en'),
      );
    const pending = [invoke(), invoke()];
    await expect(invoke()).rejects.toBeInstanceOf(RateLimitError);
    finish({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({ sentences: ['hello'], mnemonic: 'hi' }),
              },
            ],
          },
        },
      ],
    });
    await Promise.all(pending);
    expect(
      JSON.parse(String(fetch.mock.calls[0][1]?.body)).generationConfig
        .maxOutputTokens,
    ).toBe(1024);
    fetch.mockRejectedValue(new Error(`raw-provider-${randomUUID()}`));
    await expect(invoke()).resolves.toEqual({
      sentences: expect.any(Array),
      mnemonic: expect.any(String),
    });
  });
  test('pronunciation rejects downstream failures without reading/returning raw error body', async () => {
    const service = new PronunciationService(
      new ConfigService({
        PRONUNCIATION_ENABLED: true,
        PRONUNCIATION_SERVICE_URL: 'https://pronunciation.example.invalid',
        AI_ENABLED: false,
      }),
      budget,
    );
    const text = jest.fn().mockResolvedValue(`secret-${randomUUID()}`);
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status: 500, text } as any);
    const invoke = () =>
      budget.context.run(identity(), () =>
        service.assess(
          {
            buffer: Buffer.from('fixture'),
            originalname: 'fixture.wav',
            mimetype: 'audio/wav',
          } as Express.Multer.File,
          { targetText: 'hello', targetLanguage: 'en' },
        ),
      );
    await expect(invoke()).rejects.toMatchObject({
      response: { code: 'PROVIDER_UNAVAILABLE' },
      status: 503,
    });
    expect(text).not.toHaveBeenCalled();
    // Supplementary AI is disabled: valid transcription remains usable.
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        recognizedText: 'hello',
        detectedLanguage: 'en',
        languageProbability: 1,
      }),
    } as any);
    await expect(invoke()).resolves.toHaveProperty('pronunciationScore', 100);
  });
  test('writing passes an explicit output budget and maps raw downstream failures safely', async () => {
    const owner = '000000000000000000000001';
    const service = new AiCoachService(
      new ConfigService({ AI_ENABLED: true, GEMINI_API_KEY: 'mock-key' }),
      undefined as any,
      { findById: () => ({ exec: async () => ({ _id: owner }) }) } as any,
      undefined as any,
      undefined as any,
      budget,
    );
    const evaluation = {
      grammarScore: 90,
      vocabularyScore: 90,
      clarityScore: 90,
      overallScore: 90,
      corrections: [],
      feedback: 'Good',
      improvedVersion: 'hello',
    };
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          { content: { parts: [{ text: JSON.stringify(evaluation) }] } },
        ],
      }),
    } as any);
    const invoke = () =>
      budget.context.run(identity(owner), () =>
        service.checkWriting(owner, 'topic', 'hello', 'en', 'en'),
      );
    await expect(invoke()).resolves.toEqual(evaluation);
    expect(
      JSON.parse(String(fetch.mock.calls[0][1]?.body)).generationConfig
        .maxOutputTokens,
    ).toBe(4096);
    const marker = randomUUID();
    fetch.mockRejectedValueOnce(new Error(marker));
    const failure = await invoke().catch((error) => error);
    expect(failure.status).toBe(503);
    expect(JSON.stringify(failure.getResponse())).not.toContain(marker);
  });
  test('pronunciation feedback has a separate small output cap and keeps transcription usable', async () => {
    const service = new PronunciationService(
      new ConfigService({
        PRONUNCIATION_ENABLED: true,
        PRONUNCIATION_SERVICE_URL: 'https://pronunciation.example.invalid',
        AI_ENABLED: true,
        GEMINI_API_KEY: 'mock-key',
      }),
      budget,
    );
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          recognizedText: 'hello',
          detectedLanguage: 'en',
          languageProbability: 1,
        }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Good work' }] } }],
        }),
      } as any);
    const result = await budget.context.run(identity(), () =>
      service.assess(
        {
          buffer: Buffer.from('fixture'),
          originalname: 'fixture.wav',
          mimetype: 'audio/wav',
        } as Express.Multer.File,
        { targetText: 'hello', targetLanguage: 'en' },
      ),
    );
    expect(result).toMatchObject({
      pronunciationScore: 100,
      aiFeedback: 'Good work',
    });
    expect(
      JSON.parse(String(fetch.mock.calls[1][1]?.body)).generationConfig
        .maxOutputTokens,
    ).toBe(256);
  });
});
