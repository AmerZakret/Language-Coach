import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Controller, Get } from '@nestjs/common';
import { Connection, createConnection } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import type { Server } from 'node:http';
import {
  CONTROL_COLLECTION,
  CONTROL_EVENTS,
  CONTROL_VALIDATOR,
  TimelineControl,
  isTimelineId,
} from './timeline-contract';
import {
  readTimelineControl,
  TimelineWriteGate,
  verifyTimelineSchema,
} from './timeline-gate';
import {
  applyControlRequest,
  ControlRequest,
} from '../tooling/timeline-control';
import { parseControlArguments } from '../tooling/timeline-control-cli';
import { ReadinessService } from './readiness.service';
import { HealthController } from './health.controller';
import { TrafficLifecycle } from './traffic-lifecycle.service';
import { CommunityImageStorage } from '../community/community-image.storage';
import { CRITICAL_INDEXES } from './index-inventory';
import { validateEnvironment } from '../config/runtime-config';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const init: ControlRequest = {
  action: 'initialize',
  eventId: '33333333-3333-4333-8333-333333333333',
  targetTimelineId: A,
  operatorReference: 'test-ticket',
};
const deployment = (
  expectedTimelineId = A,
  writeMode: 'CLOSED' | 'OPEN' = 'CLOSED',
) => ({ expectedTimelineId, writeMode });

@Controller('ordinary')
class OrdinaryRead {
  calls = 0;
  @Get() read() {
    this.calls++;
    return { ok: true };
  }
}

