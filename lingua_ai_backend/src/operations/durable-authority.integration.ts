// Explicit Docker-only integration suite; default *.spec.ts suite never silently skips this file.
import { Client } from 'pg';
import { createConnection, Connection } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { readAuthority, DurableTimelineAuthority } from './durable-authority';
import {
  AuthorityOperator,
  AuthorityRequest,
  coordinateAuthority,
  mongoEvent,
} from '../tooling/durable-control';
import { applyControlRequest } from '../tooling/timeline-control';
import { readTimelineControl, TimelineWriteGate } from './timeline-gate';
import { MutationTimeline } from './mutation-timeline';
import { CRITICAL_INDEXES } from './index-inventory';

jest.setTimeout(60000);
const A = '11111111-1111-4111-8111-111111111111',
  B = '22222222-2222-4222-8222-222222222222';
const env = 'synthetic-c1',
  storage = 'synthetic-c1-authority';
let admin: Client,
  op: AuthorityOperator,
  uri: string,
  reader: string,
  mongo: Connection;
const base = process.env.C1_TEST_ADMIN_URL || '';
function credentials(source: string, user: string, password: string) {
  const u = new URL(source);
  u.username = user;
  u.password = password;
  return u.toString();
}
const request = (
  action: AuthorityRequest['action'],
  revision: number,
  timeline = A,
): AuthorityRequest => ({
  action,
  environment: env,
  storageIdentity: storage,
  timelineId: timeline,
  eventId: randomUUID(),
  expectedRevision: revision,
  operatorReference: 'synthetic-ticket',
  isolationReference: 'synthetic-stopped-writers',
  uploadRecoveryReference: 'synthetic-coordinated-uploads',
  historyContinuityReference: 'synthetic-independent-history-reviewed',
  mongoClosedVersion: 0,
});
const state = () => readAuthority(reader, env, storage, 1000);
beforeAll(() => {
  if (
    new URL(base).hostname !== 'authority' ||
    new URL(base).pathname !== '/timeline_authority'
  )
    throw Error('Disposable authority DNS/database required');
  if (!process.env.C1_TEST_MONGO_URI?.startsWith('mongodb://mongo:27017/'))
    throw Error('Disposable Mongo required');
});
beforeEach(async () => {
  const db = 'c1_' + randomUUID().replaceAll('-', '');
  const root = new Client({ connectionString: base });
  await root.connect();
  await root.query('CREATE DATABASE ' + db);
  await root.end();
  const u = new URL(base);
  u.pathname = '/' + db;
  uri = u.toString();
  admin = new Client({ connectionString: uri });
  await admin.connect();
  await admin.query(
    readFileSync(
      resolve(__dirname, '../../../deployment/staging/authority-schema.sql'),
      'utf8',
    ),
  );
  const operator = credentials(
    uri,
    'timeline_operator',
    process.env.C1_TEST_OPERATOR_PASSWORD!,
  );
  reader = credentials(
    uri,
    'timeline_reader',
    process.env.C1_TEST_READER_PASSWORD!,
  );
  op = new AuthorityOperator(operator, 1000);
  await op.connect();
});
afterEach(async () => {
  await op?.close();
  await admin?.end();
  if (mongo) {
    await mongo.close();
    mongo = undefined as never;
  }
});

test('explicit first initialization, identity verification and existing initialization rejection', async () => {
  await expect(state()).rejects.toThrow();
  await op.transition(request('initialize', 0));
  expect((await state()).mode).toBe('CLOSED');
  await expect(op.transition(request('initialize', 0))).rejects.toThrow();
  await expect(
    readAuthority(reader, 'other-environment', storage, 1000),
  ).rejects.toThrow();
});

