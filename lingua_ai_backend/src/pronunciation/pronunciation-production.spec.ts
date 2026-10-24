import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PronunciationService } from './pronunciation.service';
import {
  validateEnvironment,
  safeConfigSummary,
} from '../config/runtime-config';
import {
  OperationalTelemetry,
  telemetry,
  RequestContext,
} from '../operations/telemetry';

describe('8E internal pronunciation authentication (mocked HTTP only)', () => {
  const credential = () => randomBytes(32).toString('hex');
  const production = (overrides = {}) => ({
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb://db.example.invalid/language',
    JWT_SECRET: credential(),
    AI_ENABLED: 'false',
    PRONUNCIATION_ENABLED: 'true',
    PRONUNCIATION_SERVICE_URL: 'https://whisper.internal',
    CORS_ORIGINS: 'https://web.example.invalid',
    UPLOAD_ROOT: resolve('persistent-uploads'),
    ...overrides,
  });
  const file = {
    buffer: Buffer.from('mock-audio'),
    mimetype: 'audio/wav',
    originalname: 'audio.wav',
  } as Express.Multer.File;
  const dto = { targetText: 'hello', targetLanguage: 'en' };
  const success = () =>
    ({
      ok: true,
      json: async () => ({
        recognizedText: 'hello',
        detectedLanguage: 'en',
        languageProbability: 1,
      }),
    }) as Response;
  afterEach(() => jest.restoreAllMocks());

  test('enabled production requires separate strong token without revealing supplied values', () => {
    const jwt = credential();
    for (const token of [
      undefined,
      '',
      'short',
      'a'.repeat(64),
      'placeholder'.repeat(5),
      jwt,
      credential() + '\n',
    ]) {
      try {
        validateEnvironment(
          production({ JWT_SECRET: jwt, PRONUNCIATION_SERVICE_TOKEN: token }),
        );
        throw new Error('Expected configuration rejection');
      } catch (error) {
        expect(error.message).toContain('PRONUNCIATION_SERVICE_TOKEN');
        if (token) expect(error.message).not.toContain(token);
      }
    }
    expect(
      validateEnvironment(production({ PRONUNCIATION_ENABLED: 'false' }))
        .PRONUNCIATION_ENABLED,
    ).toBe(false);
  });

  test('token omitted from safe startup summary and explicitly registered for redaction', () => {
    const token = credential();
    const config = new ConfigService(
      validateEnvironment(production({ PRONUNCIATION_SERVICE_TOKEN: token })),
    );
    expect(JSON.stringify(safeConfigSummary(config))).not.toContain(token);
    const lines: string[] = [];
    const logger = new OperationalTelemetry((line) => lines.push(line));
    logger.configure(config);
    logger.emit('provider.configuration', { message: token });
    expect(lines.join()).not.toContain(token);
    expect(lines.join()).toContain('[REDACTED]');
  });

  test('backend forwards dedicated credential and request ID only to transcriber; scores unchanged', async () => {
    const token = credential();
    const config = new ConfigService(
      validateEnvironment(
        production({
          PRONUNCIATION_SERVICE_TOKEN: token,
          AI_ENABLED: 'true',
          GEMINI_API_KEY: credential(),
        }),
      ),
    );
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(success())
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Good work.' }] } }],
        }),
      } as Response);
    const context = {
      requestId: 'backend-request-1',
      signal: new AbortController().signal,
    } as RequestContext;
    const result = await telemetry.context.run(context, () =>
      new PronunciationService(config).assess(file, dto),
    );
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://whisper.internal/transcribe');
    const headers = new Headers(init?.headers);
    expect(headers.get('X-Service-Token')).toBe(token);
    expect(headers.get('X-Request-ID')).toBe('backend-request-1');
    expect(headers.get('Authorization')).toBeNull();
    expect(init?.redirect).toBe('error');
    expect((init?.body as FormData).get('language')).toBe('en');
    expect(
      new Headers(fetch.mock.calls[1][1]?.headers).get('X-Service-Token'),
    ).toBeNull();
    expect(result).toMatchObject({
      pronunciationScore: 100,
      recognizedText: 'hello',
      result: 'correct',
    });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  test.each([
    [429, 'PROVIDER_RATE_LIMITED'],
    [504, 'PROVIDER_TIMEOUT'],
    [401, 'PROVIDER_CONFIGURATION'],
    [403, 'PROVIDER_CONFIGURATION'],
    [503, 'PROVIDER_UNAVAILABLE'],
  ])('HTTP %i maps to safe %s without raw body', async (status, code) => {
    const token = credential();
    const config = new ConfigService(
      validateEnvironment(production({ PRONUNCIATION_SERVICE_TOKEN: token })),
    );
    const text = jest.fn().mockResolvedValue(token);
    const json = jest.fn().mockResolvedValue({ raw: token });
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status, text, json } as any);
    await expect(
      new PronunciationService(config).assess(file, dto),
    ).rejects.toMatchObject({ response: { code }, status: 503 });
    expect(text).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });

  test('service timeout is not retried even when the optional transport retry is enabled', async () => {
    const config = new ConfigService(
      validateEnvironment(
        production({
          PRONUNCIATION_SERVICE_TOKEN: credential(),
          PROVIDER_MAX_RETRIES: '1',
        }),
      ),
    );
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status: 504 } as Response);
    await expect(
      new PronunciationService(config).assess(file, dto),
    ).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('unvalidated production module fails closed without token before network', async () => {
    const fetch = jest.spyOn(global, 'fetch');
    await expect(
      new PronunciationService(
        new ConfigService({ NODE_ENV: 'production' }),
      ).assess(file, dto),
    ).rejects.toMatchObject({ code: 'PROVIDER_CONFIGURATION' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
