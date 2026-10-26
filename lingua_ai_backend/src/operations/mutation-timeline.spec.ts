import { AbuseControls } from '../security/abuse-controls';
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, ClientSession, mongo } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import request from 'supertest';
import type { Server } from 'node:http';
import sharp from 'sharp';
import { AuthModule } from '../auth/auth.module';
import { ProgressModule } from '../progress/progress.module';
import { FlashcardsModule } from '../flashcards/flashcards.module';
import { CommunityModule } from '../community/community.module';
import { AiCoachModule } from '../ai-coach/ai-coach.module';
import { SecurityModule } from '../security/security.module';
import { HttpSecurity } from '../security/http-security';
import { OperationsModule } from './operations.module';
import { TrafficLifecycle } from './traffic-lifecycle.service';
import { ReadinessService } from './readiness.service';
import { TimelineWriteGate, readTimelineControl } from './timeline-gate';
import { MutationTimeline } from './mutation-timeline';
import { CONTROL_COLLECTION } from './timeline-contract';
import { applyControlRequest } from '../tooling/timeline-control';
import {
  initializeTestTimeline,
  TEST_TIMELINE as A,
} from '../../test/timeline-fixture';
import { CRITICAL_INDEXES } from './index-inventory';
import { User } from '../users/schemas/user.schema';
import { ChatMessage } from '../ai-coach/schemas/chat-message.schema';
import { ChatBarrier } from '../ai-coach/schemas/chat-barrier.schema';
import { MutationReceipt } from '../common/mutation-receipt';
import { Flashcard } from '../flashcards/schemas/flashcard.schema';
import { Progress } from '../progress/schemas/progress.schema';
import { CommunityImageStorage } from '../community/community-image.storage';
import { AiContextService } from '../flashcards/services/ai-context.service';
import { telemetry } from './telemetry';