test('missing independent history cannot adopt even an empty matching old Mongo initialization', async () => {
  const db = 'c1_' + randomUUID().replaceAll('-', '');
  const u = new URL(process.env.C1_TEST_MONGO_URI!);
  u.pathname = '/' + db;
  mongo = createConnection(u.toString(), {
    autoIndex: false,
    autoCreate: false,
  });
  await mongo.asPromise();
  const r = request('initialize', 0);
  await applyControlRequest(
    mongo,
    {
      action: 'initialize',
      targetTimelineId: A,
      eventId: mongoEvent(r.eventId, 'initialize'),
      operatorReference: r.operatorReference,
    },
    { expectedTimelineId: A, writeMode: 'CLOSED' },
    1000,
  );
  await expect(
    coordinateAuthority(op, mongo, r, {
      environment: env,
      storageIdentity: storage,
      newEnvironment: true,
      uploadRoot: '/tmp',
      deploymentTimeline: A,
      deploymentGeneration: 1,
      writeMode: 'CLOSED',
      protocolPolicy: 'ENFORCE_MUTATIONS',
    }),
  ).rejects.toThrow('TIMELINE_CONTROL_UNAVAILABLE');
  expect(
    (
      await admin.query<{ count: string }>(
        'SELECT count(*) FROM timeline_authority.issued',
      )
    ).rows[0].count,
  ).toBe('0');
});
test('CAS success, stale revision and deterministic concurrent CAS have one winner', async () => {
  await op.transition(request('initialize', 0));
  const r = request('open', 1);
  const other = new AuthorityOperator(op.uri, 1000);
  await other.connect();
  try {
    const results = await Promise.allSettled([
      op.transition(r),
      other.transition({ ...r, eventId: randomUUID() }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await state()).revision).toBe(2);
    await expect(op.transition(request('close', 1))).rejects.toThrow('CAS');
  } finally {
    await other.close();
  }
});
test('generation monotonicity, global UUID uniqueness, audit immutability and role restrictions', async () => {
  await op.transition(request('initialize', 0));
  await op.transition(request('maintenance', 1));
  await op.transition(request('allocate', 2, B));
  expect((await state()).generation).toBe(2);
  await expect(op.transition(request('allocate', 3, A))).rejects.toThrow();
  await expect(
    op.client.query('UPDATE timeline_authority.audit SET actor=$1', [
      'changed',
    ]),
  ).rejects.toThrow();
  await expect(
    admin.query('DELETE FROM timeline_authority.audit'),
  ).rejects.toThrow('APPEND_ONLY');
  await expect(
    admin.query('TRUNCATE timeline_authority.issued'),
  ).rejects.toThrow();
  const read = new Client({ connectionString: reader });
  await read.connect();
  try {
    await expect(
      read.query('SELECT timeline_authority.transition($1::jsonb)', [
        JSON.stringify(request('open', 3, B)),
      ]),
    ).rejects.toThrow();
  } finally {
    await read.end();
  }
  expect(
    (
      await admin.query<{ count: string }>(
        'SELECT count(*) FROM timeline_authority.audit',
      )
    ).rows[0].count,
  ).toBe('3');
});
test('reject illegal transition, malformed identity, cross-environment action and missing operator intent', async () => {
  await op.transition(request('initialize', 0));
  await expect(op.transition(request('allocate', 1, B))).rejects.toThrow();
  await expect(
    op.transition({ ...request('open', 1), environment: 'other' }),
  ).rejects.toThrow('IDENTITY');
  await expect(
    op.transition({ ...request('open', 1), operatorReference: '' }),
  ).rejects.toThrow();
  await expect(
    op.transition({ ...request('open', 1), environment: 'bad env' }),
  ).rejects.toThrow();
  expect((await state()).mode).toBe('CLOSED');
});
test('closed-state restart, outage, timeout, ledger damage and exact issuance retry fail safely', async () => {
  await op.transition(request('initialize', 0));
  await op.close();
  op = new AuthorityOperator(op.uri, 1000);
  await op.connect();
  expect((await state()).mode).toBe('CLOSED');
  await op.transition(request('maintenance', 1));
  const issue = request('allocate', 2, B);
  await op.transition(issue);
  await expect(op.transition(issue)).resolves.toMatchObject({
    generation: 2,
    revision: 3,
  });
  const unavailable = new URL(reader);
  unavailable.port = '1';
  await expect(
    readAuthority(unavailable.toString(), env, storage, 100),
  ).rejects.toThrow();
  await admin.query('BEGIN');
  await admin.query(
    'LOCK TABLE timeline_authority.state IN ACCESS EXCLUSIVE MODE',
  );
  try {
    await expect(readAuthority(reader, env, storage, 100)).rejects.toThrow();
  } finally {
    await admin.query('ROLLBACK');
  }
  // Privileged damage simulation only; ordinary operator cannot delete ledger/history.
  await admin.query(
    'ALTER TABLE timeline_authority.issued DISABLE TRIGGER issued_immutable',
  );
  await admin.query(
    'DELETE FROM timeline_authority.issued WHERE timeline_id=$1',
    [A],
  );
  await expect(state()).rejects.toThrow();
});
test.each(['OPEN', 'MAINTENANCE'] as const)(
  'illegal OPEN from %s must leave a disagreeing CLOSED Mongo untouched',
  async (mode) => {
    const db = 'c1_' + randomUUID().replaceAll('-', '');
    const mu = new URL(process.env.C1_TEST_MONGO_URI!);
    mu.pathname = '/' + db;
    mongo = createConnection(mu.toString(), {
      autoIndex: false,
      autoCreate: false,
    });
    await mongo.asPromise();
    for (const i of CRITICAL_INDEXES)
      if (i.collection !== 'timelinecontrol')
        await mongo
          .db!.collection(i.collection)
          .createIndex(i.key, { unique: true, name: i.id });
    const uploadRoot = '/tmp/' + db;
    mkdirSync(uploadRoot);
    const options = {
      environment: env,
      storageIdentity: storage,
      newEnvironment: true,
      uploadRoot,
      deploymentTimeline: A,
      deploymentGeneration: 1,
      writeMode: 'CLOSED' as 'CLOSED' | 'OPEN',
      protocolPolicy: 'ENFORCE_MUTATIONS',
    };
    await coordinateAuthority(op, mongo, request('initialize', 0), options);
    if (mode === 'OPEN') {
      options.writeMode = 'OPEN';
      const openPlan = request('open', 1);
      await coordinateAuthority(op, mongo, openPlan, options);
      const opened = await state();
      await expect(
        coordinateAuthority(op, mongo, openPlan, options),
      ).resolves.toMatchObject(opened);
      await expect(
        coordinateAuthority(
          op,
          mongo,
          { ...openPlan, operatorReference: 'altered-retry' },
          options,
        ),
      ).rejects.toThrow('EVENT_RETRY_CONFLICT');
      const current = await readTimelineControl(mongo, 1000);
      // Synthetic disagreement only: emulate an older CLOSED control without rewinding PostgreSQL.
      await applyControlRequest(
        mongo,
        {
          action: 'close',
          targetTimelineId: A,
          expectedTimelineId: A,
          expectedState: 'OPEN',
          expectedVersion: current.controlVersion,
          eventId: randomUUID(),
          operatorReference: 'synthetic-disagreement',
        },
        { expectedTimelineId: A, writeMode: 'CLOSED' },
        1000,
      );
      await expect(
        coordinateAuthority(op, mongo, openPlan, options),
      ).rejects.toThrow('OPEN_REQUIRES_CLOSED_AUTHORITY');
    } else await op.transition(request('maintenance', 1));
    const authorityBefore = await state();
    const mongoBefore = await readTimelineControl(mongo, 1000);
    options.writeMode = 'OPEN';
    await expect(
      coordinateAuthority(
        op,
        mongo,
        request('open', authorityBefore.revision),
        options,
      ),
    ).rejects.toThrow();
    expect(await readTimelineControl(mongo, 1000)).toEqual(mongoBefore);
    expect(await state()).toEqual(authorityBefore);
  },
);

test('schema rejects malformed values, reader cannot mutate or escalate, and damaged state fails closed', async () => {
  await op.transition(request('initialize', 0));
  await expect(
    admin.query("UPDATE timeline_authority.state SET mode='INVALID'"),
  ).rejects.toThrow();
  await expect(
    admin.query('UPDATE timeline_authority.state SET generation=0'),
  ).rejects.toThrow();
  const runtime = new Client({ connectionString: reader });
  await runtime.connect();
  try {
    for (const query of [
      "UPDATE timeline_authority.state SET mode='OPEN'",
      "UPDATE timeline_authority.audit SET actor='changed'",
      'DELETE FROM timeline_authority.audit',
      'TRUNCATE timeline_authority.issued',
      'SET ROLE timeline_operator',
      'SET ROLE authority_admin',
      "SELECT timeline_authority.transition('{}'::jsonb)",
    ])
      await expect(runtime.query(query)).rejects.toThrow();
    expect(
      (
        await runtime.query(
          'SELECT rolsuper,rolcreaterole,rolcreatedb,rolreplication FROM pg_roles WHERE rolname=current_user',
        )
      ).rows[0],
    ).toEqual({
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
    });
  } finally {
    await runtime.end();
  }
  // Only a privileged administrator can create this internally inconsistent record.
  await admin.query('UPDATE timeline_authority.state SET revision=revision+1');
  await expect(state()).rejects.toThrow('TIMELINE_CONTROL_UNAVAILABLE');
  expect(
    (
      await admin.query<{ count: string }>(
        'SELECT count(*) FROM timeline_authority.audit',
      )
    ).rows[0].count,
  ).toBe('1');
});

test('A-to-B coordinator, all crash boundaries, stale writer/generation and Mongo-only rollback', async () => {
  const db = 'c1_' + randomUUID().replaceAll('-', '');
  const mu = new URL(process.env.C1_TEST_MONGO_URI!);
  mu.pathname = '/' + db;
  mongo = createConnection(mu.toString(), {
    autoIndex: false,
    autoCreate: false,
    monitorCommands: true,
  });
  await mongo.asPromise();
  for (const i of CRITICAL_INDEXES)
    if (i.collection !== 'timelinecontrol')
      await mongo
        .db!.collection(i.collection)
        .createIndex(i.key, { unique: true, name: i.id });
  const uploads = '/tmp/' + db;
  mkdirSync(uploads);
  const options = {
    environment: env,
    storageIdentity: storage,
    newEnvironment: true,
    uploadRoot: uploads,
    deploymentTimeline: A,
    deploymentGeneration: 1,
    writeMode: 'CLOSED' as 'CLOSED' | 'OPEN',
    protocolPolicy: 'ENFORCE_MUTATIONS',
  };
  await coordinateAuthority(op, mongo, request('initialize', 0), options);
  options.writeMode = 'OPEN';
  await coordinateAuthority(op, mongo, request('open', 1), options);
  const snapshot = await readTimelineControl(mongo, 1000);
  const config = new ConfigService({
    DATA_TIMELINE_ID: A,
    DATA_WRITE_MODE: 'OPEN',
    TIMELINE_AUTHORITY_MODE: 'DURABLE_REQUIRED',
    TIMELINE_AUTHORITY_URL: reader,
    TIMELINE_AUTHORITY_ENVIRONMENT: env,
    TIMELINE_AUTHORITY_STORAGE_ID: storage,
    TIMELINE_AUTHORITY_GENERATION: 1,
    READINESS_TIMEOUT_MS: 1000,
    CLIENT_PROTOCOL_POLICY: 'ENFORCE_MUTATIONS',
  });
  const authority = new DurableTimelineAuthority(config);
  const gate = new TimelineWriteGate(
    mongo,
    config,
    () => false,
    () => true,
    authority,
  );
  // Deterministic barrier: old writer touches singleton before operator closes it.
  const old = await mongo.startSession({ defaultTimeoutMS: 1000 });
  old.startTransaction();
  await gate.assertAndTouchWriteFence(old, A);
  await mongo
    .db!.collection('synthetic')
    .insertOne({ _id: 'must-not-commit' } as never, { session: old });
  await op.transition(request('close', 2));
  await expect(gate.assertWritesPermitted()).rejects.toThrow();
  options.writeMode = 'CLOSED';
  await expect(
    coordinateAuthority(
      op,
      mongo,
      {
        ...request('maintenance', 3),
        mongoClosedVersion: snapshot.controlVersion,
      },
      options,
    ),
  ).rejects.toThrow('MONGO_CLOSED');
  // Precommit authority recheck fails; the Mongo fence transaction is aborted before maintenance.
  await expect(authority.assertOpen(A)).rejects.toThrow();
  await old.abortTransaction();
  await old.endSession();
  const current = await readTimelineControl(mongo, 1000);
  await applyControlRequest(
    mongo,
    {
      action: 'close',
      targetTimelineId: A,
      expectedTimelineId: A,
      expectedState: 'OPEN',
      expectedVersion: current.controlVersion,
      eventId: randomUUID(),
      operatorReference: 'barrier',
    },
    { expectedTimelineId: A, writeMode: 'CLOSED' },
    1000,
  );
  expect(await mongo.db!.collection('synthetic').findOne({})).toBeNull();
  options.writeMode = 'CLOSED';
  let closed = await readTimelineControl(mongo, 1000);
  const maintain = {
    ...request('maintenance', 3),
    mongoClosedVersion: closed.controlVersion,
  };
  await coordinateAuthority(op, mongo, maintain, options);
  await op.close();
  op = new AuthorityOperator(op.uri, 1000);
  await op.connect();
  expect((await state()).mode).toBe('MAINTENANCE'); // restart during maintenance
  await expect(op.transition(request('allocate', 4, A))).rejects.toThrow();
  const issue = {
    ...request('allocate', 4, B),
    mongoClosedVersion: closed.controlVersion,
  };
  await coordinateAuthority(op, mongo, issue, options); // crash after issuance, before Mongo changes
  await expect(authority.assertOpen(A)).rejects.toThrow();
  expect((await state()).timeline_id).toBe(B);
  await expect(
    coordinateAuthority(op, mongo, issue, options),
  ).resolves.toMatchObject({ generation: 2 });
  // Simulate restoring ONLY the older Mongo control snapshot. No real restore or external data.
  const auditBefore = (
    await admin.query<{ count: string }>(
      'SELECT count(*) FROM timeline_authority.audit',
    )
  ).rows[0].count;
  await mongo
    .db!.collection('timelinecontrol')
    .replaceOne({ _id: 'global' } as never, snapshot);
  await expect(gate.assertWritesPermitted()).rejects.toThrow();
  expect((await state()).timeline_id).toBe(B);
  expect(
    (
      await admin.query<{ count: string }>(
        'SELECT count(*) FROM timeline_authority.audit',
      )
    ).rows[0].count,
  ).toBe(auditBefore);
  await coordinateAuthority(op, mongo, request('seal-mongo', 5, B), options);
  closed = await readTimelineControl(mongo, 1000);
  // Record install intent first, then simulate crash before the Mongo update.
  const install = {
    ...request('install', 6, B),
    mongoClosedVersion: closed.controlVersion,
  };
  await op.transition(install);
  await coordinateAuthority(op, mongo, install, options);
  expect((await readTimelineControl(mongo, 1000)).dataTimelineId).toBe(B);
  // Crash after Mongo install and before reconciliation still cannot authorize old/new writers.
  await expect(authority.assertOpen(A)).rejects.toThrow();
  options.deploymentTimeline = B;
  options.deploymentGeneration = 2;
  closed = await readTimelineControl(mongo, 1000);
  await coordinateAuthority(
    op,
    mongo,
    {
      ...request('reconcile', 7, B),
      mongoClosedVersion: closed.controlVersion,
    },
    options,
  );
  expect((await state()).mode).toBe('CLOSED'); // crash before explicit reopen
  options.writeMode = 'OPEN';
  await coordinateAuthority(op, mongo, request('open', 8, B), options);
  await expect(gate.assertWritesPermitted()).rejects.toThrow(); // stale A configuration
  config.set('DATA_TIMELINE_ID', B);
  await expect(gate.assertWritesPermitted()).rejects.toThrow(); // stale generation
  config.set('TIMELINE_AUTHORITY_GENERATION', 2);
  await expect(gate.assertWritesPermitted()).resolves.toMatchObject({
    dataTimelineId: B,
  });
  const timeline = new MutationTimeline(mongo, config, gate);
  await timeline.transaction(
    'synthetic',
    async (session) => {
      await mongo
        .db!.collection('synthetic')
        .insertOne({ _id: 'B-authorized' } as never, { session });
    },
    { dataTimelineId: B, protocol: 2, legacyReceipts: false },
  );
  expect(await mongo.db!.collection('synthetic').countDocuments()).toBe(1);
  const badReader = new URL(reader);
  badReader.port = '1';
  config.set('TIMELINE_AUTHORITY_URL', badReader.toString());
  let called = false;
  await expect(
    timeline.transaction(
      'outage',
      () => {
        called = true;
        return Promise.resolve();
      },
      { dataTimelineId: B, protocol: 2, legacyReceipts: false },
    ),
  ).rejects.toThrow();
  expect(called).toBe(false);
  config.set('TIMELINE_AUTHORITY_URL', reader);
  // Command barriers prove overlapping writers exercise the same Mongo singleton fence.
  let entered!: () => void, release!: () => void;
  const firstEntered = new Promise<void>((r) => {
      entered = r;
    }),
    firstRelease = new Promise<void>((r) => {
      release = r;
    });
  const first = timeline.transaction(
    'concurrent-first',
    async (session) => {
      entered();
      await firstRelease;
      await mongo
        .db!.collection('synthetic')
        .insertOne({ _id: 'concurrent-first' } as never, { session });
    },
    { dataTimelineId: B, protocol: 2, legacyReceipts: false },
  );
  await firstEntered;
  const driver = mongo.getClient();
  const command = (event: { command: { update?: string } }) => {
    if (event.command.update === 'timelinecontrol') release();
  };
  driver.on('commandStarted', command);
  try {
    const second = timeline.transaction(
      'concurrent-second',
      async (session) => {
        await mongo
          .db!.collection('synthetic')
          .insertOne({ _id: 'concurrent-second' } as never, { session });
      },
      { dataTimelineId: B, protocol: 2, legacyReceipts: false },
    );
    await Promise.all([first, second]);
  } finally {
    release();
    driver.removeListener('commandStarted', command);
  }
  expect(await mongo.db!.collection('synthetic').countDocuments()).toBe(3);
  // Lost close reply: independent close persisted before the Mongo barrier.
  options.writeMode = 'CLOSED';
  const closePlan = request('close', 9, B);
  await op.transition(closePlan);
  await expect(gate.assertWritesPermitted()).rejects.toThrow();
  await coordinateAuthority(op, mongo, closePlan, options);
  expect((await readTimelineControl(mongo, 1000)).writeState).toBe('CLOSED');
  // Crash after Mongo opens but before PostgreSQL open: still independently closed.
  const closedB = await readTimelineControl(mongo, 1000);
  await applyControlRequest(
    mongo,
    {
      action: 'open',
      targetTimelineId: B,
      expectedTimelineId: B,
      expectedState: 'CLOSED',
      expectedVersion: closedB.controlVersion,
      eventId: randomUUID(),
      operatorReference: 'synthetic-open-crash',
    },
    { expectedTimelineId: B, writeMode: 'OPEN' },
    1000,
  );
  await expect(gate.assertWritesPermitted()).rejects.toThrow();
  options.writeMode = 'OPEN';
  await coordinateAuthority(op, mongo, request('open', 10, B), options);
  await expect(gate.assertWritesPermitted()).resolves.toMatchObject({
    dataTimelineId: B,
  });
  authority.onModuleDestroy();
  await expect(authority.assertOpen(B)).rejects.toThrow();
});
