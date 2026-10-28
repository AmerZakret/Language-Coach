import { CommunityImageStorage } from '../community/community-image.storage';
import { initializeTestTimeline } from '../../test/timeline-fixture';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Model, mongo as mongoDriver } from 'mongoose';
import request from 'supertest';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { AuthModule } from '../auth/auth.module';
import { CommunityModule } from '../community/community.module';
import { CommunityPost } from '../community/schemas/community-post.schema';
import { AiCoachModule } from '../ai-coach/ai-coach.module';
import { ChatMessage } from '../ai-coach/schemas/chat-message.schema';
import { ChatBarrier } from '../ai-coach/schemas/chat-barrier.schema';
import { User } from '../users/schemas/user.schema';
import { MutationReceipt } from './mutation-receipt';

describe('7E authoritative mutations (disposable replica set)', () => {
  jest.setTimeout(120000);
  let app: INestApplication, mongo: MongoMemoryReplSet, root: string;
  let priorRoot: string | undefined;
  let users: Model<User>,
    posts: Model<CommunityPost>,
    messages: Model<ChatMessage>,
    receipts: Model<MutationReceipt>;
  let a: string, b: string, tokenA: string, tokenB: string, png: Buffer;
  let provider: jest.SpyInstance;
  const auth = (r: request.Test, token = tokenA, key = randomUUID()) =>
    r.auth(token, { type: 'bearer' }).set('X-Idempotency-Key', key);
  const create = (key = randomUUID(), text = 'post', token = tokenA) =>
    auth(
      request(app.getHttpServer() as import('node:http').Server).post(
        '/community/posts',
      ),
      token,
      key,
    ).send({ learningLanguage: 'en', text });
  const like = (
    id: string,
    liked: boolean,
    key = randomUUID(),
    token = tokenA,
  ) =>
    auth(
      request(app.getHttpServer() as import('node:http').Server).post(
        `/community/posts/${id}/like`,
      ),
      token,
      key,
    ).send({ liked });
  const edit = (
    id: string,
    revision: number,
    text: string,
    key = randomUUID(),
  ) =>
    auth(
      request(app.getHttpServer() as import('node:http').Server).put(
        `/community/posts/${id}`,
      ),
      tokenA,
      key,
    ).send({ expectedRevision: revision, text });
  const remove = (
    id: string,
    revision: number,
    key = randomUUID(),
    token = tokenA,
  ) =>
    auth(
      request(app.getHttpServer() as import('node:http').Server).delete(
        `/community/posts/${id}`,
      ),
      token,
      key,
    ).set('X-Resource-Revision', String(revision));
  const send = (
    key = randomUUID(),
    message = 'hello',
    language = 'en',
    token = tokenA,
  ) =>
    auth(
      request(app.getHttpServer() as import('node:http').Server).post(
        '/ai-coach/chat',
      ),
      token,
      key,
    ).send({
      message,
      language: 'en',
      targetLanguage: language,
    });
  const clear = (key = randomUUID(), language = 'en', token = tokenA) =>
    auth(
      request(app.getHttpServer() as import('node:http').Server).delete(
        '/ai-coach/clear',
      ),
      token,
      key,
    ).query({ targetLanguage: language });
  const invariant = async (id: string) => {
    const post = (await posts.findById(id))!;
    expect(post.likesCount).toBe(new Set(post.likes).size);
    expect(post.likesCount).toBeGreaterThanOrEqual(0);
    return post;
  };
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'lingua-7e-'));
    priorRoot = process.env.UPLOAD_ROOT;
    process.env.UPLOAD_ROOT = root;
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MongooseModule.forRoot(mongo.getUri()),
        AuthModule,
        CommunityModule,
        AiCoachModule,
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          JWT_SECRET: randomUUID(),
          GEMINI_API_KEY: 'disposable-mock-key',
        }),
      )
      .compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    users = module.get(getModelToken(User.name));
    posts = module.get(getModelToken(CommunityPost.name));
    messages = module.get(getModelToken(ChatMessage.name));
    receipts = module.get(getModelToken(MutationReceipt.name));
    await app.init();
    await initializeTestTimeline(app);
    await Promise.all([users.init(), posts.init(), messages.init()]);
    png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer();
  });
  beforeEach(async () => {
    await Promise.all([
      users.deleteMany({}),
      posts.deleteMany({}),
      messages.deleteMany({}),
      receipts.deleteMany({}),
      app
        .get<Model<ChatBarrier>>(getModelToken(ChatBarrier.name))
        .deleteMany({}),
    ]);
    a = (
      await users.create({
        name: 'A',
        email: 'a@example.test',
        passwordHash: 'fixture',
      })
    )._id.toString();
    b = (
      await users.create({
        name: 'B',
        email: 'b@example.test',
        passwordHash: 'fixture',
      })
    )._id.toString();
    // Deliberately misleading emails: identity must come from JWT sub.
    tokenA = app.get(JwtService).sign({ sub: a, email: 'b@example.test' });
    tokenB = app.get(JwtService).sign({ sub: b, email: 'a@example.test' });
    provider = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      reply: 'reply',
                      correction: 'hello',
                    }),
                  },
                ],
              },
            },
          ],
        }),
    });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
    if (priorRoot === undefined) delete process.env.UPLOAD_ROOT;
    else process.env.UPLOAD_ROOT = priorRoot;
    if (root) {
      if (!resolve(root).startsWith(`${resolve(tmpdir())}${sep}lingua-7e-`))
        throw new Error('Unsafe disposable cleanup');
      await rm(root, { recursive: true, force: true });
    }
  });

  it('A/B/E/F/G: duplicate desired like/unlike and lost ack preserve exact membership/count', async () => {
    const id = ((await create().expect(201)).body as { _id: string })._id;
    await Promise.all([
      like(id, true, 'same-like').expect(201),
      like(id, true, 'same-like').expect(201),
    ]);
    expect((await invariant(id)).likesCount).toBe(1);
    await like(id, true, 'other-intent').expect(201);
    expect((await invariant(id)).likesCount).toBe(1);
    await Promise.all([
      like(id, false, 'same-unlike').expect(201),
      like(id, false, 'same-unlike').expect(201),
    ]);
    await like(id, false).expect(201);
    expect((await invariant(id)).likesCount).toBe(0);
  });
  it('C: different users concurrently like without losing either membership', async () => {
    const id = ((await create().expect(201)).body as { _id: string })._id;
    await Promise.all([
      like(id, true, 'same-key', tokenA).expect(201),
      like(id, true, 'same-key', tokenB).expect(201),
    ]);
    expect((await invariant(id)).likes.sort()).toEqual([a, b].sort());
  });
  it('F/G: a reaction repairs legacy duplicate memberships and inconsistent negative count', async () => {
    const id = ((await create().expect(201)).body as { _id: string })._id;
    await posts.updateOne(
      { _id: id },
      { $set: { likes: [a, a, b], likesCount: -10 } },
    );
    await like(id, false).expect(201);
    expect((await invariant(id)).likes).toEqual([b]);
    expect((await invariant(id)).likesCount).toBe(1);
  });
  it('D/E: concurrent opposite states serialize; an old lost-ack replay cannot invert the winner', async () => {
    const id = ((await create().expect(201)).body as { _id: string })._id;
    await Promise.all([
      like(id, true, 'on').expect(201),
      like(id, false, 'off').expect(201),
    ]);
    const before = (await invariant(id)).toObject();
    await like(id, true, 'on').expect(201);
    await like(id, false, 'off').expect(201);
    expect((await invariant(id)).toObject()).toEqual(before);
  });
  it('H/J/M: concurrent create retries create one post, changed payload conflicts, owners isolate keys', async () => {
    const [first, second] = await Promise.all([
      create('create').expect(201),
      create('create').expect(201),
    ]);
    expect((first.body as { _id: string })._id).toBe(
      (second.body as { _id: string })._id,
    );
    expect(await posts.countDocuments()).toBe(1);
    expect(
      ((await create('create', 'changed').expect(409)).body as { code: string })
        .code,
    ).toBe('IDEMPOTENCY_CONFLICT');
    expect(
      (
        (await create('create', 'post', tokenB).expect(201)).body as {
          userId: string;
        }
      ).userId,
    ).toBe(b);
    expect(await posts.countDocuments()).toBe(2);
  });
  it('I: image replay with another upload basename creates one permanent image and post', async () => {
    const imageCreate = (name: string) =>
      auth(
        request(app.getHttpServer() as import('node:http').Server).post(
          '/community/posts',
        ),
        tokenA,
        'image',
      )
        .field('learningLanguage', 'en')
        .attach('image', png, name);
    const [first, second] = await Promise.all([
      imageCreate('one.png').expect(201),
      imageCreate('two.png').expect(201),
    ]);
    expect((first.body as { _id: string })._id).toBe(
      (second.body as { _id: string })._id,
    );
    expect(
      (await readdir(join(root, 'community'))).filter(
        (name) =>
          name ===
          (first.body as { imageUrl: string }).imageUrl.split('/').pop(),
      ),
    ).toHaveLength(1);
    expect(await readdir(join(root, 'community'))).toHaveLength(1);
    expect(await posts.countDocuments()).toBe(1);
    const store = jest.spyOn(app.get(CommunityImageStorage), 'store');
    await imageCreate('late.png').expect(201);
    expect(store).not.toHaveBeenCalled();
    const changed = await sharp(png).negate().png().toBuffer();
    await auth(
      request(app.getHttpServer() as import('node:http').Server).post(
        '/community/posts',
      ),
      tokenA,
      'image',
    )
      .field('learningLanguage', 'en')
      .attach('image', changed, 'changed.png')
      .expect(409);
    expect(store).not.toHaveBeenCalled();
  });
  it('K: edit replay never overwrites a later revision; competing edits reject stale revision', async () => {
    const id = ((await create().expect(201)).body as { _id: string })._id;
    await edit(id, 0, 'old', 'old-edit').expect(200);
    await edit(id, 1, 'new', 'new-edit').expect(200);
    await edit(id, 0, 'old', 'old-edit').expect(200);
    expect((await posts.findById(id))!.text).toBe('new');
    expect(
      ((await edit(id, 0, 'stale').expect(409)).body as { code: string }).code,
    ).toBe('STALE_RESOURCE_REVISION');
    expect(
      (
        (await edit(id, 0, 'changed', 'old-edit').expect(409)).body as {
          code: string;
        }
      ).code,
    ).toBe('IDEMPOTENCY_CONFLICT');
    expect(
      ((await remove(id, 0).expect(409)).body as { code: string }).code,
    ).toBe('STALE_RESOURCE_REVISION');
    expect((await posts.findById(id))!.text).toBe('new');
  });
  it('L/M: delete receipts prove success; absence and foreign IDs alone do not', async () => {
    const original = (await create().expect(201)).body;
    await remove(original._id, 0, 'delete').expect(200);
    await remove(original._id, 0, 'delete').expect(200);
    await remove(original._id, 0, 'fresh').expect(404);
    await remove(original._id, 0, 'delete', tokenB).expect(404);
    // Even explicit restoration at the same ID must survive an old delete replay.
    await posts.create({ ...original, text: 'restored' });
    await remove(original._id, 0, 'delete').expect(200);
    expect((await posts.findById(original._id))!.text).toBe('restored');
    await remove(original._id, 0, 'foreign', tokenB).expect(403);
  });
  it('Q/S/T: concurrent and very late sends return one durable pair, invoking provider once', async () => {
    const [first, second] = await Promise.all([
      send('send').expect(201),
      send('send').expect(201),
    ]);
    expect(first.body).toEqual(second.body);
    expect(await messages.countDocuments()).toBe(2);
    await receipts.updateMany(
      {},
      { $set: { createdAt: new Date('2000-01-01') } },
    );
    expect((await send('send').expect(201)).body).toEqual(first.body);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it('R/AA: payload/language conflicts safely, the same operation ID belongs separately to each owner', async () => {
    await send('key').expect(201);
    expect(
      ((await send('key', 'changed').expect(409)).body as { code: string })
        .code,
    ).toBe('IDEMPOTENCY_CONFLICT');
    expect(
      ((await send('key', 'hello', 'de').expect(409)).body as { code: string })
        .code,
    ).toBe('IDEMPOTENCY_CONFLICT');
    expect(
      (
        (await send('key', 'hello', 'en', tokenB).expect(201)).body as {
          userMessage: { userId: string };
        }
      ).userMessage.userId,
    ).toBe(b);
    expect(await messages.countDocuments({ userId: a })).toBe(2);
    expect(await messages.countDocuments({ userId: b })).toBe(2);
  });
  it('U/V: failed assistant persistence rolls back user and receipt; retry completes one pair', async () => {
    const save = messages.prototype.save;
    const fault = jest
      .spyOn(messages.prototype, 'save')
      .mockImplementation(function (this: ChatMessage, ...args: unknown[]) {
        if (this.role === 'assistant')
          throw new Error('Injected persistence failure');
        return Reflect.apply(
          save as (...values: unknown[]) => Promise<ChatMessage>,
          this,
          args,
        );
      });
    expect(
      ((await send('db-fail').expect(503)).body as { code: string }).code,
    ).toBe('RETRYABLE_SERVER_FAILURE');
    expect(await messages.countDocuments()).toBe(0);
    expect(await receipts.countDocuments({ operationType: 'ai-send' })).toBe(0);
    fault.mockRestore();
    await send('db-fail').expect(201);
    expect(await messages.countDocuments()).toBe(2);
  });
  it('receipt completion failure rolls back the entire pair and permits safe retry', async () => {
    const fault = jest.spyOn(receipts, 'updateOne').mockImplementationOnce(
      () =>
        ({
          exec: () => Promise.reject(new Error('Receipt completion failed')),
        }) as unknown as ReturnType<typeof receipts.updateOne>,
    );
    await send('receipt-fail').expect(503);
    expect(await messages.countDocuments()).toBe(0);
    expect(await receipts.countDocuments()).toBe(0);
    fault.mockRestore();
    await send('receipt-fail').expect(201);
    expect(await messages.countDocuments()).toBe(2);
  });
  it('transient transaction retry reuses generated provider content and commits one complete pair', async () => {
    const save = messages.prototype.save;
    let interrupted = false;
    jest.spyOn(messages.prototype, 'save').mockImplementation(function (
      this: any,
      ...args: any[]
    ) {
      if (this.role === 'assistant' && !interrupted) {
        interrupted = true;
        const error = new mongoDriver.MongoServerError({
          message: 'Injected transient interruption',
          code: 112,
        });
        error.addErrorLabel('TransientTransactionError');
        throw error;
      }
      return (save as any).apply(this, args);
    });
    await send('transient-retry').expect(201);
    expect(interrupted).toBe(true);
    expect(await messages.countDocuments()).toBe(2);
    expect(await receipts.countDocuments({ operationType: 'ai-send' })).toBe(1);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it('clear receipt failure rolls back deletion and barrier; retry then preserves later sends', async () => {
    await send('before-clear').expect(201);
    const barriers = app.get<Model<ChatBarrier>>(
      getModelToken(ChatBarrier.name),
    );
    const before = (await barriers.findOne({
      userId: a,
      targetLanguage: 'en',
    }))!.revision;
    const fault = jest.spyOn(receipts, 'updateOne').mockImplementationOnce(
      () =>
        ({
          exec: () => Promise.reject(new Error('Clear receipt failed')),
        }) as unknown as ReturnType<typeof receipts.updateOne>,
    );
    expect(
      ((await clear('failed-clear').expect(503)).body as { code: string }).code,
    ).toBe('RETRYABLE_SERVER_FAILURE');
    expect(await messages.countDocuments()).toBe(2);
    expect(await receipts.countDocuments({ operationType: 'ai-clear' })).toBe(
      0,
    );
    expect(
      (await barriers.findOne({ userId: a, targetLanguage: 'en' }))!.revision,
    ).toBe(before);
    fault.mockRestore();
    await clear('failed-clear').expect(200);
    await send('after-clear').expect(201);
    await clear('failed-clear').expect(200);
    expect(await messages.countDocuments()).toBe(2);
  });
  it('barrier initialization failure returns a safe retryable error without provider effects', async () => {
    const barriers = app.get<Model<ChatBarrier>>(
      getModelToken(ChatBarrier.name),
    );
    jest.spyOn(barriers, 'updateOne').mockImplementationOnce(
      () =>
        ({
          exec: () => Promise.reject(new Error('private-database-detail')),
        }) as unknown as ReturnType<typeof barriers.updateOne>,
    );
    const failed = await send('barrier-init-failure').expect(503);
    expect((failed.body as { code: string }).code).toBe(
      'RETRYABLE_SERVER_FAILURE',
    );
    expect(JSON.stringify(failed.body)).not.toContain(
      'private-database-detail',
    );
    expect(provider).not.toHaveBeenCalled();
    expect(await messages.countDocuments()).toBe(0);
  });
  it('historical half-pairs remain readable; new sends never fabricate a repair', async () => {
    await messages.create({
      userId: a,
      targetLanguage: 'en',
      role: 'user',
      message: 'historical half',
    });
    await send('new-pair').expect(201);
    const history = await auth(
      request(app.getHttpServer() as import('node:http').Server).get(
        '/ai-coach/history',
      ),
    )
      .query({ targetLanguage: 'en' })
      .expect(200);
    expect(history.body).toHaveLength(3);
    expect(
      (history.body as Array<{ role: string }>).filter(
        (item) => item.role === 'assistant',
      ),
    ).toHaveLength(1);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it('provider failure remains retryable, saves no fabricated success and leaks no secrets', async () => {
    provider.mockRejectedValueOnce(new Error('provider-secret-stack'));
    const failed = await send('provider-fail').expect(503);
    expect((failed.body as { code: string }).code).toBe('PROVIDER_UNAVAILABLE');
    expect(JSON.stringify(failed.body)).not.toContain('provider-secret');
    expect(await messages.countDocuments()).toBe(0);
    await send('provider-fail').expect(201);
    expect(await messages.countDocuments()).toBe(2);
  });
  it('a missing transaction barrier fails safely before provider/history effects', async () => {
    const barriers = app.get<Model<ChatBarrier>>(
      getModelToken(ChatBarrier.name),
    );
    const update = barriers.updateOne.bind(
      barriers,
    ) as typeof barriers.updateOne;
    jest
      .spyOn(barriers, 'updateOne')
      .mockImplementation((...args: Parameters<typeof barriers.updateOne>) => {
        const change = args[1];
        if (change && '$inc' in change)
          return {
            exec: () => Promise.resolve({ matchedCount: 0 }),
          } as unknown as ReturnType<typeof barriers.updateOne>;
        return update(...args);
      });
    expect(
      ((await send('barrier-fail').expect(503)).body as { code: string }).code,
    ).toBe('RETRYABLE_SERVER_FAILURE');
    expect(provider).not.toHaveBeenCalled();
    expect(await messages.countDocuments()).toBe(0);
    expect(await receipts.countDocuments()).toBe(0);
  });
  it('W: independent sends each persist a complete pair', async () => {
    await Promise.all([send('one').expect(201), send('two').expect(201)]);
    expect(await messages.countDocuments()).toBe(4);
    expect(provider).toHaveBeenCalledTimes(2);
  });
  it('X/Y/Z: clear replay never erases later sends or another language', async () => {
    await send('old').expect(201);
    await send('german', 'hallo', 'de').expect(201);
    const first = await clear('clear').expect(200);
    await send('later').expect(201);
    expect((await clear('clear').expect(200)).body).toEqual(first.body);
    expect(
      await messages.countDocuments({ userId: a, targetLanguage: 'en' }),
    ).toBe(2);
    expect(
      await messages.countDocuments({ userId: a, targetLanguage: 'de' }),
    ).toBe(2);
    await send('old').expect(201);
    expect(await messages.countDocuments()).toBe(4);
  });
  it('send/clear overlap leaves a whole pair or an empty history according to serialized commit order', async () => {
    await Promise.all([
      send('racing').expect(201),
      clear('racing-clear').expect(200),
    ]);
    expect([0, 2]).toContain(await messages.countDocuments());
    const before = await messages.find().lean();
    await send('racing').expect(201);
    await clear('racing-clear').expect(200);
    expect(await messages.find().lean()).toEqual(before);
  });
  it('AA: clear receipts isolate owners and reject changed language', async () => {
    await send('a').expect(201);
    await send('b', 'hello', 'en', tokenB).expect(201);
    await clear('clear', 'en', tokenA).expect(200);
    expect(await messages.countDocuments({ userId: b })).toBe(2);
    await clear('clear', 'en', tokenB).expect(200);
    expect(
      (
        (await clear('clear', 'de', tokenA).expect(409)).body as {
          code: string;
        }
      ).code,
    ).toBe('IDEMPOTENCY_CONFLICT');
    expect(await messages.countDocuments()).toBe(0);
  });
  it('7D retention: receipts/barriers have no TTL, and missing operation IDs fail safely', async () => {
    for (const model of [
      receipts,
      app.get<Model<ChatBarrier>>(getModelToken(ChatBarrier.name)),
    ])
      expect(
        (await model.collection.indexes()).some(
          (index) => index.expireAfterSeconds !== undefined,
        ),
      ).toBe(false);
    await request(app.getHttpServer() as import('node:http').Server)
      .post('/community/posts')
      .auth(tokenA, { type: 'bearer' })
      .send({ learningLanguage: 'en', text: 'missing-key' })
      .expect(400);
    await request(app.getHttpServer() as import('node:http').Server)
      .post('/ai-coach/chat')
      .auth(tokenA, { type: 'bearer' })
      .send({ message: 'hello', language: 'en' })
      .expect(400);
    expect(provider).not.toHaveBeenCalled();
    expect(await posts.countDocuments()).toBe(0);
  });
  it('operation types isolate the same owner/key and fresh sends remain independent after clearing', async () => {
    const id = ((await create('shared').expect(201)).body as { _id: string })
      ._id;
    await like(id, true, 'shared').expect(201);
    await send('shared').expect(201);
    await clear('shared').expect(200);
    await send('fresh').expect(201);
    expect(
      await receipts.countDocuments({ userId: a, operationId: 'shared' }),
    ).toBe(4);
    expect(await messages.countDocuments()).toBe(2);
  });
});