describe('10A control plane (disposable replica set only)', () => {
  jest.setTimeout(90000);
  let replica: MongoMemoryReplSet;
  let connection: Connection;
  let root: string;
  let draining: boolean;
  let infrastructureReady: boolean;
  let config: ConfigService;
  let gate: TimelineWriteGate;
  const control = () => readTimelineControl(connection, 2000);
  const apply = (
    req: ControlRequest,
    expected = req.targetTimelineId,
    mode: 'OPEN' | 'CLOSED' = req.action === 'open' ? 'OPEN' : 'CLOSED',
  ) => applyControlRequest(connection, req, deployment(expected, mode), 2000);
  const transition = async (
    action: 'open' | 'close' | 'install-timeline',
    target?: string,
  ) => {
    const row = await control();
    return apply({
      action,
      eventId: randomUUID(),
      targetTimelineId: target ?? row.dataTimelineId,
      expectedTimelineId: row.dataTimelineId,
      expectedState: row.writeState,
      expectedVersion: row.controlVersion,
      operatorReference: 'test-ticket',
      ...(action === 'install-timeline'
        ? { sourceTimelineId: row.dataTimelineId }
        : {}),
    });
  };
  beforeAll(async () => {
    replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  });
  beforeEach(async () => {
    connection = await createConnection(replica.getUri(), {
      dbName: `timeline_${randomUUID().replaceAll('-', '')}`,
      autoIndex: false,
      autoCreate: false,
      monitorCommands: true,
      serverSelectionTimeoutMS: 2000,
    }).asPromise();
    root = await mkdtemp(join(tmpdir(), 'timeline-10a-'));
    draining = false;
    infrastructureReady = true;
    config = new ConfigService({
      DATA_TIMELINE_ID: A,
      DATA_WRITE_MODE: 'OPEN',
      CLIENT_PROTOCOL_POLICY: 'ENFORCE_MUTATIONS',
      NODE_ENV: 'production',
      READINESS_TIMEOUT_MS: 2000,
    });
    gate = new TimelineWriteGate(
      connection,
      config,
      () => draining,
      () => infrastructureReady,
    );
  });
  afterEach(async () => {
    await connection.close();
    const child = relative(resolve(tmpdir()), resolve(root));
    if (!child.startsWith('timeline-10a-') || child.includes(sep))
      throw new Error('Unsafe fixture cleanup');
    await rm(root, { recursive: true, force: true });
  });
  afterAll(async () => {
    await replica.stop();
  });

  test('only explicit init creates a CLOSED singleton and atomic audit event; exact retry is idempotent', async () => {
    await expect(gate.resolveControl()).rejects.toMatchObject({
      code: 'TIMELINE_CONTROL_UNAVAILABLE',
    });
    expect(
      await connection
        .db!.listCollections({ name: CONTROL_COLLECTION })
        .hasNext(),
    ).toBe(false);
    const row = await apply(init);
    expect(row).toMatchObject({
      dataTimelineId: A,
      writeState: 'CLOSED',
      controlVersion: 0,
      fenceVersion: 0,
    });
    expect(await apply(init)).toEqual(row);
    expect(
      await connection.db!.collection(CONTROL_COLLECTION).countDocuments(),
    ).toBe(1);
    expect(
      await connection.db!.collection(CONTROL_EVENTS).countDocuments(),
    ).toBe(1);
    await verifyTimelineSchema(connection, 2000);
  });
  test('init conflicting timeline or event rejects without replacing existing metadata', async () => {
    const row = await apply(init);
    await expect(
      apply({ ...init, eventId: randomUUID(), targetTimelineId: B }),
    ).rejects.toMatchObject({ code: 'ALREADY_INITIALIZED' });
    await expect(apply({ ...init, targetTimelineId: B })).rejects.toMatchObject(
      { code: 'EVENT_RETRY_CONFLICT' },
    );
    expect(await control()).toEqual(row);
  });
  test('strict DB validator and unique singleton reject duplicate and malformed direct writes', async () => {
    const row = await apply(init);
    for (const extra of [
      { ...row },
      { ...row, _id: 'other' },
      { ...row, dataTimelineId: 'bad' },
    ]) {
      await expect(
        connection
          .db!.collection<TimelineControl>(CONTROL_COLLECTION)
          .insertOne(extra),
      ).rejects.toBeDefined();
    }
    await expect(
      connection
        .db!.collection(CONTROL_COLLECTION)
        .updateOne({}, { $set: { writeState: 'INVALID' } }),
    ).rejects.toBeDefined();
    expect(
      await connection.db!.collection(CONTROL_COLLECTION).countDocuments(),
    ).toBe(1);
  });
  test.each([
    'dataTimelineId',
    'writeState',
    'controlVersion',
    'createdAt',
    'lastEventId',
    'unexpected',
  ])('bypassed malformed metadata fails closed: %s', async (field) => {
    await apply(init);
    await transition('open');
    await connection
      .db!.collection(CONTROL_COLLECTION)
      .updateOne(
        {},
        { $set: { [field]: 'malformed' } },
        { bypassDocumentValidation: true },
      );
    await expect(gate.resolveControl()).rejects.toMatchObject({
      code: 'TIMELINE_CONTROL_UNAVAILABLE',
    });
  });
  test('duplicate inventory is rejected even if privileged writes bypass schema and index', async () => {
    const row = await apply(init);
    await connection
      .db!.collection(CONTROL_COLLECTION)
      .dropIndex('singleton_1');
    await connection
      .db!.collection<TimelineControl>(CONTROL_COLLECTION)
      .insertOne({ ...row, _id: 'other' }, { bypassDocumentValidation: true });
    await expect(gate.resolveControl()).rejects.toMatchObject({
      code: 'TIMELINE_CONTROL_UNAVAILABLE',
    });
  });
  test('existing unvalidated collection is not silently repaired by init', async () => {
    await connection.db!.createCollection(CONTROL_COLLECTION);
    await expect(apply(init)).rejects.toMatchObject({
      code: 'CONTROL_OPERATION_FAILED',
    });
    expect(
      await connection.db!.collection(CONTROL_COLLECTION).countDocuments(),
    ).toBe(0);
  });
  test('transitions require exact CAS; OPEN A -> B rejected; closed install/open are explicit and retryable', async () => {
    await apply(init);
    const opened = await transition('open');
    const install: ControlRequest = {
      action: 'install-timeline',
      eventId: randomUUID(),
      targetTimelineId: B,
      expectedTimelineId: A,
      expectedState: 'OPEN',
      expectedVersion: opened.controlVersion,
      sourceTimelineId: A,
      operatorReference: 'test-ticket',
    };
    await expect(apply(install)).rejects.toMatchObject({
      code: 'CONTROL_MUST_BE_CLOSED',
    });
    await expect(
      apply({
        ...install,
        action: 'close',
        sourceTimelineId: undefined,
        targetTimelineId: A,
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: 'CONTROL_CAS_CONFLICT' });
    const closed = await transition('close');
    install.expectedState = 'CLOSED';
    install.expectedVersion = closed.controlVersion;
    const installed = await apply(install);
    expect(installed).toMatchObject({
      dataTimelineId: B,
      writeState: 'CLOSED',
      sourceTimelineId: A,
    });
    expect(await apply(install)).toEqual(installed);
    await expect(
      apply({ ...install, targetTimelineId: A }),
    ).rejects.toBeDefined();
    const final = await transition('open');
    expect(final).toMatchObject({ dataTimelineId: B, writeState: 'OPEN' });
    await expect(apply(install)).rejects.toMatchObject({
      code: 'EVENT_RETRY_CONFLICT',
    });
  });
  test('known old IDs cannot be reinstalled and unchanged ID is not a fresh timeline', async () => {
    await apply(init);
    await expect(
      apply({
        action: 'install-timeline',
        eventId: randomUUID(),
        targetTimelineId: B,
        expectedTimelineId: A,
        expectedState: 'CLOSED',
        expectedVersion: 0,
        sourceTimelineId: B,
        operatorReference: 'test-ticket',
      }),
    ).rejects.toMatchObject({ code: 'FRESH_TIMELINE_REQUIRED' });
    await expect(transition('install-timeline', A)).rejects.toMatchObject({
      code: 'FRESH_TIMELINE_REQUIRED',
    });
    await transition('install-timeline', B);
    await expect(transition('install-timeline', A)).rejects.toMatchObject({
      code: 'TIMELINE_ALREADY_USED',
    });
  });
  test('latch and independent expectation guard operator transitions; no unsafe open shortcut', async () => {
    await expect(apply(init, A, 'OPEN')).rejects.toMatchObject({
      code: 'OPERATOR_LATCH_MUST_BE_CLOSED',
    });
    await expect(apply(init, B)).rejects.toMatchObject({
      code: 'DEPLOYMENT_TIMELINE_MISMATCH',
    });
    await apply(init);
    const row = await control();
    const open: ControlRequest = {
      action: 'open',
      eventId: randomUUID(),
      targetTimelineId: A,
      expectedTimelineId: A,
      expectedState: 'CLOSED',
      expectedVersion: row.controlVersion,
      operatorReference: 'test-ticket',
    };
    await expect(apply(open, A, 'CLOSED')).rejects.toMatchObject({
      code: 'OPERATOR_LATCH_MUST_BE_OPEN',
    });
  });
  test('concurrent CAS operators commit at most one transition/audit event', async () => {
    await apply(init);
    const row = await control();
    const req: ControlRequest = {
      action: 'open',
      eventId: randomUUID(),
      targetTimelineId: A,
      expectedTimelineId: A,
      expectedState: 'CLOSED',
      expectedVersion: row.controlVersion,
      operatorReference: 'test-ticket',
    };
    const results = await Promise.allSettled([
      apply(req),
      apply({ ...req, eventId: randomUUID() }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      await connection.db!.collection(CONTROL_EVENTS).countDocuments(),
    ).toBe(2);
  });
  test('matching instances are ready; old/new expectations, DB close, and operator close fail closed without repair', async () => {
    await apply(init);
    await transition('open');
    const other = new TimelineWriteGate(
      connection,
      config,
      () => false,
      () => true,
    );
    const future = new TimelineWriteGate(
      connection,
      new ConfigService({
        DATA_TIMELINE_ID: B,
        DATA_WRITE_MODE: 'OPEN',
        CLIENT_PROTOCOL_POLICY: 'ENFORCE_MUTATIONS',
      }),
      () => false,
      () => true,
    );
    await expect(gate.assertWritesPermitted()).resolves.toMatchObject({
      dataTimelineId: A,
    });
    await expect(other.assertWritesPermitted()).resolves.toMatchObject({
      dataTimelineId: A,
    });
    await expect(future.assertWritesPermitted()).rejects.toMatchObject({
      code: 'TIMELINE_MISMATCH',
    });
    config.set('DATA_WRITE_MODE', 'CLOSED');
    for (const instance of [gate, other])
      await expect(instance.assertWritesPermitted()).rejects.toMatchObject({
        code: 'WRITES_CLOSED',
      });
    config.set('DATA_WRITE_MODE', 'OPEN');
    await transition('close');
    for (const instance of [gate, other])
      await expect(instance.assertWritesPermitted()).rejects.toMatchObject({
        code: 'WRITES_CLOSED',
      });
    await transition('install-timeline', B);
    await transition('open');
    await expect(gate.assertWritesPermitted()).rejects.toMatchObject({
      code: 'TIMELINE_MISMATCH',
    });
    await expect(future.assertWritesPermitted()).resolves.toMatchObject({
      dataTimelineId: B,
    });
  });
  test('restart, scaling, build/protocol changes and repeated control probes never mutate metadata', async () => {
    await apply(init);
    await transition('open');
    const before = await control();
    for (let i = 0; i < 3; i++) {
      const instance = new TimelineWriteGate(
        connection,
        new ConfigService({
          DATA_TIMELINE_ID: A,
          DATA_WRITE_MODE: 'OPEN',
          CLIENT_PROTOCOL_POLICY: 'ENFORCE_MUTATIONS',
          RELEASE_BUILD_ID: `build-${i}`,
          CURRENT_CLIENT_PROTOCOL: i,
        }),
        () => false,
        () => true,
      );
      await instance.resolveControl();
      await instance.resolveControl();
    }
    expect(await control()).toEqual(before);
  });
  test('drain, infrastructure failure, missing/invalid deployment expectation all refuse admission', async () => {
    await apply(init);
    await transition('open');
    draining = true;
    await expect(gate.assertWritesPermitted()).rejects.toMatchObject({
      code: 'WRITES_CLOSED',
    });
    draining = false;
    infrastructureReady = false;
    await expect(gate.assertWritesPermitted()).rejects.toMatchObject({
      code: 'TIMELINE_CONTROL_UNAVAILABLE',
    });
    infrastructureReady = true;
    for (const value of ['', 'invalid']) {
      config.set('DATA_TIMELINE_ID', value);
      await expect(gate.resolveControl()).rejects.toMatchObject({
        code: 'TIMELINE_CONTROL_UNAVAILABLE',
      });
    }
  });
  test('matching transaction fence does a real shared-document write and commits domain change', async () => {
    await apply(init);
    await transition('open');
    const domain = connection.db!.collection('syntheticdomain');
    await domain.insertOne({ value: 0 });
    const before = await control();
    const session = await connection.startSession({ defaultTimeoutMS: 2000 });
    try {
      await session.withTransaction(async () => {
        await gate.assertAndTouchWriteFence(session, A);
        await domain.updateOne({}, { $set: { value: 1 } }, { session });
      });
      expect((await control()).fenceVersion).toBe(before.fenceVersion + 1);
      expect((await control()).controlVersion).toBe(before.controlVersion);
      expect(await domain.findOne({})).toMatchObject({ value: 1 });
    } finally {
      await session.endSession();
    }
  });
  test.each([
    'closed',
    'mismatch',
    'db-mismatch',
    'operator',
    'drain',
    'no-transaction',
    'unbounded-session',
  ])('failed fence aborts domain writes: %s', async (reason) => {
    await apply(init);
    if (reason !== 'closed') await transition('open');
    if (reason === 'db-mismatch') {
      await transition('close');
      await transition('install-timeline', B);
      await transition('open');
    }
    if (reason === 'operator') config.set('DATA_WRITE_MODE', 'CLOSED');
    if (reason === 'drain') draining = true;
    const domain = connection.db!.collection('syntheticdomain');
    await domain.insertOne({ value: 0 });
    const session = await connection.startSession(
      reason === 'unbounded-session' ? {} : { defaultTimeoutMS: 2000 },
    );
    try {
      if (reason !== 'no-transaction') {
        session.startTransaction();
        await domain.updateOne({}, { $set: { value: 1 } }, { session });
      }
      await expect(
        gate.assertAndTouchWriteFence(session, reason === 'mismatch' ? B : A),
      ).rejects.toHaveProperty('code');
      expect(session.inTransaction()).toBe(false);
      expect(await domain.findOne({})).toMatchObject({ value: 0 });
    } finally {
      await session.endSession();
    }
  });
  test('committed concurrent control close aborts stale snapshot transaction; no domain effect survives', async () => {
    await apply(init);
    await transition('open');
    const domain = connection.db!.collection('syntheticdomain');
    await domain.insertOne({ value: 0 });
    const session = await connection.startSession({ defaultTimeoutMS: 2000 });
    try {
      session.startTransaction({ readConcern: { level: 'snapshot' } });
      await readTimelineControl(connection, 2000, session); // Establish OPEN A snapshot.
      await domain.updateOne({}, { $set: { value: 1 } }, { session });
      await transition('close'); // Different session writes same control document.
      await expect(
        gate.assertAndTouchWriteFence(session, A),
      ).rejects.toMatchObject({ code: 'FENCE_CONFLICT' });
      expect(session.inTransaction()).toBe(false);
      expect(await domain.findOne({})).toMatchObject({ value: 0 });
    } finally {
      await session.endSession();
    }
  });
  test('safe readiness 503, cheap liveness and fresh ordinary admission despite cached ready state', async () => {
    await apply(init);
    await transition('open');
    for (const index of CRITICAL_INDEXES)
      await connection
        .db!.collection(index.collection)
        .createIndex(index.key, { unique: true, name: index.id });
    const readiness = new ReadinessService(connection, config, {
      root,
    } as CommunityImageStorage);
    const module = await Test.createTestingModule({
      controllers: [HealthController, OrdinaryRead],
      providers: [
        { provide: ReadinessService, useValue: readiness },
        { provide: ConfigService, useValue: config },
        TrafficLifecycle,
      ],
    }).compile();
    const app = module.createNestApplication();
    app.useLogger(false);
    const server = app.getHttpServer() as Server;
    const lifecycle = app.get(TrafficLifecycle);
    lifecycle.attach(app);
    try {
      await app.init();
      await request(server).get('/health/ready').expect(200);
      await request(server).get('/ordinary').expect(200);
      await transition('close');
      await request(server).get('/ordinary').expect(503); // Previous readiness snapshot is still green.
      expect(app.get(OrdinaryRead).calls).toBe(1);
      await readiness.refresh();
      const response = await request(server).get('/health/ready').expect(503);
      expect(response.body).toMatchObject({ checks: { timeline: 'failed' } });
      expect(response.text).not.toMatch(
        new RegExp(
          `${A}|${root.replaceAll('\\', '\\\\')}|mongodb|stack|password`,
          'i',
        ),
      );
      const readSpy = jest.spyOn(connection.db!, 'collection');
      await request(server).get('/health/live').expect(200, { status: 'ok' });
      expect(readSpy).not.toHaveBeenCalled();
      readSpy.mockRestore();
      await transition('install-timeline', B);
      await transition('open');
      await readiness.refresh();
      await request(server).get('/health/ready').expect(503);
      config.set('DATA_TIMELINE_ID', B);
      await readiness.refresh();
      await request(server).get('/health/ready').expect(200);
      await lifecycle.beginShutdown();
      await request(server).get('/health/ready').expect(503);
    } finally {
      await app.close();
    }
  });
  test('readiness rejects missing, malformed, duplicate, unvalidated control and missing critical control index', async () => {
    for (const index of CRITICAL_INDEXES)
      await connection
        .db!.collection(index.collection)
        .createIndex(index.key, { unique: true, name: index.id });
    const readiness = new ReadinessService(connection, config, {
      root,
    } as CommunityImageStorage);
    try {
      await readiness.refresh();
      expect(readiness.snapshot().checks.timeline).toBe('failed');
      // Disposable collection created above has no validator; only this test explicitly provisions it.
      await connection.db!.command({
        collMod: CONTROL_COLLECTION,
        validator: CONTROL_VALIDATOR,
        validationLevel: 'strict',
        validationAction: 'error',
      });
      await apply(init);
      await transition('open');
      await readiness.refresh();
      expect(readiness.snapshot().status).toBe('ready');
      await connection
        .db!.collection(CONTROL_COLLECTION)
        .dropIndex('singleton_1');
      await readiness.refresh();
      expect(readiness.snapshot().checks.indexes).toBe('failed');
      await connection
        .db!.collection(CONTROL_COLLECTION)
        .updateOne(
          {},
          { $set: { dataTimelineId: 'bad' } },
          { bypassDocumentValidation: true },
        );
      await readiness.refresh();
      expect(readiness.snapshot().checks.timeline).toBe('failed');
    } finally {
      readiness.stop();
    }
  });
  test.each([
    'matching',
    'mismatch',
    'mongo-closed',
    'operator-closed',
    'missing-expected',
    'missing-latch',
  ])(
    'effective readiness composes independent deployment/Mongo state: %s',
    async (condition) => {
      await apply(init);
      await transition('open');
      for (const index of CRITICAL_INDEXES)
        await connection
          .db!.collection(index.collection)
          .createIndex(index.key, { unique: true, name: index.id });
      if (condition === 'mismatch') config.set('DATA_TIMELINE_ID', B);
      if (condition === 'mongo-closed') await transition('close');
      if (condition === 'operator-closed')
        config.set('DATA_WRITE_MODE', 'CLOSED');
      if (condition === 'missing-expected')
        config.set('DATA_TIMELINE_ID', undefined);
      if (condition === 'missing-latch')
        config.set('DATA_WRITE_MODE', undefined);
      const readiness = new ReadinessService(connection, config, {
        root,
      } as CommunityImageStorage);
      try {
        await readiness.refresh();
        expect(readiness.snapshot()).toMatchObject({
          status: condition === 'matching' ? 'ready' : 'not_ready',
          checks: {
            database: 'ok',
            transactions: 'ok',
            indexes: 'ok',
            uploads: 'ok',
            timeline: condition === 'matching' ? 'ok' : 'failed',
          },
        });
      } finally {
        readiness.stop();
      }
    },
  );
  test('CLI production confirmations and target/event/CAS parameters are explicit and help never connects', () => {
    expect(() => parseControlArguments(['initialize'], true)).toThrow();
    const args = [
      'initialize',
      '--target',
      A,
      '--event',
      init.eventId,
      '--operator',
      'test-ticket',
      '--confirm-database',
      'test',
    ];
    expect(() => parseControlArguments(args, true)).toThrow(
      'PRODUCTION_AND_MAINTENANCE_CONFIRMATION_REQUIRED',
    );
    expect(
      parseControlArguments(
        [...args, '--confirm-production', '--maintenance-isolated'],
        true,
      ).request,
    ).toEqual(init);
    expect(() =>
      parseControlArguments([...args, '--target', B], false),
    ).toThrow('INVALID_OPTION');
    const result = spawnSync(
      process.execPath,
      ['dist/src/tooling/timeline-control-cli.js', '--help'],
      {
        cwd: resolve(__dirname, '../..'),
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
        encoding: 'utf8',
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('OPERATOR_TOOL');
  });
  test('compiled operator CLI initializes only the confirmed disposable production target, retries safely, and inspects without changes', async () => {
    const secret = randomUUID() + randomUUID();
    const args = [
      'initialize',
      '--target',
      A,
      '--event',
      init.eventId,
      '--operator',
      init.operatorReference,
      '--confirm-database',
      connection.name,
      '--confirm-production',
      '--maintenance-isolated',
    ];
    const run = (command: string[]) =>
      spawnSync(
        process.execPath,
        ['dist/src/tooling/timeline-control-cli.js', ...command],
        {
          cwd: resolve(__dirname, '../..'),
          encoding: 'utf8',
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            NODE_ENV: 'production',
            CLIENT_PROTOCOL_POLICY: 'ALLOW_LEGACY',
            DATA_TIMELINE_ID: A,
            DATA_WRITE_MODE: 'CLOSED',
            MONGODB_URI: replica.getUri(connection.name),
            ALLOW_LOCAL_MONGODB: 'true',
            JWT_SECRET: secret,
            AI_ENABLED: 'false',
            PRONUNCIATION_ENABLED: 'false',
            CORS_ORIGINS: 'https://app.example.invalid',
            UPLOAD_ROOT: resolve('persistent-uploads'),
          },
        },
      );
    expect(run(args.slice(0, -2)).status).toBe(1);
    expect(
      await connection
        .db!.listCollections({ name: CONTROL_COLLECTION })
        .hasNext(),
    ).toBe(false);
    const initialized = run(args);
    expect(initialized.status).toBe(0);
    expect(initialized.stdout).toContain('operator_timeline_initialize');
    expect(initialized.stdout + initialized.stderr).not.toContain(secret);
    const before = await control();
    expect(run(args).status).toBe(0);
    expect(run(['inspect']).status).toBe(0);
    expect(await control()).toEqual(before);
    expect(
      await connection.db!.collection(CONTROL_EVENTS).countDocuments(),
    ).toBe(1);
  });
  test('runtime/startup/public controller graph excludes operator tooling; preflight and CI only validate synthetic configuration', () => {
    const repository = resolve(__dirname, '../../..');
    for (const file of [
      'app.module.ts',
      'main.ts',
      'operations/operations.module.ts',
      'operations/readiness.service.ts',
      'operations/traffic-lifecycle.service.ts',
    ])
      expect(
        readFileSync(resolve(__dirname, '..', file), 'utf8'),
      ).not.toContain('tooling/');
    const preflight = readFileSync(
      join(repository, 'lingua_ai_backend/scripts/deployment-preflight.cjs'),
      'utf8',
    );
    expect(preflight).not.toContain('timeline-control');
    const quality = readFileSync(
      join(repository, 'scripts/quality-check.cjs'),
      'utf8',
    );
    expect(quality).toContain(`DATA_TIMELINE_ID: '${A}'`);
    expect(quality).toContain("DATA_WRITE_MODE: 'CLOSED'");
    expect(quality).not.toContain('timeline-control-cli');
  });
});

describe('10A explicit bounded production configuration', () => {
  const production = () => ({
    NODE_ENV: 'production',
    CLIENT_PROTOCOL_POLICY: 'ALLOW_LEGACY',
    DATA_TIMELINE_ID: A,
    DATA_WRITE_MODE: 'CLOSED',
    MONGODB_URI: 'mongodb://db.example.invalid/test',
    JWT_SECRET: randomUUID() + randomUUID(),
    AI_ENABLED: false,
    PRONUNCIATION_ENABLED: false,
    CORS_ORIGINS: 'https://app.example.invalid',
    UPLOAD_ROOT: resolve('persistent-uploads'),
  });
  test.each([
    undefined,
    '',
    'bad',
    A.toUpperCase().replace('11111111', 'ABCDEFAB'),
    'x'.repeat(10000),
    '00000000-0000-0000-0000-000000000000',
    ` ${A}`,
  ])('rejects missing/malformed non-secret timeline %#', (value) => {
    expect(() =>
      validateEnvironment({ ...production(), DATA_TIMELINE_ID: value }),
    ).toThrow('DATA_TIMELINE_ID');
    expect(isTimelineId(value)).toBe(false);
  });
  test.each([undefined, '', 'open', 'unknown'])(
    'production requires explicit operator latch %#',
    (value) => {
      expect(() =>
        validateEnvironment({ ...production(), DATA_WRITE_MODE: value }),
      ).toThrow('DATA_WRITE_MODE');
    },
  );
  test('synthetic local/test configuration is explicit and missing local latch defaults CLOSED without generating timeline', () => {
    const local = {
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://localhost/disposable',
      JWT_SECRET: 'test-only',
    };
    expect(validateEnvironment(local)).toMatchObject({
      DATA_TIMELINE_ID: '',
      DATA_WRITE_MODE: 'CLOSED',
    });
    expect(
      validateEnvironment({
        ...local,
        DATA_TIMELINE_ID: A,
        DATA_WRITE_MODE: 'OPEN',
        CLIENT_PROTOCOL_POLICY: 'ENFORCE_MUTATIONS',
      }),
    ).toMatchObject({
      DATA_TIMELINE_ID: A,
      DATA_WRITE_MODE: 'OPEN',
      CLIENT_PROTOCOL_POLICY: 'ENFORCE_MUTATIONS',
    });
    expect(validateEnvironment(production()).DATA_TIMELINE_ID).toBe(A);
  });
});
