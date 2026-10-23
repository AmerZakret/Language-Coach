import { ConfigService } from '@nestjs/config';
import { Controller, Get, Logger, Injectable, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, createConnection } from 'mongoose';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { CommunityImageStorage } from '../community/community-image.storage';
import { HealthController } from './health.controller';
import { ReadinessService } from './readiness.service';
import {
  CRITICAL_INDEXES,
  PERFORMANCE_INDEXES,
  inspectIndexes,
} from './index-inventory';
import {
  runReadinessProbes,
  verifyTransactions,
  verifyUploadRoot,
} from './readiness-probes';
import { TrafficLifecycle } from './traffic-lifecycle.service';
import { UserSchema } from '../users/schemas/user.schema';
import { LessonSchema } from '../lessons/schemas/lesson.schema';
import { ProgressSchema } from '../progress/schemas/progress.schema';
import { FlashcardSchema } from '../flashcards/schemas/flashcard.schema';
import { FlashcardOperationSchema } from '../flashcards/schemas/flashcard-operation.schema';
import { ProgressResetSchema } from '../progress/schemas/progress-reset.schema';
import { MutationReceiptSchema } from '../common/mutation-receipt';
import { ChatBarrierSchema } from '../ai-coach/schemas/chat-barrier.schema';
import { validateEnvironment } from '../config/runtime-config';
import { telemetry } from './telemetry';

async function provisionTestIndexes(connection: Connection) {
  for (const index of CRITICAL_INDEXES)
    await connection
      .db!.collection(index.collection)
      .createIndex(index.key, { unique: true, name: index.id });
}

let beginWork: () => void;
let finishWork: Promise<void>;
let beginGuard: () => void;
let finishGuard: Promise<void>;
@Injectable()
class DelayedTestGuard {
  async canActivate() {
    beginGuard();
    await finishGuard;
    return true;
  }
}
@Controller()
class DrainTestController {
  @Get('work') async work() {
    beginWork();
    await finishWork;
    return { done: true };
  }
  @Get('guarded-work')
  @UseGuards(DelayedTestGuard)
  async guardedWork() {
    beginWork();
    return { done: true };
  }
}