const B = '22222222-2222-4222-8222-222222222222';
describe('10B public mutation fencing on disposable replica set', () => {
  jest.setTimeout(90000);
  let replica: MongoMemoryReplSet;
  let app: NestExpressApplication;
  let db: Connection;
  let server: Server;
  let config: ConfigService;
  let root: string;
  let token: string;
  let owner: string;
  let provider: jest.SpyInstance;
  let messages: Model<ChatMessage>;
  let receipts: Model<MutationReceipt>;
  let barriers: Model<ChatBarrier>;
  const call = (
    method: 'post' | 'put' | 'patch' | 'delete',
    path: string,
    timeline: string | null = A,
    protocol = '2',
    key = randomUUID(),
  ) => {
    let req = request(server)
      [method](path)
      .auth(token, { type: 'bearer' })
      .set('X-Client-Protocol', protocol)
      .set('X-Idempotency-Key', key);
    if (timeline !== null) req = req.set('X-Data-Timeline', timeline);
    return req;
  };
  const send = (timeline = A, key = randomUUID()) =>
    call('post', '/ai-coach/chat', timeline, '2', key).send({
      message: 'hello',
      language: 'en',
      targetLanguage: 'en',
    });
  const clear = (timeline = A, key = randomUUID()) =>
    call('delete', '/ai-coach/clear', timeline, '2', key).query({
      targetLanguage: 'en',
    });
  const switchToB = async () => {
    let row = await readTimelineControl(db, 2000);
    await applyControlRequest(
      db,
      {
        action: 'close',
        eventId: randomUUID(),
        targetTimelineId: A,
        expectedTimelineId: A,
        expectedState: 'OPEN',
        expectedVersion: row.controlVersion,
        operatorReference: 'test-restore',
      },
      { expectedTimelineId: A, writeMode: 'CLOSED' },
    );
    row = await readTimelineControl(db, 2000);
    await applyControlRequest(
      db,
      {
        action: 'install-timeline',
        eventId: randomUUID(),
        targetTimelineId: B,
        expectedTimelineId: A,
        sourceTimelineId: A,
        expectedState: 'CLOSED',
        expectedVersion: row.controlVersion,
        operatorReference: 'test-restore',
      },
      { expectedTimelineId: B, writeMode: 'CLOSED' },
    );
    row = await readTimelineControl(db, 2000);
    config.set('DATA_TIMELINE_ID', B);
    config.set('CLIENT_PROTOCOL_POLICY', 'ENFORCE_MUTATIONS');
    await applyControlRequest(
      db,
      {
        action: 'open',
        eventId: randomUUID(),
        targetTimelineId: B,
        expectedTimelineId: B,
        expectedState: 'CLOSED',
        expectedVersion: row.controlVersion,
        operatorReference: 'test-restore',
      },
      { expectedTimelineId: B, writeMode: 'OPEN' },
    );
    await app.get<ReadinessService>(ReadinessService).refresh();
  };
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'timeline-10b-'));
    process.env.UPLOAD_ROOT = root;
    replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MongooseModule.forRoot(replica.getUri()),
        AuthModule,
        ProgressModule,
        FlashcardsModule,
        CommunityModule,
        AiCoachModule,
        OperationsModule,
        SecurityModule,
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          NODE_ENV: 'test',
          JWT_SECRET: randomUUID() + randomUUID(),
          GEMINI_API_KEY: 'mock-only',
          AI_ENABLED: true,
          PRONUNCIATION_ENABLED: false,
          TRUST_PROXY: 'false',
          CORS_ORIGINS: 'https://app.example.invalid',
        }),
      )
      .overrideProvider(AiContextService)
      .useValue({
        generateContext: () =>
          Promise.resolve({ sentences: [], mnemonics: [] }),
      })
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    app.useLogger(false);
    app.get<HttpSecurity>(HttpSecurity).install(app);
    app.get<TrafficLifecycle>(TrafficLifecycle).attach(app);
    app.get<HttpSecurity>(HttpSecurity).installBodyParsers(app);
    await app.init();
    db = app.get<Connection>(getConnectionToken());
    server = app.getHttpServer();
    config = app.get(ConfigService);
    messages = app.get(getModelToken(ChatMessage.name));
    receipts = app.get(getModelToken(MutationReceipt.name));
    barriers = app.get(getModelToken(ChatBarrier.name));
  });
  beforeEach(async () => {
    jest
      .spyOn(app.get<AbuseControls>(AbuseControls), 'consume')
      .mockImplementation(() => undefined);
    // This connection was generated above, never sourced from application config.
    await db.dropDatabase();
    await initializeTestTimeline(app);
    for (const model of db.modelNames()) await db.model(model).createIndexes();
    for (const index of CRITICAL_INDEXES)
      await db
        .db!.collection(index.collection)
        .createIndex(index.key, { unique: true, name: index.id });
    const user = await app.get<Model<User>>(getModelToken(User.name)).create({
      name: 'Owner',
      email: 'owner@example.invalid',
      passwordHash: 'fixture',
    });
    owner = user._id.toString();
    token = app.get<JwtService>(JwtService).sign({ sub: owner });
    await db.db!.collection('lessons').insertOne({
      id: 'one',
      targetLanguage: 'en',
      xpReward: 50,
      title: 'one',
    });
    config.set('NODE_ENV', 'production');
    await app.get<ReadinessService>(ReadinessService).refresh();
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
    } as Response);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await app?.close();
    await replica?.stop();
    const child = relative(resolve(tmpdir()), resolve(root));
    if (!child.startsWith('timeline-10b-') || child.includes(sep))
      throw new Error('Unsafe fixture cleanup');
    await rm(root, { recursive: true, force: true });
    delete process.env.UPLOAD_ROOT;
  });
  test.each(['ALLOW_LEGACY', 'ENFORCE_MUTATIONS'] as const)(
    'rollout/errors/auth/CORS: %s',
    async (policy) => {
      config.set('CLIENT_PROTOCOL_POLICY', policy);
      const body = {
        name: 'New',
        email: 'new@example.invalid',
        password: 'LongPassword123!',
      };
      // Public account creation is durable but cannot require an existing identity.
      await call('post', '/auth/register', null, '1')
        .send(body)
        .expect(policy === 'ALLOW_LEGACY' ? 201 : 426);
      const missing = await call('post', '/auth/guest', null).expect(428);
      expect(missing.body).toMatchObject({ code: 'SERVER_TIMELINE_REQUIRED' });
      await call('post', '/auth/guest', B).expect(409);
      await call('post', '/auth/guest').expect(201);
      if (policy === 'ENFORCE_MUTATIONS')
        await call('post', '/auth/register').send(body).expect(201);
      await request(server)
        .post('/auth/login')
        .send({ email: body.email, password: body.password })
        .expect(201);
      await call('post', '/auth/guest', 'bad').expect(400);
      await call('post', '/auth/guest', A, '3').expect(426);
      // Protocol compatibility precedes timeline validation on durable writers.
      await call('post', '/auth/guest', 'bad', '3').expect(426);
      await request(server)
        .patch('/users/profile')
        .set('X-Client-Protocol', '2')
        .set('X-Data-Timeline', A)
        .send({ name: 'forged' })
        .expect(401);
      const cors = await request(server)
        .options('/users/profile')
        .set('Origin', 'https://app.example.invalid')
        .set('Access-Control-Request-Method', 'PATCH')
        .set('Access-Control-Request-Headers', 'x-data-timeline')
        .expect(204);
      expect(
        String(cors.headers['access-control-allow-headers']).toLowerCase(),
      ).toContain('x-data-timeline');
    },
  );
  test('account creation retries an aborted saved document and commits exactly one account', async () => {
    const session = await db.startSession({
      defaultTimeoutMS: config.get<number>('READINESS_TIMEOUT_MS') ?? 5000,
    });
    jest.spyOn(db, 'startSession').mockResolvedValueOnce(session);
    jest.spyOn(session, 'commitTransaction').mockRejectedValueOnce(
      new mongo.MongoServerError({
        message: 'Injected transient commit failure',
        code: 112,
        errorLabels: ['TransientTransactionError'],
      }),
    );
    const before = await readTimelineControl(db, 2000);
    await call('post', '/auth/register')
      .send({
        name: 'Retry',
        email: 'retry@example.invalid',
        password: 'LongPassword123!',
      })
      .expect(201);
    expect(
      await db
        .db!.collection('users')
        .countDocuments({ email: 'retry@example.invalid' }),
    ).toBe(1);
    expect((await readTimelineControl(db, 2000)).fenceVersion).toBe(
      before.fenceVersion + 1,
    );
  });
  test('legacy v1 writes still touch the control record; accepting origin-unknown work is transitional only', async () => {
    const before = await readTimelineControl(db, 2000);
    await call('patch', '/users/profile', null, '1')
      .send({ name: 'legacy' })
      .expect(200);
    expect((await readTimelineControl(db, 2000)).fenceVersion).toBeGreaterThan(
      before.fenceVersion,
    );
    // Simulate an unannounced rollback with unchanged external/control A.
    // Software cannot know that this v1 offline intent originated before rollback.
    await app
      .get<Model<User>>(getModelToken(User.name))
      .updateOne({ _id: owner }, { $set: { name: 'restored' } });
    await call('patch', '/users/profile', null, '1')
      .send({ name: 'origin-unknown' })
      .expect(200);
  });
  test('surviving receipt cannot cross timelines or free its globally unique operation ID', async () => {
    const key = randomUUID();
    await send(A, key).expect(201);
    expect(await receipts.findOne({ operationId: key })).toMatchObject({
      dataTimelineId: A,
    });
    await switchToB();
    const lookup = jest.spyOn(receipts, 'findOne');
    await send(A, key).expect(409);
    expect(lookup).not.toHaveBeenCalled();
    await send(B, key).expect(409);
    expect(await receipts.countDocuments({ operationId: key })).toBe(1);
    expect(provider).toHaveBeenCalledTimes(1);
    await send(B).expect(201);
    expect(await receipts.countDocuments({ dataTimelineId: B })).toBe(1);
  });
  test('unscoped historical receipt is legacy-only and never relabeled for v2', async () => {
    const key = randomUUID();
    await send(A, key).expect(201);
    await receipts.collection.updateOne(
      { operationId: key },
      { $unset: { dataTimelineId: '' } },
    );
    const denied = await send(A, key).expect(409);
    expect(denied.body).toMatchObject({ code: 'RECEIPT_TIMELINE_UNVERIFIED' });
    await call('post', '/ai-coach/chat', null, '1', key)
      .send({ message: 'hello', language: 'en', targetLanguage: 'en' })
      .expect(201);
    expect(
      (await receipts.findOne({ operationId: key }))?.dataTimelineId,
    ).toBeUndefined();
    expect(provider).toHaveBeenCalledTimes(1);
  });
  test('receipt provenance is immutable through runtime schema updates', async () => {
    const key = randomUUID();
    await send(A, key).expect(201);
    await receipts.updateOne(
      { operationId: key },
      { $set: { dataTimelineId: B } },
    );
    expect((await receipts.findOne({ operationId: key }))?.dataTimelineId).toBe(
      A,
    );
  });
  test('a forged matching timeline grants no access to another owner resource', async () => {
    const post = await call('post', '/community/posts')
      .send({ text: 'private ownership', learningLanguage: 'en' })
      .expect(201);
    const foreign = await app
      .get<Model<User>>(getModelToken(User.name))
      .create({
        name: 'Foreign',
        email: 'foreign@example.invalid',
        passwordHash: 'fixture',
      });
    const otherToken = app
      .get(JwtService)
      .sign({ sub: foreign._id.toString() });
    await call(
      'delete',
      `/community/posts/${String((post.body as { _id: string })._id)}`,
    )
      .auth(otherToken, { type: 'bearer' })
      .set('X-Resource-Revision', '0')
      .expect(403);
    expect(await db.db!.collection('communityposts').countDocuments()).toBe(1);
  });
  test.each([
    'progress',
    'flashcard-review',
    'community-create',
    'ai-send',
  ] as const)(
    'lost receipt/domain restore rejects the original A request: %s',
    async (domain) => {
      const key = randomUUID();
      let cardId: string | undefined;
      let restoredCard: mongo.WithId<mongo.Document> | null = null;
      if (domain === 'flashcard-review') {
        const card = await app
          .get<Model<Flashcard>>(getModelToken(Flashcard.name))
          .create({
            userId: owner,
            targetWord: 'word',
            turkishTranslation: 'word',
            targetLanguage: 'en',
          });
        cardId = card._id.toString();
        restoredCard = await db
          .db!.collection('flashcards')
          .findOne({ _id: card._id });
      }
      const operation = () =>
        domain === 'progress'
          ? call(
              'post',
              `/progress/${owner}/complete-lesson`,
              A,
              '2',
              key,
            ).send({ lessonId: 'one', score: 80, progressEpoch: 0 })
          : domain === 'flashcard-review'
            ? call('put', `/flashcards/${cardId}/review`, A, '2', key).send({
                score: 4,
              })
            : domain === 'community-create'
              ? call('post', '/community/posts', A, '2', key).send({
                  text: 'post',
                  learningLanguage: 'en',
                })
              : send(A, key);
      await operation().expect(domain === 'flashcard-review' ? 200 : 201);
      await Promise.all([
        db.db!.collection('mutationreceipts').deleteMany({}),
        db.db!.collection('flashcardoperations').deleteMany({}),
        db.db!.collection('progresses').deleteMany({}),
        db.db!.collection('communityposts').deleteMany({}),
        db.db!.collection('chatmessages').deleteMany({}),
        db.db!.collection('chatbarriers').deleteMany({}),
      ]);
      await db.db!.collection('users').updateOne(
        {
          _id: (await app
            .get<Model<User>>(getModelToken(User.name))
            .findById(owner))!._id,
        },
        {
          $set: {
            progressEpoch: 0,
            totalXp: 0,
            xpPerLanguage: {},
            levelPerLanguage: {},
          },
        },
      );
      if (restoredCard)
        await db
          .db!.collection('flashcards')
          .replaceOne({ _id: restoredCard._id }, restoredCard);
      await switchToB();
      const before = await db.db!.collection('users').findOne({});
      const providerCalls = provider.mock.calls.length;
      const failed = await operation().expect(409);
      expect(failed.body).toMatchObject({ code: 'SERVER_TIMELINE_CHANGED' });
      expect(await db.db!.collection('users').findOne({})).toEqual(before);
      for (const collection of [
        'mutationreceipts',
        'flashcardoperations',
        'progresses',
        'communityposts',
        'chatmessages',
        'chatbarriers',
      ])
        expect(await db.db!.collection(collection).countDocuments()).toBe(0);
      if (restoredCard)
        expect(
          await db
            .db!.collection('flashcards')
            .findOne({ _id: restoredCard._id }),
        ).toEqual(restoredCard);
      expect(provider).toHaveBeenCalledTimes(providerCalls);
    },
  );
  test('MANDATORY: replay of restored-away A clear cannot delete restored messages or later B messages', async () => {
    await send().expect(201);
    const restored = await messages.find().lean();
    const key = randomUUID();
    await clear(A, key).expect(200);
    expect(await messages.countDocuments()).toBe(0);
    await receipts.deleteMany({});
    await barriers.deleteMany({});
    await messages.insertMany(restored);
    await switchToB();
    await send(B).expect(201);
    const beforeMessages = await messages.find().lean();
    const beforeBarriers = await barriers.find().lean();
    const beforeReceipts = await receipts.find().lean();
    const deletion = jest.spyOn(messages, 'deleteMany');
    const barrier = jest.spyOn(barriers, 'updateOne');
    const replay = jest.spyOn(receipts, 'findOne');
    const providerCalls = provider.mock.calls.length;
    const rejected = await clear(A, key).expect(409);
    expect(rejected.body).toMatchObject({ code: 'SERVER_TIMELINE_CHANGED' });
    expect(deletion).not.toHaveBeenCalled();
    expect(barrier).not.toHaveBeenCalled();
    expect(replay).not.toHaveBeenCalled();
    expect(provider).toHaveBeenCalledTimes(providerCalls);
    expect(await messages.find().lean()).toEqual(beforeMessages);
    expect(beforeMessages).toHaveLength(4);
    expect(await barriers.find().lean()).toEqual(beforeBarriers);
    expect(await receipts.find().lean()).toEqual(beforeReceipts);
  });
  test('matching B send stays atomic and committed replay bypasses provider', async () => {
    await switchToB();
    const key = randomUUID();
    const first = await send(B, key).expect(201);
    const second = await send(B, key).expect(201);
    expect(second.body).toEqual(first.body);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await messages.countDocuments()).toBe(2);
    expect(await receipts.findOne({ operationId: key })).toMatchObject({
      dataTimelineId: B,
    });
  });
  test('registration, guest and profile mutations are fenced; stale identity creation/update fails', async () => {
    const before = (await readTimelineControl(db, 2000)).fenceVersion;
    await call('post', '/auth/register')
      .send({
        name: 'New',
        email: 'new@example.invalid',
        password: 'LongPassword123!',
      })
      .expect(201);
    await call('post', '/auth/guest').expect(201);
    await call('patch', '/users/profile').send({ name: 'changed' }).expect(200);
    expect((await readTimelineControl(db, 2000)).fenceVersion).toBe(before + 3);
    await switchToB();
    const users = app.get<Model<User>>(getModelToken(User.name));
    const count = await users.countDocuments();
    await call('post', '/auth/register')
      .send({
        name: 'Stale',
        email: 'stale@example.invalid',
        password: 'LongPassword123!',
      })
      .expect(409);
    await call('post', '/auth/guest').expect(409);
    await call('patch', '/users/profile').send({ name: 'stale' }).expect(409);
    expect(await users.countDocuments()).toBe(count);
    expect((await users.findById(owner))?.name).toBe('changed');
  });
  test('upload mismatched timeline is rejected before persistent allocation', async () => {
    const store = jest.spyOn(
      app.get<CommunityImageStorage>(CommunityImageStorage),
      'store',
    );
    await call('post', '/community/posts', B)
      .field('learningLanguage', 'en')
      .attach('image', Buffer.from('never decoded'), 'image.png')
      .expect(409);
    expect(store).not.toHaveBeenCalled();
  });
  test('Mongo close after file staging prevents final DB commit and compensates only the owned staged file', async () => {
    const images = app.get<CommunityImageStorage>(CommunityImageStorage);
    const original = (file: Express.Multer.File) => images.store(file);
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer();
    jest.spyOn(images, 'store').mockImplementationOnce(async (file) => {
      const url = await original(file);
      const row = await readTimelineControl(db, 2000);
      await applyControlRequest(
        db,
        {
          action: 'close',
          eventId: randomUUID(),
          targetTimelineId: A,
          expectedTimelineId: A,
          expectedState: 'OPEN',
          expectedVersion: row.controlVersion,
          operatorReference: 'test-close',
        },
        { expectedTimelineId: A, writeMode: 'CLOSED' },
      );
      return url;
    });
    await call('post', '/community/posts')
      .field('learningLanguage', 'en')
      .attach('image', image, 'image.png')
      .expect(503);
    expect(await db.db!.collection('communityposts').countDocuments()).toBe(0);
    expect(await receipts.countDocuments()).toBe(0);
    expect(await readdir(join(root, 'community'))).toEqual([]);
  });
  test('representative in-flight domain transaction loses to a committed operator close before its fence', async () => {
    const gate = app.get<TimelineWriteGate>(TimelineWriteGate);
    const touch = (session: ClientSession, timeline: string) =>
      gate.assertAndTouchWriteFence(session, timeline);
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((done) => {
      release = done;
    });
    const ready = new Promise<void>((done) => {
      started = done;
    });
    jest
      .spyOn(gate, 'assertAndTouchWriteFence')
      .mockImplementationOnce(async (session, timeline) => {
        await readTimelineControl(db, 2000, session);
        started();
        await waiting;
        await touch(session, timeline);
      });
    const pending = call('post', `/progress/${owner}/complete-lesson`)
      .send({ lessonId: 'one', score: 80, progressEpoch: 0 })
      .then((response) => response);
    await ready;
    const row = await readTimelineControl(db, 2000);
    await applyControlRequest(
      db,
      {
        action: 'close',
        eventId: randomUUID(),
        targetTimelineId: A,
        expectedTimelineId: A,
        expectedState: 'OPEN',
        expectedVersion: row.controlVersion,
        operatorReference: 'test-close',
      },
      { expectedTimelineId: A, writeMode: 'CLOSED' },
    );
    release();
    expect((await pending).status).toBe(503);
    expect(
      await app
        .get<Model<Progress>>(getModelToken(Progress.name))
        .countDocuments(),
    ).toBe(0);
    expect(
      (await app.get<Model<User>>(getModelToken(User.name)).findById(owner))
        ?.totalXp,
    ).toBe(0);
  });
  test('known restored control cannot reopen write readiness under ALLOW_LEGACY', async () => {
    await switchToB();
    config.set('CLIENT_PROTOCOL_POLICY', 'ALLOW_LEGACY');
    await app.get<ReadinessService>(ReadinessService).refresh();
    await request(server).get('/health/ready').expect(503);
    await call('patch', '/users/profile', B, '1')
      .send({ name: 'blocked' })
      .expect(503);
  });
  test('closed control keeps discovery/liveness available, readiness false and safe metadata only', async () => {
    config.set('DATA_WRITE_MODE', 'CLOSED');
    await app.get<ReadinessService>(ReadinessService).refresh();
    await request(server).get('/health/live').expect(200);
    await request(server).get('/health/ready').expect(503);
    const response = await request(server).get('/compatibility').expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      currentProtocolRevision: 2,
      timelineAwareProtocolRevision: 2,
      dataTimelineId: A,
      timelineWriteState: 'CLOSED',
    });
    expect(response.text).not.toMatch(
      /mongo|sourceTimeline|eventId|stack|operator/,
    );
    await call('patch', '/users/profile').send({ name: 'blocked' }).expect(503);
  });
  test('transaction contention is observable and bounded without a read-only fence fallback', async () => {
    const counters = jest.spyOn(telemetry, 'emit');
    const timeline = app.get<MutationTimeline>(MutationTimeline);
    const gate = app.get(TimelineWriteGate);
    const touch = gate.assertAndTouchWriteFence.bind(
      gate,
    ) as typeof gate.assertAndTouchWriteFence;
    let participants = 0,
      snapshots = 0;
    let release!: () => void;
    const allSnapshots = new Promise<void>((done) => {
      release = done;
    });
    jest
      .spyOn(gate, 'assertAndTouchWriteFence')
      .mockImplementation(async (session, id) => {
        if (participants++ < 4) {
          await db.db!.collection(CONTROL_COLLECTION).findOne({}, { session });
          if (++snapshots === 4) release();
          await allSnapshots;
        }
        await touch(session, id);
      });
    const startedAt = performance.now();
    await Promise.all(
      Array.from({ length: 4 }, () =>
        timeline.transaction('synthetic-contention', async (session) => {
          await db
            .db!.collection('syntheticwrites')
            .insertOne({ value: true }, { session });
        }),
      ),
    );
    expect(await db.db!.collection('syntheticwrites').countDocuments()).toBe(4);
    const retries = counters.mock.calls.filter(
      ([event]) => event === 'timeline_fence_conflict',
    ).length;
    console.info(
      JSON.stringify({
        scenario: 'four-concurrent-fenced-transactions',
        committed: 4,
        retries,
        elapsedMs: Math.round(performance.now() - startedAt),
      }),
    );
    expect(retries).toBeGreaterThan(0);
  });
});
