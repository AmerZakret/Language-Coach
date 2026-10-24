import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AuthModule } from '../auth/auth.module';
import { AiCoachModule } from '../ai-coach/ai-coach.module';
import { User } from '../users/schemas/user.schema';
import { ChatMessage } from '../ai-coach/schemas/chat-message.schema';
import { ChatBarrier } from '../ai-coach/schemas/chat-barrier.schema';
import { MutationReceipt } from '../common/mutation-receipt';
import { SecurityModule } from './security.module';
import { HttpSecurity } from './http-security';
import { FlashcardsModule } from '../flashcards/flashcards.module';
import { Flashcard } from '../flashcards/schemas/flashcard.schema';
import { telemetry } from '../operations/telemetry';

describe('8C provider budget with 7E durable transactions (disposable replica set)', () => {
  jest.setTimeout(120000);
  let replica: MongoMemoryReplSet, app: NestExpressApplication;
  let messages: Model<ChatMessage>, users: Model<User>;
  let provider: jest.SpyInstance;
  const call = (token: string, key: string, message = 'hello') =>
    request(app.getHttpServer())
      .post('/ai-coach/chat')
      .auth(token, { type: 'bearer' })
      .set('X-Idempotency-Key', key)
      .send({ message, language: 'en', targetLanguage: 'en' });
  const token = async (name: string, guest: boolean) => {
    const user = await users.create({
      name,
      email: `${name}@example.test`,
      passwordHash: 'fixture',
      isGuest: guest,
    });
    return app.get(JwtService).sign({
      sub: user._id.toString(),
      email: 'misleading@example.test',
      isGuest: !guest,
    });
  };
  beforeAll(async () => {
    replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MongooseModule.forRoot(replica.getUri()),
        SecurityModule,
        AuthModule,
        AiCoachModule,
        FlashcardsModule,
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          NODE_ENV: 'test',
          JWT_SECRET: randomUUID(),
          GEMINI_API_KEY: 'mock-key',
          AI_ENABLED: true,
          TRUST_PROXY: 'false',
        }),
      )
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    app.useLogger(false);
    app.get(HttpSecurity).install(app);
    app.get(HttpSecurity).installBodyParsers(app);
    users = module.get(getModelToken(User.name));
    messages = module.get(getModelToken(ChatMessage.name));
    await app.init();
    await Promise.all([
      users.init(),
      messages.init(),
      module.get<Model<Flashcard>>(getModelToken(Flashcard.name)).init(),
    ]);
    provider = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    reply: 'safe reply',
                    correction: 'hello',
                  }),
                },
              ],
            },
          },
        ],
      }),
    } as any);
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await replica?.stop();
  });
  test('a committed replay remains available after provider exhaustion without extra inference/pairs', async () => {
    const events = jest.spyOn(telemetry, 'emit');
    const a = await token('guest-a', true),
      b = await token('guest-b', true);
    const key = randomUUID();
    const first = await call(a, key).expect(201);
    for (let n = 0; n < 4; n++) await call(a, randomUUID()).expect(201);
    await call(a, randomUUID()).expect(429);
    expect(provider).toHaveBeenCalledTimes(5);
    // Lost acknowledgement replay may originate on a different device with this same JWT owner/key.
    const replay = await call(a, key).expect(201);
    expect(replay.body).toEqual(first.body);
    await call(a, key, 'changed')
      .expect(409)
      .expect((response) =>
        expect(response.body.code).toBe('IDEMPOTENCY_CONFLICT'),
      );
    expect(provider).toHaveBeenCalledTimes(5);
    expect(await messages.countDocuments()).toBe(10);
    for (const event of ['receipt.created', 'receipt.replay', 'receipt.conflict']) expect(events.mock.calls.some(([name]) => name === event)).toBe(true);
    await call(b, key).expect(201);
    expect(provider).toHaveBeenCalledTimes(6);
    expect(await messages.countDocuments()).toBe(12);
    expect(
      JSON.parse(String(provider.mock.calls[0][1]?.body)).generationConfig
        .maxOutputTokens,
    ).toBe(2048);
  });
  test('provider failures remain retryable/redacted and never leave history half-pairs or completed receipts', async () => {
    const c = await token('registered-c', false);
    const key = randomUUID();
    const before = await messages.countDocuments();
    provider.mockRejectedValueOnce(new Error(`/private/token-${randomUUID()}`));
    const response = await call(c, key).expect(503);
    expect(response.body).toEqual({
      statusCode: 503,
      code: 'PROVIDER_UNAVAILABLE',
      message: 'Provider is temporarily unavailable.',
    });
    expect(await messages.countDocuments()).toBe(before);
    expect(
      await app
        .get<Model<MutationReceipt>>(getModelToken(MutationReceipt.name))
        .countDocuments({ operationId: key }),
    ).toBe(0);
    await call(c, key).expect(201);
    expect(await messages.countDocuments()).toBe(before + 2);
    // Operational controls introduce no schema/TTL changes to durable lifecycle data.
    for (const name of [MutationReceipt.name, ChatBarrier.name]) {
      const indexes = await app
        .get<Model<any>>(getModelToken(name))
        .collection.indexes();
      expect(indexes.some((index) => 'expireAfterSeconds' in index)).toBe(
        false,
      );
    }
  });
  test('flashcard committed replay bypasses exhausted generation budget and creates no duplicate card', async () => {
    const ownerToken = await token('registered-flashcard', false);
    provider.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    sentences: ['hello'],
                    mnemonic: 'hint',
                  }),
                },
              ],
            },
          },
        ],
      }),
    } as any);
    const before = provider.mock.calls.length;
    const create = (key: string, word: string) =>
      request(app.getHttpServer())
        .post('/flashcards')
        .auth(ownerToken, { type: 'bearer' })
        .set('X-Idempotency-Key', key)
        .send({
          targetWord: word,
          turkishTranslation: 'merhaba',
          targetLanguage: 'en',
        });
    const key = randomUUID();
    const first = await create(key, 'first').expect(201);
    for (let n = 0; n < 9; n++)
      await create(randomUUID(), `other-${n}`).expect(201);
    await create(randomUUID(), 'denied').expect(429);
    const replay = await create(key, 'first').expect(201);
    expect(replay.body._id).toBe(first.body._id);
    expect(provider).toHaveBeenCalledTimes(before + 10);
    expect(
      await app
        .get<Model<Flashcard>>(getModelToken(Flashcard.name))
        .countDocuments(),
    ).toBe(10);
  });
});
