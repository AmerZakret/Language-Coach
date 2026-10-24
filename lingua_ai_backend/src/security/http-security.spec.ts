import {
  Body,
  Controller,
  Get,
  HttpException,
  Logger,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import { AuthController } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import { JwtStrategy } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { AiCoachController } from '../ai-coach/ai-coach.controller';
import { AiCoachService } from '../ai-coach/ai-coach.service';
import { CommunityController } from '../community/community.controller';
import { CommunityService } from '../community/community.service';
import { CommunityImageStorage } from '../community/community-image.storage';
import { configureCommunityUploadServing } from '../community/community-upload-serving';
import { FlashcardsController } from '../flashcards/flashcards.controller';
import { FlashcardsService } from '../flashcards/flashcards.service';
import { FlashcardIdempotencyService } from '../flashcards/flashcard-idempotency.service';
import { PronunciationController } from '../pronunciation/pronunciation.controller';
import { PronunciationService } from '../pronunciation/pronunciation.service';
import { HealthController } from '../operations/health.controller';
import { ReadinessService } from '../operations/readiness.service';
import {
  trustedProxyPolicy,
  validateEnvironment,
} from '../config/runtime-config';
import { SecurityModule } from './security.module';
import { HttpSecurity } from './http-security';
import { ProviderBudget } from './provider-budget';

const leak = `SENSITIVE_${randomUUID()}`;
@Controller('fixture')
class FailureController {
  @Get('error') fail(@Query('kind') kind: string) {
    if (kind === 'mongo')
      throw Object.assign(new Error(`E11000 private_index ${leak}`), {
        code: 11000,
      });
    if (kind === 'filesystem') throw new Error(`/private/storage/${leak}`);
    if (kind === 'provider')
      throw new HttpException({ message: leak, body: { token: leak } }, 502);
    if (kind === 'known')
      throw new HttpException(
        { code: 'IDEMPOTENCY_CONFLICT', message: leak, debug: leak },
        409,
      );
    if (kind === 'epoch')
      throw new HttpException(
        { code: 'STALE_RESET_EPOCH', message: leak },
        409,
      );
    throw new Error(`stack/token ${leak}`);
  }
  @Get('private') @UseGuards(JwtAuthGuard) privateResponse() {
    return { private: true };
  }
  @Get('public') publicResponse() {
    return { ok: true };
  }
  @Post('body') echo(@Body() body: unknown) {
    return body;
  }
}

describe('8C real HTTP policy pipeline (signed JWTs, disposable files, no external calls)', () => {
  let app: NestExpressApplication;
  let budget: ProviderBudget;
  let root: string;
  let images: CommunityImageStorage;
  let png: Buffer;
  let imageUrl: string;
  let priorRoot: string | undefined;
  let config: ConfigService;
  let users: Map<string, any>;
  const a = '000000000000000000000001',
    b = '000000000000000000000002';
  const guests = [
    '000000000000000000000003',
    '000000000000000000000004',
    '000000000000000000000005',
  ];
  let login: jest.Mock, create: jest.Mock, reaction: jest.Mock;
  const signed = (owner = a, extra = {}) =>
    app
      .get(JwtService)
      .sign({ sub: owner, email: 'misleading@example.test', ...extra });
  const auth = (r: any, owner = a) => r.auth(signed(owner), { type: 'bearer' });
  const chat = (owner = a) =>
    auth(request(app.getHttpServer()).post('/ai-coach/chat'), owner).send({
      message: 'hi',
      language: 'en',
      targetLanguage: 'en',
    });
  const post = () =>
    auth(request(app.getHttpServer()).post('/community/posts')).send({
      text: 'hi',
      learningLanguage: 'en',
    });
  beforeAll(async () => {
    priorRoot = process.env.UPLOAD_ROOT;
    root = await mkdtemp(join(tmpdir(), 'lingua-8c-http-'));
    process.env.UPLOAD_ROOT = root;
    images = new CommunityImageStorage();
    png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer();
    imageUrl = await images.store({
      buffer: png,
      originalname: 'fixture.png',
      mimetype: 'image/png',
    } as Express.Multer.File);
  });
  beforeEach(async () => {
    config = new ConfigService({
      NODE_ENV: 'production',
      JWT_SECRET: randomBytes(48).toString('hex'),
      CORS_ORIGINS: 'https://app.example.invalid',
      TRUST_PROXY: 'false',
    });
    users = new Map(
      [a, b, ...guests].map((id) => [
        id,
        { _id: id, id, name: 'fixture', isGuest: guests.includes(id) },
      ]),
    );
    login = jest.fn().mockResolvedValue({ token: 'fixture' });
    create = jest
      .fn()
      .mockResolvedValue({ _id: 'post', learningLanguage: 'en' });
    reaction = jest.fn().mockResolvedValue({ likesCount: 1, likedByMe: true });
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PassportModule,
        JwtModule.register({ secret: config.get<string>('JWT_SECRET') }),
        SecurityModule,
      ],
      controllers: [
        AuthController,
        AiCoachController,
        CommunityController,
        FlashcardsController,
        PronunciationController,
        HealthController,
        FailureController,
      ],
      providers: [
        JwtStrategy,
        {
          provide: UsersService,
          useValue: { findById: async (id: string) => users.get(id) },
        },
        {
          provide: AuthService,
          useValue: { login, register: login, guest: login },
        },
        {
          provide: AiCoachService,
          useValue: {
            sendMessage: () =>
              budget.run('chat', async () => ({ reply: 'ok' })),
            checkWriting: () =>
              budget.run('writing', async () => ({ score: 1 })),
            getHistory: () => [],
          },
        },
        {
          provide: CommunityService,
          useValue: {
            create,
            update: create,
            delete: create,
            setLike: reaction,
            findAll: () => [],
          },
        },
        {
          provide: FlashcardIdempotencyService,
          useValue: {
            execute: (_a: any, _b: any, _c: any, _d: any, work: any) => work(),
          },
        },
        {
          provide: FlashcardsService,
          useValue: {
            create: () =>
              budget.run('flashcard', async () => ({
                _id: 'card',
                targetLanguage: 'en',
              })),
          },
        },
        {
          provide: PronunciationService,
          useValue: {
            assess: () =>
              budget.run('pronunciation', async () => ({ score: 1 })),
          },
        },
        {
          provide: ReadinessService,
          useValue: {
            snapshot: () => ({
              status: 'not_ready',
              checks: { database: 'failed' },
            }),
          },
        },
        { provide: CommunityImageStorage, useValue: images },
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(config)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    app.useLogger(false);
    budget = app.get(ProviderBudget);
    app.get(HttpSecurity).install(app);
    app.get(HttpSecurity).installBodyParsers(app);
    configureCommunityUploadServing(app);
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    if (priorRoot === undefined) delete process.env.UPLOAD_ROOT;
    else process.env.UPLOAD_ROOT = priorRoot;
    const path = relative(tmpdir(), root);
    if (isAbsolute(path) || !path.startsWith('lingua-8c-http-'))
      throw new Error('Unsafe disposable cleanup');
    await rm(root, { recursive: true, force: true });
  });

  test.each([
    [
      'login',
      10,
      { email: 'fixture@example.test', password: 'valid-password' },
    ],
    [
      'register',
      5,
      {
        name: 'fixture',
        email: 'fixture@example.test',
        password: 'valid-password',
      },
    ],
    ['guest', 3, {}],
  ])(
    '%s limit survives successful auth and spoofed forwarded IPs',
    async (route, maximum, body) => {
      for (let n = 0; n < maximum; n++)
        await request(app.getHttpServer())
          .post(`/auth/${route}`)
          .set('X-Forwarded-For', `198.51.100.${n + 1}`)
          .send(body)
          .expect(201);
      const response = await request(app.getHttpServer())
        .post(`/auth/${route}`)
        .set('X-Forwarded-For', '203.0.113.99')
        .send(body)
        .expect(429);
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
      expect(response.body).toEqual({
        statusCode: 429,
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please retry later.',
      });
      expect(login).toHaveBeenCalledTimes(maximum);
      expect(JSON.stringify(response.body)).not.toMatch(
        /198\.51|203\.0|owner|bucket/,
      );
    },
  );
  test('owner provider budgets use JWT sub, not email/forged guest claims, and are independent', async () => {
    for (let n = 0; n < 20; n++) await chat().expect(201);
    await chat().expect(429);
    await chat(b).expect(201);
    // Guest status is loaded from the database profile, not a token claim.
    for (let n = 0; n < 5; n++)
      await auth(request(app.getHttpServer()).post('/ai-coach/chat'), guests[0])
        .send({ message: 'hi', language: 'en' })
        .expect(201);
    await request(app.getHttpServer())
      .post('/ai-coach/chat')
      .auth(signed(guests[0], { isGuest: false }), { type: 'bearer' })
      .send({ message: 'hi', language: 'en' })
      .expect(429);
    await request(app.getHttpServer())
      .post('/ai-coach/chat')
      .send({ userId: a, message: 'hi' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/ai-coach/chat')
      .auth(signed('local_guest'), { type: 'bearer' })
      .send({ message: 'hi' })
      .expect(401);
  });
  test('rotating unique guests on one IP cannot bypass shared guest provider budget', async () => {
    for (const guest of guests.slice(0, 2))
      for (let n = 0; n < 5; n++) await chat(guest).expect(201);
    await chat(guests[2]).expect(429);
    await chat().expect(201);
  });
  test('registered owner changes cannot bypass the shared provider IP ceiling', async () => {
    for (let n = 0; n < 20; n++) await chat().expect(201);
    for (let n = 0; n < 10; n++) await chat(b).expect(201);
    await chat(b).expect(429);
  });
  test('guest creation has a process budget across distinct client IPs', async () => {
    app
      .getHttpAdapter()
      .getInstance()
      .set('trust proxy', trustedProxyPolicy('127.0.0.1/32,::1/128'));
    for (let n = 0; n < 100; n++)
      await request(app.getHttpServer())
        .post('/auth/guest')
        .set('X-Forwarded-For', `198.51.100.${n + 1}`)
        .expect(201);
    await request(app.getHttpServer())
      .post('/auth/guest')
      .set('X-Forwarded-For', '203.0.113.1')
      .expect(429);
    expect(login).toHaveBeenCalledTimes(100);
  });
  test('writing and flashcard generation have endpoint-specific cost ceilings', async () => {
    for (let n = 0; n < 5; n++)
      await auth(request(app.getHttpServer()).post('/ai-coach/writing-check'))
        .send({
          topic: 'topic',
          text: 'hello',
          language: 'en',
          targetLanguage: 'en',
        })
        .expect(201);
    await auth(request(app.getHttpServer()).post('/ai-coach/writing-check'))
      .send({
        topic: 'topic',
        text: 'hello',
        language: 'en',
        targetLanguage: 'en',
      })
      .expect(429);
    for (let n = 0; n < 10; n++)
      await auth(request(app.getHttpServer()).post('/flashcards'))
        .send({
          targetWord: 'hello',
          turkishTranslation: 'merhaba',
          targetLanguage: 'en',
        })
        .expect(201);
    await auth(request(app.getHttpServer()).post('/flashcards'))
      .send({
        targetWord: 'hello',
        turkishTranslation: 'merhaba',
        targetLanguage: 'en',
      })
      .expect(429);
  });
  test('pronunciation proxy has an independent endpoint ceiling', async () => {
    const audio = () =>
      auth(request(app.getHttpServer()).post('/pronunciation/assess'))
        .field('targetText', 'hello')
        .field('targetLanguage', 'en')
        .attach('audio', Buffer.from('fixture'), 'fixture.wav');
    for (let n = 0; n < 6; n++) await audio().expect(201);
    await audio().expect(429);
  });
  test('Community write/upload and reaction policies are wired to actual controllers', async () => {
    const upload = () =>
      auth(request(app.getHttpServer()).post('/community/posts'))
        .field('learningLanguage', 'en')
        .field('text', 'hi')
        .attach('image', png, 'image.png');
    for (let n = 0; n < 10; n++) await upload().expect(201);
    await upload().expect(429);
    for (let n = 0; n < 10; n++) await post().expect(201);
    await post().expect(429);
    for (let n = 0; n < 60; n++)
      await auth(
        request(app.getHttpServer()).post('/community/posts/post/like'),
      )
        .send({ liked: true })
        .expect(201);
    await auth(request(app.getHttpServer()).post('/community/posts/post/like'))
      .send({ liked: false })
      .expect(429);
    expect(create).toHaveBeenCalledTimes(20);
    expect(reaction).toHaveBeenCalledTimes(60);
  });
  test('general IP ceiling cannot be bypassed by switching authenticated owners; health stays usable', async () => {
    for (let n = 0; n < 240; n++)
      await auth(
        request(app.getHttpServer()).get('/fixture/private'),
        n % 2 ? a : b,
      ).expect(200);
    const limited = await request(app.getHttpServer())
      .get('/fixture/public')
      .set('Origin', 'https://app.example.invalid')
      .expect(429);
    expect(limited.headers['access-control-allow-origin']).toBe(
      'https://app.example.invalid',
    );
    expect(limited.headers['access-control-expose-headers']).toContain(
      'Retry-After',
    );
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    await auth(request(app.getHttpServer()).get('/fixture/private'), b).expect(
      429,
    );
    for (let n = 0; n < 3; n++) {
      await request(app.getHttpServer()).get('/HEALTH/live/').expect(200);
      const result = await request(app.getHttpServer())
        .get('/health/ready')
        .expect(503);
      expect(result.body).toEqual({
        status: 'not_ready',
        checks: { database: 'failed' },
      });
    }
  });
  test('general owner ceiling is stricter than IP ceiling', async () => {
    for (let n = 0; n < 180; n++)
      await auth(request(app.getHttpServer()).get('/fixture/private')).expect(
        200,
      );
    await auth(request(app.getHttpServer()).get('/fixture/private')).expect(
      429,
    );
    await auth(request(app.getHttpServer()).get('/fixture/private'), b).expect(
      200,
    );
  });
  test('production CORS accepts exact origins and rejects browser work before controller execution', async () => {
    const origin = 'https://app.example.invalid';
    const allowed = await request(app.getHttpServer())
      .get('/fixture/public')
      .set('Origin', origin)
      .expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe(origin);
    expect(allowed.headers['access-control-allow-credentials']).toBeUndefined();
    await request(app.getHttpServer())
      .post('/auth/guest')
      .set('Origin', 'https://evil.example.invalid')
      .expect(403);
    expect(login).not.toHaveBeenCalled();
    await request(app.getHttpServer()).get('/fixture/public').expect(200);
    const preflight = await request(app.getHttpServer())
      .options('/community/posts')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'PUT')
      .set(
        'Access-Control-Request-Headers',
        'Authorization,Content-Type,X-Idempotency-Key,X-Resource-Revision',
      )
      .expect(204);
    expect(
      preflight.headers['access-control-allow-headers'].toLowerCase(),
    ).toContain('x-idempotency-key');
    expect(
      preflight.headers['access-control-allow-headers'].toLowerCase(),
    ).toContain('x-resource-revision');
    expect(
      preflight.headers['access-control-allow-credentials'],
    ).toBeUndefined();
    expect(allowed.headers.vary).toContain('Origin');
  });
  test('development localhost remains usable; production wildcard and arbitrary proxy trust fail config validation', async () => {
    config.set('NODE_ENV', 'development');
    await request(app.getHttpServer())
      .get('/fixture/public')
      .set('Origin', 'http://localhost:5173')
      .expect(200);
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        MONGODB_URI: 'mongodb://db.example.invalid/test',
        JWT_SECRET: randomBytes(48).toString('hex'),
        AI_ENABLED: false,
        PRONUNCIATION_ENABLED: false,
        CORS_ORIGINS: '*',
        UPLOAD_ROOT: process.cwd(),
      }),
    ).toThrow('CORS_ORIGINS');
    for (const value of [
      'true',
      '1',
      '0.0.0.0/0',
      '::/0',
      'loopback',
      'arbitrary-secret',
    ]) {
      expect(() => trustedProxyPolicy(value)).toThrow('TRUST_PROXY');
      try {
        trustedProxyPolicy(value);
      } catch (error) {
        expect(String(error)).not.toContain(value);
      }
    }
    expect(trustedProxyPolicy('10.0.0.0/8, ::1/128')).toEqual([
      '10.0.0.0/8',
      '::1/128',
    ]);
  });
  test('explicitly trusted ingress supplies client IP; disabled trust ignores forwarded headers', async () => {
    app
      .getHttpAdapter()
      .getInstance()
      .set('trust proxy', trustedProxyPolicy('127.0.0.1/32,::1/128'));
    for (let n = 0; n < 10; n++)
      await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', '198.51.100.1')
        .send({ email: 'fixture@example.test', password: 'valid' })
        .expect(201);
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '198.51.100.1')
      .send({ email: 'fixture@example.test', password: 'valid' })
      .expect(429);
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '198.51.100.2')
      .send({ email: 'fixture@example.test', password: 'valid' })
      .expect(201);
  });
  test('private APIs are no-store while validated static images retain normal image caching', async () => {
    const api = await auth(
      request(app.getHttpServer()).get('/fixture/private'),
    ).expect(200);
    const image = await request(app.getHttpServer()).get(imageUrl).expect(200);
    expect(api.headers['cache-control']).toBe('no-store');
    expect(image.headers['cache-control']).not.toContain('no-store');
    expect(image.headers['content-type']).toContain('image/png');
    for (const response of [api, image]) {
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['content-security-policy']).toBe(
        "frame-ancestors 'none'",
      );
      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.headers['strict-transport-security']).toBeUndefined();
    }
  });
  test.each([
    ['unknown', 500],
    ['mongo', 409],
    ['filesystem', 500],
    ['provider', 502],
    ['known', 409],
    ['epoch', 409],
  ])(
    '%s errors are redacted with useful safe status/code',
    async (kind, status) => {
      const logs = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      const response = await request(app.getHttpServer())
        .get('/fixture/error')
        .query({ kind })
        .expect(status);
      const text = JSON.stringify(response.body);
      expect(text).not.toContain(leak);
      expect(text).not.toMatch(/private_index|\/private|stack|token|debug/);
      expect(response.body).toEqual({
        statusCode: status,
        code: expect.any(String),
        message: expect.any(String),
      });
      if (kind === 'known')
        expect(response.body.code).toBe('IDEMPOTENCY_CONFLICT');
      if (kind === 'epoch')
        expect(response.body.code).toBe('STALE_RESET_EPOCH');
      expect(JSON.stringify(logs.mock.calls)).not.toContain(leak);
    },
  );
  test('body parsers reject oversized, compressed and malformed requests safely', async () => {
    const large = await request(app.getHttpServer())
      .post('/fixture/body')
      .send({ text: leak.repeat(2000) })
      .expect(413);
    expect(large.body.code).toBe('PAYLOAD_TOO_LARGE');
    expect(JSON.stringify(large.body)).not.toContain(leak);
    await request(app.getHttpServer())
      .post('/fixture/body')
      .set('Content-Type', 'application/json')
      .send('{broken')
      .expect(400);
    await request(app.getHttpServer())
      .post('/fixture/body')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'gzip')
      .send('{}')
      .expect(415);
    await request(app.getHttpServer())
      .post('/fixture/body')
      .type('form')
      .send({ text: 'x'.repeat(17000) })
      .expect(413);
    await request(app.getHttpServer())
      .post('/fixture/body')
      .type('form')
      .send(
        Object.fromEntries(
          Array.from({ length: 51 }, (_, i) => [`field${i}`, 'x']),
        ),
      )
      .expect(413);
  });
  test.each([
    ['/ai-coach/chat', { message: 'x'.repeat(501), language: 'en' }],
    [
      '/ai-coach/writing-check',
      {
        topic: 'topic',
        text: 'x'.repeat(1001),
        language: 'en',
        targetLanguage: 'en',
      },
    ],
    [
      '/ai-coach/writing-check',
      {
        topic: 'x'.repeat(201),
        text: 'text',
        language: 'en',
        targetLanguage: 'en',
      },
    ],
    ['/community/posts', { text: 'x'.repeat(1001), learningLanguage: 'en' }],
    [
      '/flashcards',
      {
        targetWord: 'hello',
        turkishTranslation: 'merhaba',
        targetLanguage: 'en',
        nativeLanguage: 'x'.repeat(65),
      },
    ],
    [
      '/flashcards',
      {
        targetWord: 'hello',
        turkishTranslation: 'merhaba',
        targetLanguage: 'en',
        exampleSentence: 'x'.repeat(501),
      },
    ],
    ['/ai-coach/chat', { message: 'hi', language: 'en', userId: leak }],
  ])(
    'rejects oversized/unsafe DTO for %s without reflected field/object dumps',
    async (route, body) => {
      const response = await auth(request(app.getHttpServer()).post(route))
        .send(body)
        .expect(400);
      expect(response.body).toEqual({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: 'Input validation failed.',
      });
    },
  );
  test('Community pagination is bounded without silently truncating requested limits', async () => {
    await auth(request(app.getHttpServer()).get('/community/posts'))
      .query({ page: 1, limit: 50 })
      .expect(200);
    for (const query of [
      { page: 1, limit: 51 },
      { page: 10001 },
      { limit: -1 },
      { limit: '10garbage' },
    ])
      await auth(request(app.getHttpServer()).get('/community/posts'))
        .query(query)
        .expect(400);
  });
  test('multipart concurrency is bounded before controller work and releases on completion', async () => {
    let started!: () => void, finish!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    create.mockImplementationOnce(async () => {
      started();
      await held;
      return { learningLanguage: 'en' };
    });
    const upload = () =>
      auth(request(app.getHttpServer()).post('/community/posts'))
        .field('learningLanguage', 'en')
        .attach('image', png, 'image.png');
    const first = upload().then((response) => response);
    await entered;
    try {
      await upload().expect(429);
      expect(create).toHaveBeenCalledTimes(1);
    } finally {
      finish();
      await first;
    }
    await upload().expect(201);
  });
  test('oversized pronunciation multipart input is rejected with permits released', async () => {
    const audio = () =>
      auth(request(app.getHttpServer()).post('/pronunciation/assess'));
    await audio()
      .field('targetText', 'x'.repeat(1001))
      .field('targetLanguage', 'en')
      .attach('audio', Buffer.from('fixture'), 'fixture.wav')
      .expect(400);
    await audio()
      .field('targetText', 'hello')
      .field('targetLanguage', 'en')
      .attach('audio', Buffer.alloc(10 * 1024 * 1024 + 1), 'fixture.wav')
      .expect(413);
    await audio()
      .field('targetText', 'hello')
      .field('targetLanguage', 'en')
      .field('sourceType', 'manual')
      .field('nativeLanguage', 'tr')
      .field('nativeTranslation', 'Merhaba')
      .attach('audio', Buffer.from('fixture'), 'fixture.wav')
      .expect(201);
  });
});
