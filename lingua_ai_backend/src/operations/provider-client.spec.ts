import { ConfigService } from '@nestjs/config';
import { ProviderBudget, ProviderKind } from '../security/provider-budget';
import { AbuseControls, RateLimitError } from '../security/abuse-controls';
import { AiCoachService } from '../ai-coach/ai-coach.service';
import { AiContextService } from '../flashcards/services/ai-context.service';
import { PronunciationService } from '../pronunciation/pronunciation.service';
import { providerJson, ProviderFailure } from './provider-client';
import { telemetry, RequestContext } from './telemetry';
import { validateEnvironment } from '../config/runtime-config';

describe('8D provider deadlines, cancellation and bounded retry (mocked providers only)', () => {
  const owner = '000000000000000000000001';
  let controls: AbuseControls,
    budget: ProviderBudget,
    config: ConfigService,
    fetch: jest.SpyInstance;
  const ok = () => ({ ok: true, json: async () => ({ ok: true }) }) as any;
  const run = <T>(work: () => Promise<T>) =>
    budget.context.run({ owner, ip: '198.51.100.1', guest: false }, work);
  const call = (kind: ProviderKind = 'chat') =>
    run(() =>
      providerJson(config, budget, kind, 'https://provider.example.invalid', {
        method: 'POST',
        body: '{}',
      }),
    );
  beforeEach(() => {
    jest.useFakeTimers();
    controls = new AbuseControls();
    budget = new ProviderBudget(controls);
    const values: Record<string, any> = {
      AI_ENABLED: true,
      PRONUNCIATION_ENABLED: true,
      GEMINI_API_KEY: 'mock-key',
      PRONUNCIATION_SERVICE_URL: 'https://transcriber.example.invalid',
      PROVIDER_CHAT_TIMEOUT_MS: 500,
      PROVIDER_WRITING_TIMEOUT_MS: 500,
      PROVIDER_FLASHCARD_TIMEOUT_MS: 500,
      PROVIDER_FEEDBACK_TIMEOUT_MS: 500,
      PROVIDER_PRONUNCIATION_TIMEOUT_MS: 500,
      PROVIDER_MAX_RETRIES: 0,
    };
    config = new ConfigService(values);
    jest.spyOn(config, 'set').mockImplementation((key, value) => {
      values[key] = value;
    });
    fetch = jest.spyOn(global, 'fetch').mockResolvedValue(ok());
  });
  afterEach(() => {
    controls.onModuleDestroy();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  test.each([
    'chat',
    'writing',
    'flashcard',
    'feedback',
    'pronunciation',
  ] as ProviderKind[])(
    '%s real service path aborts on deadline and releases owner permit',
    async (kind) => {
      fetch.mockImplementation(() => new Promise(() => {}));
      const ai = new AiCoachService(
        config,
        undefined as any,
        { findById: () => ({ exec: async () => ({ _id: owner }) }) } as any,
        undefined as any,
        undefined as any,
        budget,
      );
      const pronunciation = new PronunciationService(config, budget);
      const invoke = () =>
        kind === 'chat'
          ? (ai as any).generateReply('hello', 'en', 'en')
          : kind === 'writing'
            ? ai.checkWriting(owner, 'topic', 'hello', 'en', 'en')
            : kind === 'flashcard'
              ? new AiContextService(config, budget).generateContext(
                  'hello',
                  'merhaba',
                  'en',
                )
              : kind === 'feedback'
                ? (pronunciation as any).generateGeminiFeedback(
                    'hello',
                    'English',
                    'hello',
                    100,
                    'correct',
                  )
                : pronunciation.assess(
                    {
                      buffer: Buffer.from('fixture'),
                      mimetype: 'audio/wav',
                      originalname: 'fixture.wav',
                    } as Express.Multer.File,
                    { targetText: 'hello', targetLanguage: 'en' },
                  );
      const events = jest.spyOn(telemetry, 'emit');
      const pending = run(invoke).catch((error) => error);
      await jest.advanceTimersByTimeAsync(500);
      const result = await pending;
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
      expect(
        events.mock.calls.some(
          ([event, data]) =>
            event === 'provider.failed' && data?.code === 'PROVIDER_TIMEOUT',
        ),
      ).toBe(true);
      if (!['flashcard', 'feedback'].includes(kind))
        expect(result).toMatchObject({
          code: 'PROVIDER_TIMEOUT',
          retryable: true,
        });
      if (kind !== 'pronunciation')
        expect(
          JSON.parse(String(fetch.mock.calls[0][1].body)).generationConfig
            .maxOutputTokens,
        ).toBe(
          (
            { chat: 2048, writing: 4096, flashcard: 1024, feedback: 256 } as any
          )[kind],
        );
      fetch.mockResolvedValue(ok());
      await expect(call(kind)).resolves.toEqual({ ok: true });
      // Only the limiter maintenance interval remains, no provider deadline timer.
      expect(jest.getTimerCount()).toBe(1);
    },
  );
  test('deadline also bounds a hung successful response body', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: () => new Promise(() => {}),
    } as any);
    const pending = call().catch((error) => error);
    await jest.advanceTimersByTimeAsync(500);
    expect(await pending).toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
  test('native streamed JSON is decoded with the same deadline and cleans its timer', async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    await expect(call()).resolves.toEqual({ ok: true });
    expect(jest.getTimerCount()).toBe(1);
  });
  test('oversized native response stream is cancelled without retry or raw body exposure', async () => {
    config.set('PROVIDER_MAX_RETRIES', 1);
    const cancel = jest.fn();
    fetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(256 * 1024 + 1));
          },
          cancel,
        }),
      ),
    );
    await expect(call()).rejects.toMatchObject({
      code: 'PROVIDER_INVALID_RESPONSE',
      retryable: false,
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
  });
  test('success removes deadline timer and client cancellation listener', async () => {
    const controller = new AbortController();
    const remove = jest.spyOn(controller.signal, 'removeEventListener');
    const context = {
      requestId: 'safe-request',
      signal: controller.signal,
    } as RequestContext;
    await telemetry.context.run(context, () => call('pronunciation'));
    expect(fetch.mock.calls[0][1].headers.get('X-Request-ID')).toBe(
      'safe-request',
    );
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(jest.getTimerCount()).toBe(1);
    controller.abort();
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
  });
  test('client cancellation aborts transport, releases permits, and never retries', async () => {
    config.set('PROVIDER_MAX_RETRIES', 1);
    const controller = new AbortController();
    fetch.mockImplementation(() => new Promise(() => {}));
    const pending = telemetry.context
      .run({ signal: controller.signal } as RequestContext, () => call())
      .catch((error) => error);
    controller.abort();
    expect(await pending).toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(1);
    fetch.mockResolvedValue(ok());
    await expect(call()).resolves.toEqual({ ok: true });
  });
  test('default retry count is zero; opt-in retries one transport failure within the same deadline', async () => {
    fetch.mockRejectedValueOnce(new TypeError('synthetic network failure'));
    await expect(call()).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    config.set('PROVIDER_MAX_RETRIES', 1);
    fetch.mockRejectedValueOnce(new TypeError('synthetic network failure'));
    const pending = call();
    await jest.advanceTimersByTimeAsync(301);
    await expect(pending).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  test('retry exhaustion stops at two actual attempts, charging both to 8C budget', async () => {
    config.set('PROVIDER_MAX_RETRIES', 1);
    fetch.mockRejectedValue(new TypeError('network failure'));
    const pending = call().catch((error) => error);
    await jest.advanceTimersByTimeAsync(301);
    expect(await pending).toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(fetch).toHaveBeenCalledTimes(2);
    // Two failed attempts consumed budget; sixteen more succeed, then two remaining.
    fetch.mockResolvedValue(ok());
    for (let n = 0; n < 18; n++) await call();
    await expect(call()).rejects.toBeInstanceOf(RateLimitError);
  });
  test.each([400, 401, 403, 404, 422])(
    'permanent provider HTTP %i is not retried or reflected',
    async (status) => {
      config.set('PROVIDER_MAX_RETRIES', 1);
      const text = jest.fn().mockResolvedValue('raw-private-provider-body');
      fetch.mockResolvedValue({ ok: false, status, text } as any);
      await expect(call()).rejects.toMatchObject({
        code: [401, 403].includes(status)
          ? 'PROVIDER_CONFIGURATION'
          : 'PROVIDER_REJECTED',
        retryable: false,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(text).not.toHaveBeenCalled();
    },
  );
  test('malformed provider JSON is classified and not retried', async () => {
    config.set('PROVIDER_MAX_RETRIES', 1);
    fetch.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('private body');
      },
    } as any);
    await expect(call()).rejects.toMatchObject({
      code: 'PROVIDER_INVALID_RESPONSE',
      retryable: false,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  test('429 long Retry-After is bounded and returned without an unbounded sleep', async () => {
    config.set('PROVIDER_MAX_RETRIES', 1);
    fetch.mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'Retry-After': '3600' }),
      text: () => {
        throw new Error('Do not read');
      },
    } as any);
    await expect(call()).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMITED',
      retryable: true,
      retryAfter: undefined,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
  });
  test('usable short Retry-After is honored inside total deadline', async () => {
    config.set('PROVIDER_CHAT_TIMEOUT_MS', 2000);
    config.set('PROVIDER_MAX_RETRIES', 1);
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ 'Retry-After': '1' }),
    } as any);
    const pending = call();
    await jest.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  test('unsafe timeout/retry configuration fails before any provider call', async () => {
    for (const value of [0, -1, 499, 60001, Infinity, 'invalid']) {
      config.set('PROVIDER_CHAT_TIMEOUT_MS', value);
      await expect(call()).rejects.toBeInstanceOf(ProviderFailure);
    }
    config.set('PROVIDER_CHAT_TIMEOUT_MS', 500);
    config.set('PROVIDER_MAX_RETRIES', 2);
    await expect(call()).rejects.toMatchObject({
      code: 'PROVIDER_CONFIGURATION',
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'test',
        MONGODB_URI: 'mongodb://localhost/test',
        JWT_SECRET: 'fixture',
        PROVIDER_CHAT_TIMEOUT_MS: '60001',
      }),
    ).toThrow('PROVIDER_CHAT_TIMEOUT_MS');
  });
});