describe('8B readiness with disposable MongoDB and temporary storage only', () => {
  jest.setTimeout(120000);
  let replica: MongoMemoryReplSet;
  let standalone: MongoMemoryServer;
  let connection: Connection;
  let root: string;
  let service: ReadinessService;
  const logs: string[] = [];
  const makeService = (overrides: Record<string, unknown> = {}) =>
    new ReadinessService(
      connection,
      new ConfigService({
        NODE_ENV: 'production',
        READINESS_TIMEOUT_MS: 3000,
        READINESS_RECHECK_MS: 10000,
        AI_ENABLED: false,
        PRONUNCIATION_ENABLED: false,
        ...overrides,
      }),
      { root } as CommunityImageStorage,
    );
  beforeAll(async () => {
    [replica, standalone] = await Promise.all([
      MongoMemoryReplSet.create({ replSet: { count: 1 } }),
      MongoMemoryServer.create(),
    ]);
  });
  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'language-8b-'));
    connection = await createConnection(replica.getUri(), {
      dbName: `readiness_${randomUUID().replace(/-/g, '')}`,
      autoIndex: false,
      autoCreate: false,
      serverSelectionTimeoutMS: 500,
      monitorCommands: true,
    }).asPromise();
    await provisionTestIndexes(connection);
    service = makeService();
    logs.length = 0;
    jest.spyOn(telemetry, 'emit').mockImplementation((event, fields) => {
      logs.push(JSON.stringify({ event, ...fields }));
    });
  });
  afterEach(async () => {
    service.stop();
    jest.restoreAllMocks();
    await connection.close();
    // Only remove this test's generated directory, never an operator upload root.
    const child = relative(resolve(tmpdir()), resolve(root));
    if (!child.startsWith('language-8b-') || child.includes(sep))
      throw new Error('Unsafe fixture cleanup');
    await fs.rm(root, { recursive: true, force: true });
  });
  afterAll(async () => {
    await Promise.all([replica.stop(), standalone.stop()]);
  });

  test('replica set, critical indexes and writable root become ready without writes or paid calls', async () => {
    const commands: string[] = [];
    const listener = (event: { commandName: string }) =>
      commands.push(event.commandName);
    connection.getClient().on('commandStarted', listener);
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('No external providers permitted'));
    await service.refresh();
    expect(service.snapshot()).toEqual({
      status: 'ready',
      checks: {
        database: 'ok',
        transactions: 'ok',
        indexes: 'ok',
        uploads: 'ok',
      },
    });
    expect(commands).toContain('find');
    expect(commands).not.toEqual(expect.arrayContaining(['insert']));
    expect(
      commands.filter((name) =>
        [
          'insert',
          'update',
          'delete',
          'create',
          'createIndexes',
          'dropIndexes',
          'drop',
          'dropDatabase',
          'commitTransaction',
        ].includes(name),
      ),
    ).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    connection.getClient().removeListener('commandStarted', listener);
    expect(await fs.readdir(root)).toEqual([]);
  });
  test('standalone MongoDB cannot pass actual topology verification', async () => {
    const single = await createConnection(standalone.getUri(), {
      autoIndex: false,
      autoCreate: false,
    }).asPromise();
    try {
      await provisionTestIndexes(single);
      expect(
        await verifyTransactions(single, new AbortController().signal, 1000),
      ).toBe('UNSUPPORTED_TOPOLOGY');
      const result = await runReadinessProbes(
        single,
        root,
        false,
        new AbortController().signal,
        1000,
      );
      expect(result.checks).toEqual({
        database: 'ok',
        transactions: 'failed',
        indexes: 'ok',
        uploads: 'ok',
      });
      expect(result.diagnostics).toContainEqual({
        code: 'UNSUPPORTED_TOPOLOGY',
      });
    } finally {
      await single.close();
    }
  });
  test('unsupported sharded wire protocol is rejected; modern sharded hello proceeds to actual transaction probe', async () => {
    const admin = jest.spyOn(connection.db!, 'admin');
    admin.mockReturnValue({
      command: async () => ({
        msg: 'isdbgrid',
        logicalSessionTimeoutMinutes: 30,
        maxWireVersion: 7,
      }),
    } as any);
    expect(
      await verifyTransactions(connection, new AbortController().signal, 1000),
    ).toBe('UNSUPPORTED_TOPOLOGY');
    admin.mockReturnValue({
      command: async () => ({
        msg: 'isdbgrid',
        logicalSessionTimeoutMinutes: 30,
        maxWireVersion: 8,
      }),
    } as any);
    expect(
      await verifyTransactions(connection, new AbortController().signal, 1000),
    ).toBe('ok');
  });
  test('missing Mongo connection stays not ready', async () => {
    const absent = createConnection();
    const result = await runReadinessProbes(
      absent,
      root,
      false,
      new AbortController().signal,
      500,
    );
    expect(result.checks).toEqual({
      database: 'failed',
      transactions: 'failed',
      indexes: 'failed',
      uploads: 'ok',
    });
    await absent.close();
  });
  test('real connection close invalidates readiness and reopening recovers', async () => {
    const name = connection.name;
    await service.onApplicationBootstrap();
    expect(service.snapshot().status).toBe('ready');
    await connection.close();
    expect(service.snapshot().status).toBe('not_ready');
    expect(service.snapshot().checks.database).toBe('failed');
    await connection.openUri(replica.getUri(), {
      dbName: name,
      autoIndex: false,
      autoCreate: false,
    });
    for (
      let attempt = 0;
      attempt < 20 && service.snapshot().status !== 'ready';
      attempt++
    ) {
      await service.refresh();
      await new Promise((done) => setTimeout(done, 20));
    }
    expect(service.snapshot().status).toBe('ready');
  });
  test('reconnecting/error events invalidate cached readiness even before readyState changes', async () => {
    await service.onApplicationBootstrap();
    connection.emit(
      'error',
      new Error('synthetic-private-infrastructure-marker'),
    );
    expect(service.snapshot().status).toBe('not_ready');
    await service.refresh();
    expect(service.snapshot().status).toBe('ready');
    expect(logs.join()).not.toContain(
      'synthetic-private-infrastructure-marker',
    );
  });
  test('transaction error diagnostics and public state redact raw infrastructure errors', async () => {
    const marker = `private-${randomUUID()}`;
    const collection = connection.db!.collection.bind(connection.db);
    jest.spyOn(connection.db!, 'collection').mockImplementation(((
      name: string,
      ...args: any[]
    ) =>
      name === 'users'
        ? {
            findOne: async () => {
              throw new Error(marker);
            },
            listIndexes: (...options: any[]) =>
              collection(name).listIndexes(...options),
          }
        : collection(name, ...args)) as any);
    await service.refresh();
    expect(service.snapshot().checks.transactions).toBe('failed');
    expect(service.snapshot().status).toBe('not_ready');
    expect(logs.join()).toContain('TRANSACTION_CHECK_FAILED');
    expect(JSON.stringify(service.snapshot()) + logs.join()).not.toContain(
      marker,
    );
  });
  test('missing required unique index blocks readiness and is not repaired', async () => {
    await connection.db!.collection('users').dropIndex('email_1');
    await service.refresh();
    expect(service.snapshot().checks.indexes).toBe('failed');
    expect(logs.join()).toContain('MISSING_INDEX');
    expect(
      (await connection.db!.collection('users').indexes()).some(
        (index) => index.name === 'email_1',
      ),
    ).toBe(false);
  });
  test('non-unique replacement blocks readiness', async () => {
    await connection.db!.collection('users').dropIndex('email_1');
    await connection
      .db!.collection('users')
      .createIndex({ email: 1 }, { name: 'email_1' });
    await service.refresh();
    expect(service.snapshot().checks.indexes).toBe('failed');
    expect(logs.join()).toContain('WRONG_INDEX_OPTIONS');
  });
  test.each([
    { sparse: true },
    { partialFilterExpression: { email: { $exists: true } } },
    { collation: { locale: 'en', strength: 2 } },
  ])('incompatible uniqueness options are rejected: %j', (options) => {
    expect(
      inspectIndexes(CRITICAL_INDEXES[0], [
        { key: { email: 1 }, unique: true, ...options },
      ]),
    ).toContainEqual(expect.objectContaining({ code: 'WRONG_INDEX_OPTIONS' }));
  });
  test('equivalent named unique index is accepted; diagnostics never trust DB-supplied index names', async () => {
    await connection.db!.collection('users').dropIndex('email_1');
    await connection
      .db!.collection('users')
      .createIndex({ email: 1 }, { unique: true, name: 'operator_index' });
    await service.refresh();
    expect(service.snapshot().status).toBe('ready');
  });
  test('legacy flashcard uniqueness conflict is diagnosed but never dropped', async () => {
    await connection
      .db!.collection('flashcards')
      .createIndex(
        { userId: 1, targetWord: 1 },
        { unique: true, name: 'legacy-private-marker' },
      );
    await service.refresh();
    expect(service.snapshot().checks.indexes).toBe('failed');
    expect(logs.join()).toContain('LEGACY_INDEX_CONFLICT');
    expect(logs.join()).not.toContain('legacy-private-marker');
    expect(
      (await connection.db!.collection('flashcards').indexes()).some(
        (index) => index.name === 'legacy-private-marker',
      ),
    ).toBe(true);
  });
  test('duplicate data prevents provisioning but verification never deletes/merges it', async () => {
    const users = connection.db!.collection('users');
    await users.dropIndex('email_1');
    await users.insertMany([
      { email: 'duplicate@example.invalid' },
      { email: 'duplicate@example.invalid' },
    ]);
    await expect(
      users.createIndex({ email: 1 }, { unique: true }),
    ).rejects.toMatchObject({ code: 11000 });
    await service.refresh();
    expect(service.snapshot().status).toBe('not_ready');
    expect(await users.countDocuments()).toBe(2);
    expect(logs.join()).not.toContain('duplicate@example.invalid');
  });
  test('missing performance-only indexes do not block readiness', async () => {
    for (const index of PERFORMANCE_INDEXES) {
      const listed = await connection
        .db!.collection(index.collection)
        .indexes()
        .catch(() => []);
      expect(
        listed.filter(
          (item) => JSON.stringify(item.key) === JSON.stringify(index.key),
        ),
      ).toEqual([]);
    }
    await service.refresh();
    expect(service.snapshot().status).toBe('ready');
  });
  test('TTL on protected state blocks readiness, even if a separate dedupe index is valid', () => {
    for (const expected of CRITICAL_INDEXES)
      expect(
        inspectIndexes(expected, [
          { key: expected.key, unique: true },
          { key: { createdAt: 1 }, expireAfterSeconds: 1 },
        ]),
      ).toContainEqual(expect.objectContaining({ code: 'UNSAFE_TTL' }));
  });
  test('inventory covers every current schema unique index and protected schemas contain no TTL', () => {
    const schemas = {
      users: UserSchema,
      lessons: LessonSchema,
      progresses: ProgressSchema,
      flashcards: FlashcardSchema,
      flashcardoperations: FlashcardOperationSchema,
      progressresets: ProgressResetSchema,
      mutationreceipts: MutationReceiptSchema,
      chatbarriers: ChatBarrierSchema,
    };
    for (const [collection, schema] of Object.entries(schemas)) {
      const unique = schema
        .indexes()
        .filter(([, options]) => options.unique)
        .map(([key]) => key);
      expect(unique).toEqual(
        CRITICAL_INDEXES.filter((index) => index.collection === collection).map(
          (index) => index.key,
        ),
      );
      expect(
        schema
          .indexes()
          .some(
            ([, options]) =>
              options.expireAfterSeconds !== undefined ||
              options.expires !== undefined,
          ),
      ).toBe(false);
    }
  });
  test.each([
    'READINESS_TIMEOUT_MS',
    'READINESS_RECHECK_MS',
    'SHUTDOWN_GRACE_MS',
  ])(
    'validates bounded lifecycle setting %s without exposing values',
    (name) => {
      for (const value of ['0', 'NaN', '999999999'])
        expect(() =>
          validateEnvironment({
            NODE_ENV: 'test',
            MONGODB_URI: 'mongodb://localhost/disposable',
            JWT_SECRET: 'test-only',
            [name]: value,
          }),
        ).toThrow(name);
    },
  );
  test('writable storage probe cleans up on success and aborted write', async () => {
    expect(
      await verifyUploadRoot(root, false, new AbortController().signal),
    ).toBe(await fs.realpath(root));
    expect(await fs.readdir(root)).toEqual([]);
    const abort = new AbortController();
    abort.abort();
    await expect(
      verifyUploadRoot(root, false, abort.signal),
    ).rejects.toBeDefined();
    expect(await fs.readdir(root)).toEqual([]);
  });
  test('unwritable storage blocks readiness without exposing path or leaving a probe', async () => {
    const open = fs.open;
    jest.spyOn(fs, 'open').mockImplementation(((
      ...args: Parameters<typeof fs.open>
    ) =>
      String(args[0]).includes('.readiness-')
        ? Promise.reject(
            Object.assign(new Error(`secret-root-${root}`), {
              code: 'EACCES',
            }),
          )
        : open(...args)) as any);
    await service.refresh();
    expect(service.snapshot().checks.uploads).toBe('failed');
    expect(service.snapshot().status).toBe('not_ready');
    expect(logs.join() + JSON.stringify(service.snapshot())).not.toContain(
      root,
    );
    expect(await fs.readdir(root)).toEqual([]);
  });
  test('probe write failure still closes and removes its exclusively created file', async () => {
    const open = fs.open;
    jest.spyOn(fs, 'open').mockImplementation((async (
      ...args: Parameters<typeof fs.open>
    ) => {
      const handle = await open(...args);
      if (String(args[0]).includes('.readiness-'))
        jest
          .spyOn(handle, 'writeFile')
          .mockRejectedValue(new Error('synthetic-write-failure'));
      return handle;
    }) as any);
    await service.refresh();
    expect(service.snapshot().checks.uploads).toBe('failed');
    expect(await fs.readdir(root)).toEqual([]);
  });
  test('an existing community directory resolving outside the root blocks storage readiness', async () => {
    const realpath = fs.realpath;
    jest
      .spyOn(fs, 'realpath')
      .mockImplementation(((path: any) =>
        String(path) === join(root, 'community')
          ? Promise.resolve(tmpdir())
          : realpath(path)) as any);
    await service.refresh();
    expect(service.snapshot().checks.uploads).toBe('failed');
    expect(await fs.readdir(root)).toEqual([]);
  });
  test('production requires pre-provisioned root; development may create it', async () => {
    const missing = join(root, 'new-root');
    await expect(
      verifyUploadRoot(missing, false, new AbortController().signal),
    ).rejects.toBeDefined();
    await expect(
      verifyUploadRoot(missing, true, new AbortController().signal),
    ).resolves.toBeDefined();
    expect(await fs.readdir(missing)).toEqual([]);
  });
  test('root resolution changes and invalid community directory block readiness', async () => {
    await expect(
      verifyUploadRoot(
        root,
        false,
        new AbortController().signal,
        join(root, 'other'),
      ),
    ).rejects.toThrow('UPLOAD_ROOT_CHANGED');
    await fs.writeFile(join(root, 'community'), 'not a directory');
    await service.refresh();
    expect(service.snapshot().checks.uploads).toBe('failed');
  });
  test('disabled AI/pronunciation do not bypass required Community storage', async () => {
    await fs.writeFile(join(root, 'community'), 'invalid');
    await service.refresh();
    expect(service.snapshot().status).toBe('not_ready');
  });
  test('concurrent health reads use cached state, and failed probes can recover without restart', async () => {
    await service.refresh();
    const admin = jest.spyOn(connection.db!, 'admin');
    for (let i = 0; i < 20; i++)
      expect(service.snapshot().status).toBe('ready');
    expect(admin).not.toHaveBeenCalled();
    await connection.db!.collection('users').dropIndex('email_1');
    await service.refresh();
    expect(service.snapshot().status).toBe('not_ready');
    await connection
      .db!.collection('users')
      .createIndex({ email: 1 }, { unique: true });
    await service.refresh();
    expect(service.snapshot().status).toBe('ready');
  });
  test('expired cached verification cannot advertise permanently ready', async () => {
    await service.refresh();
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 20000);
    expect(service.snapshot().status).toBe('not_ready');
  });
  test('hung filesystem probe is bounded, single-flight and cannot restore readiness after shutdown', async () => {
    service = makeService({ READINESS_TIMEOUT_MS: 50 });
    const realpath = fs.realpath;
    let resume!: () => void;
    const held = new Promise<void>((done) => {
      resume = done;
    });
    jest.spyOn(fs, 'realpath').mockImplementation((async (path: any) => {
      await held;
      return realpath(path);
    }) as any);
    const start = Date.now();
    await service.onApplicationBootstrap();
    expect(Date.now() - start).toBeLessThan(1000);
    expect(service.snapshot().status).toBe('not_ready');
    service.stop();
    resume();
    await new Promise((done) => setTimeout(done, 100));
    expect(service.snapshot().status).toBe('not_ready');
    expect(await fs.readdir(root)).toEqual([]);
  });
  test('liveness remains available while DB is down; readiness is 503 and safely redacted', async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: ReadinessService, useValue: service },
        { provide: getConnectionToken(), useValue: connection },
      ],
    }).compile();
    const app = module.createNestApplication();
    app.useLogger(false);
    await app.init();
    try {
      await connection.close();
      await request(app.getHttpServer())
        .get('/health/live')
        .expect(200, { status: 'ok' });
      const response = await request(app.getHttpServer())
        .get('/health/ready')
        .expect(503);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(Object.keys(response.body).sort()).toEqual(['checks', 'status']);
      expect(response.text).not.toContain(root);
      expect(response.text).not.toContain(replica.getUri());
    } finally {
      await app.close();
    }
  });

  async function drainApplication(grace: number) {
    const module = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(replica.getUri(connection.name), {
          autoIndex: false,
          autoCreate: false,
        }),
      ],
      controllers: [HealthController, DrainTestController],
      providers: [
        ReadinessService,
        TrafficLifecycle,
        DelayedTestGuard,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            NODE_ENV: 'production',
            SHUTDOWN_GRACE_MS: grace,
            READINESS_TIMEOUT_MS: 1000,
          }),
        },
        { provide: CommunityImageStorage, useValue: { root } },
      ],
    }).compile();
    const app = module.createNestApplication();
    app.useLogger(false);
    const lifecycle = app.get(TrafficLifecycle);
    const exit = jest.fn();
    lifecycle.attach(app, exit);
    app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
    await app.listen(0, '127.0.0.1');
    return {
      app,
      lifecycle,
      exit,
      db: app.get<Connection>(getConnectionToken()),
    };
  }
  test('Nest SIGTERM lifecycle marks not ready, refuses new work, drains existing request and closes Mongo once', async () => {
    let release!: () => void;
    const started = new Promise<void>((done) => {
      beginWork = done;
    });
    finishWork = new Promise<void>((done) => {
      release = done;
    });
    const { app, lifecycle, db, exit } = await drainApplication(2000);
    const close = jest.spyOn(db, 'close');
    const hook = jest.spyOn(lifecycle, 'onModuleDestroy');
    try {
      await request(app.getHttpServer()).get('/health/ready').expect(200);
      const work = request(app.getHttpServer())
        .get('/work')
        .then((response) => response);
      await started;
      const closing = app.close('SIGTERM');
      for (
        let i = 0;
        i < 20 && app.get(ReadinessService).snapshot().status === 'ready';
        i++
      )
        await new Promise((done) => setTimeout(done, 5));
      await request(app.getHttpServer()).get('/health/ready').expect(503);
      await request(app.getHttpServer()).get('/health/live').expect(200);
      await request(app.getHttpServer())
        .get('/work')
        .expect(503)
        .expect((response) => expect(response.body.code).toBe('SHUTTING_DOWN'));
      expect(close).not.toHaveBeenCalled();
      release();
      expect((await work).status).toBe(200);
      await Promise.all([closing, app.close('SIGTERM')]);
      expect(hook).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
      expect(db.readyState).toBe(0);
      expect(exit).not.toHaveBeenCalled();
      expect(app.get(ReadinessService).snapshot().status).toBe('not_ready');
    } finally {
      release();
      await app.close();
    }
  });
  test('unresponsive in-flight work has bounded drain and socket disposal', async () => {
    let release!: () => void;
    const started = new Promise<void>((done) => {
      beginWork = done;
    });
    finishWork = new Promise<void>((done) => {
      release = done;
    });
    const { app } = await drainApplication(200);
    try {
      const work = request(app.getHttpServer())
        .get('/work')
        .then(
          () => 'completed',
          () => 'closed',
        );
      await started;
      const start = Date.now();
      await app.close('SIGTERM');
      expect(Date.now() - start).toBeLessThan(1500);
      expect(await work).toBe('closed');
    } finally {
      release();
      await app.close();
    }
  });
  test('client disconnect does not hide an executing controller from graceful drain', async () => {
    let release!: () => void;
    const started = new Promise<void>((done) => {
      beginWork = done;
    });
    finishWork = new Promise<void>((done) => {
      release = done;
    });
    const { app, db } = await drainApplication(2000);
    const close = jest.spyOn(db, 'close');
    try {
      const work = request(app.getHttpServer()).get('/work');
      const result = work.then(
        () => {},
        () => {},
      );
      await started;
      work.abort();
      const closing = app.close('SIGTERM');
      await new Promise((done) => setTimeout(done, 30));
      expect(close).not.toHaveBeenCalled();
      release();
      await closing;
      await result;
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await app.close();
    }
  });
  test('late guard completion during shutdown cannot begin controller work', async () => {
    let release!: () => void;
    const started = new Promise<void>((done) => {
      beginGuard = done;
    });
    finishGuard = new Promise<void>((done) => {
      release = done;
    });
    const began = jest.fn();
    beginWork = began;
    const { app, db } = await drainApplication(2000);
    const close = jest.spyOn(db, 'close');
    try {
      const response = request(app.getHttpServer())
        .get('/guarded-work')
        .then((result) => result);
      await started;
      const closing = app.close('SIGTERM');
      await new Promise((done) => setTimeout(done, 20));
      expect(close).not.toHaveBeenCalled();
      release();
      expect((await response).status).toBe(503);
      await closing;
      expect(began).not.toHaveBeenCalled();
    } finally {
      release();
      await app.close();
    }
  });
  test('client abort during a guard cannot start a controller or retain a drain record forever', async () => {
    let release!: () => void;
    const started = new Promise<void>((done) => {
      beginGuard = done;
    });
    finishGuard = new Promise<void>((done) => {
      release = done;
    });
    const began = jest.fn();
    beginWork = began;
    const { app } = await drainApplication(2000);
    try {
      const response = request(app.getHttpServer()).get('/guarded-work');
      const result = response.then(
        () => {},
        () => {},
      );
      await started;
      response.abort();
      await result;
      await new Promise((done) => setTimeout(done, 30));
      release();
      await new Promise((done) => setTimeout(done, 30));
      expect(began).not.toHaveBeenCalled();
      const start = Date.now();
      await app.close();
      expect(Date.now() - start).toBeLessThan(1000);
    } finally {
      release();
      await app.close();
    }
  });
  test('shutdown cancels waiting on a hung readiness check and ignores late success', async () => {
    let release!: () => void;
    const held = new Promise<void>((done) => {
      release = done;
    });
    const realpath = fs.realpath;
    jest.spyOn(fs, 'realpath').mockImplementation((async (path: any) => {
      await held;
      return realpath(path);
    }) as any);
    const flight = service.refresh();
    const start = Date.now();
    service.stop();
    await flight;
    expect(Date.now() - start).toBeLessThan(500);
    release();
    await new Promise((done) => setTimeout(done, 50));
    expect(service.snapshot().status).toBe('not_ready');
  });
  test('total shutdown watchdog fires once when framework disposal cannot finish', async () => {
    const { app, lifecycle, exit } = await drainApplication(60);
    try {
      await lifecycle.beginShutdown();
      await lifecycle.beginShutdown();
      await new Promise((done) => setTimeout(done, 100));
      expect(exit).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
  test('compiled production startup never repairs indexes or seeds data; routing stays gated until operator provisioning', async () => {
    const backend = resolve(__dirname, '../..');
    const uploadParent = join(backend, 'uploads');
    await fs.mkdir(uploadParent, { recursive: true });
    const productionRoot = await fs.mkdtemp(join(uploadParent, '.8b-test-'));
    let child: ReturnType<typeof spawn> | undefined;
    try {
      for (const index of CRITICAL_INDEXES)
        await connection.db!.collection(index.collection).dropIndex(index.id);
      await connection
        .db!.collection('flashcards')
        .createIndex(
          { userId: 1, targetWord: 1 },
          { unique: true, name: 'userId_1_targetWord_1' },
        );
      const reservation = createServer();
      reservation.listen(0, '127.0.0.1');
      await once(reservation, 'listening');
      const port = (reservation.address() as { port: number }).port;
      await new Promise<void>((done) => reservation.close(() => done()));
      child = spawn(process.execPath, ['scripts/start-production.cjs'], {
        cwd: backend,
        stdio: 'ignore',
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          NODE_ENV: 'production',
          MONGODB_URI: replica.getUri(connection.name),
          ALLOW_LOCAL_MONGODB: 'true',
          JWT_SECRET: randomUUID() + randomUUID(),
          CORS_ORIGINS: 'https://app.example.invalid',
          UPLOAD_ROOT: productionRoot,
          AI_ENABLED: 'false',
          PRONUNCIATION_ENABLED: 'false',
          PORT: String(port),
          READINESS_RECHECK_MS: '1000',
          READINESS_TIMEOUT_MS: '2000',
          SHUTDOWN_GRACE_MS: '1000',
        },
      });
      const endpoint = `http://127.0.0.1:${port}`;
      const waitFor = async (path: string, status: number) => {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline && child?.exitCode === null) {
          try {
            const response = await fetch(`${endpoint}${path}`, {
              signal: AbortSignal.timeout(500),
            });
            if (response.status === status) return;
          } catch {
            /* Starting. */
          }
          await new Promise((done) => setTimeout(done, 50));
        }
        throw new Error(
          'Disposable production process did not reach expected status',
        );
      };
      await waitFor('/health/live', 200);
      await waitFor('/health/ready', 503);
      await waitFor('/lessons', 503);
      for (const index of CRITICAL_INDEXES)
        expect(
          (await connection.db!.collection(index.collection).indexes()).some(
            (item) => item.name === index.id,
          ),
        ).toBe(false);
      expect(await connection.db!.collection('lessons').countDocuments()).toBe(
        0,
      );
      await provisionTestIndexes(connection);
      await waitFor('/health/ready', 503); // Legacy constraint is still present.
      await connection
        .db!.collection('flashcards')
        .dropIndex('userId_1_targetWord_1');
      await waitFor('/health/ready', 200);
      await waitFor('/lessons', 200);
      expect(await connection.db!.collection('lessons').countDocuments()).toBe(
        0,
      );
      expect(await fs.readdir(productionRoot)).toEqual([]);
    } finally {
      if (child && child.exitCode === null) {
        const stopped = once(child, 'exit');
        child.kill();
        await stopped;
      }
      const childPath = relative(uploadParent, productionRoot);
      if (!childPath.startsWith('.8b-test-') || childPath.includes(sep))
        throw new Error('Unsafe fixture cleanup');
      await fs.rm(productionRoot, { recursive: true, force: true });
    }
  });
});
