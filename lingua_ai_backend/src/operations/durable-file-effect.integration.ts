// Explicit disposable PostgreSQL/Mongo suite; never included in the app image.
import { Client } from 'pg';
import { createConnection, Connection } from 'mongoose';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { DurableTimelineAuthority, readAuthority } from './durable-authority';
import { TimelineWriteGate, readTimelineControl } from './timeline-gate';
import { MutationAdmission, MutationTimeline } from './mutation-timeline';
import {
  AuthorityOperator,
  AuthorityRequest,
  coordinateAuthority,
} from '../tooling/durable-control';
import { CRITICAL_INDEXES } from './index-inventory';
import { CommunityImageStorage } from '../community/community-image.storage';
import { CommunityService } from '../community/community.service';
import {
  MutationReceipt,
  MutationReceiptSchema,
  MutationReceipts,
} from '../common/mutation-receipt';
import {
  CommunityPost,
  CommunityPostSchema,
} from '../community/schemas/community-post.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { runReadinessProbes } from './readiness-probes';

jest.setTimeout(60000);
const A = '11111111-1111-4111-8111-111111111111',
  B = '22222222-2222-4222-8222-222222222222';
const environment = 'synthetic-r2',
  storageIdentity = 'synthetic-r2-authority';
const base = process.env.C1_TEST_ADMIN_URL || '';
const admitted: MutationAdmission = {
  dataTimelineId: A,
  protocol: 2,
  legacyReceipts: false,
};
let admin: Client,
  op: AuthorityOperator,
  mongo: Connection,
  reader: string,
  uri: string,
  config: ConfigService,
  authority: DurableTimelineAuthority,
  timeline: MutationTimeline,
  images: CommunityImageStorage,
  uploadRoot: string,
  options: {
    environment: string;
    storageIdentity: string;
    newEnvironment: boolean;
    uploadRoot: string;
    deploymentTimeline: string;
    deploymentGeneration: number;
    writeMode: 'CLOSED' | 'OPEN';
    protocolPolicy: string;
  },
  png: Buffer,
  envRestore: { restore: () => void };
let closePlan: AuthorityRequest;
function latch() {
  let done!: () => void;
  const promise = new Promise<void>((r) => (done = r));
  return { promise, done };
}
const request = (
  action: AuthorityRequest['action'],
  expectedRevision: number,
  timelineId = A,
): AuthorityRequest => ({
  action,
  expectedRevision,
  timelineId,
  eventId: randomUUID(),
  environment,
  storageIdentity,
  operatorReference: 'synthetic-r2',
  isolationReference: 'synthetic-stopped-processes',
  uploadRecoveryReference: 'synthetic-upload-reconciliation',
  historyContinuityReference: 'synthetic-independent-history',
  mongoClosedVersion: 0,
});
const run = <T>(work: () => T) => timeline.run(admitted, work);
const file = () =>
  ({
    buffer: png,
    originalname: 'synthetic.png',
    mimetype: 'image/png',
  }) as Express.Multer.File;
const pending = () =>
  admin.query<{ effect_id: string; owner_pid: number; status: string }>(
    "SELECT effect_id,owner_pid,status FROM timeline_authority.file_effects WHERE status='ACTIVE'",
  );
const control = () => readTimelineControl(mongo, 2000);
const rawState = async () =>
  (
    await admin.query<{ mode: string; revision: string }>(
      'SELECT mode,revision FROM timeline_authority.state',
    )
  ).rows[0];
async function connectAdmin() {
  admin = new Client({ connectionString: uri });
  admin.on('error', () => undefined);
  await admin.connect();
}
beforeAll(async () => {
  if (
    new URL(base).hostname !== 'authority' ||
    new URL(base).pathname !== '/timeline_authority' ||
    !process.env.C1_TEST_MONGO_URI?.startsWith('mongodb://mongo:27017/')
  )
    throw Error('DISPOSABLE_R2_TARGETS_REQUIRED');
  png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: '#123456' },
  })
    .png()
    .toBuffer();
});
beforeEach(async () => {
  const db = 'c1_' + randomUUID().replaceAll('-', ''),
    root = new Client({ connectionString: base });
  await root.connect();
  await root.query('CREATE DATABASE ' + db);
  await root.end();
  const u = new URL(base);
  u.pathname = '/' + db;
  uri = u.toString();
  await connectAdmin();
  await admin.query(
    readFileSync(
      resolve(__dirname, '../../../deployment/staging/authority-schema.sql'),
      'utf8',
    ),
  );
  const credential = (user: string, password: string) => {
    const x = new URL(uri);
    x.username = user;
    x.password = password;
    return x.toString();
  };
  reader = credential('timeline_reader', process.env.C1_TEST_READER_PASSWORD!);
  op = new AuthorityOperator(
    credential('timeline_operator', process.env.C1_TEST_OPERATOR_PASSWORD!),
    2000,
  );
  await op.connect();
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
  uploadRoot = '/tmp/' + db;
  await fs.mkdir(uploadRoot);
  await fs.mkdir(join(uploadRoot, 'community'));
  envRestore = jest.replaceProperty(process, 'env', {
    ...process.env,
    UPLOAD_ROOT: uploadRoot,
  });
  options = {
    environment,
    storageIdentity,
    newEnvironment: true,
    uploadRoot,
    deploymentTimeline: A,
    deploymentGeneration: 1,
    writeMode: 'CLOSED',
    protocolPolicy: 'ENFORCE_MUTATIONS',
  };
  await coordinateAuthority(op, mongo, request('initialize', 0), options);
  options.writeMode = 'OPEN';
  await coordinateAuthority(op, mongo, request('open', 1), options);
  config = new ConfigService({
    DATA_TIMELINE_ID: A,
    DATA_WRITE_MODE: 'OPEN',
    TIMELINE_AUTHORITY_MODE: 'DURABLE_REQUIRED',
    TIMELINE_AUTHORITY_URL: reader,
    TIMELINE_AUTHORITY_ENVIRONMENT: environment,
    TIMELINE_AUTHORITY_STORAGE_ID: storageIdentity,
    TIMELINE_AUTHORITY_GENERATION: 1,
    READINESS_TIMEOUT_MS: 5000,
    CLIENT_PROTOCOL_POLICY: 'ENFORCE_MUTATIONS',
  });
  authority = new DurableTimelineAuthority(config);
  timeline = new MutationTimeline(
    mongo,
    config,
    new TimelineWriteGate(
      mongo,
      config,
      () => false,
      () => true,
      authority,
    ),
  );
  images = new CommunityImageStorage(timeline);
  closePlan = request('close', 2);
});
afterEach(async () => {
  jest.restoreAllMocks();
  envRestore?.restore();
  authority?.onModuleDestroy();
  await op?.close();
  await admin?.end().catch(() => undefined);
  await mongo?.close();
});
async function close(plan = closePlan) {
  options.writeMode = 'CLOSED';
  return coordinateAuthority(op, mongo, plan, options);
}
async function advanceB() {
  await close();
  let row = await control();
  await coordinateAuthority(
    op,
    mongo,
    { ...request('maintenance', 3), mongoClosedVersion: row.controlVersion },
    options,
  );
  await coordinateAuthority(
    op,
    mongo,
    { ...request('allocate', 4, B), mongoClosedVersion: row.controlVersion },
    options,
  );
  await coordinateAuthority(
    op,
    mongo,
    { ...request('install', 5, B), mongoClosedVersion: row.controlVersion },
    options,
  );
  row = await control();
  options.deploymentTimeline = B;
  options.deploymentGeneration = 2;
  await coordinateAuthority(
    op,
    mongo,
    { ...request('reconcile', 6, B), mongoClosedVersion: row.controlVersion },
    options,
  );
  options.writeMode = 'OPEN';
  await coordinateAuthority(op, mongo, request('open', 7, B), options);
  config.set('DATA_TIMELINE_ID', B);
  config.set('TIMELINE_AUTHORITY_GENERATION', 2);
}

test('durable owned permits, immutable events and role separation; CLOSE cannot certify an active effect', async () => {
  const entered = latch(),
    release = latch();
  const result = authority
    .fileEffect(A, 'upload-store', async () => {
      entered.done();
      await release.promise;
    })
    .then(
      () => null,
      (e) => e as Error,
    );
  await entered.promise;
  try {
    const row = (await pending()).rows[0];
    expect(row.effect_id).toBeDefined();
    await expect(
      op.client.query(
        'SELECT timeline_authority.finish_file_effect($1::uuid)',
        [row.effect_id],
      ),
    ).rejects.toThrow();
    await expect(
      op.client.query(
        'SELECT timeline_authority.record_file_isolation($1,$2,$3,$4,$5,$6,$7)',
        [
          randomUUID(),
          row.effect_id,
          environment,
          storageIdentity,
          2,
          'fake-isolation',
          'a'.repeat(64),
        ],
      ),
    ).rejects.toThrow();
    await expect(close()).rejects.toThrow('UNSETTLED_FILE_EFFECTS');
    expect((await rawState()).mode).toBe('CLOSED');
    const c = await control();
    await expect(
      coordinateAuthority(
        op,
        mongo,
        { ...request('maintenance', 3), mongoClosedVersion: c.controlVersion },
        options,
      ),
    ).rejects.toThrow('UNSETTLED_FILE_EFFECTS');
    await expect(op.transition(request('open', 3))).rejects.toThrow(
      'UNSETTLED_FILE_EFFECTS',
    );
  } finally {
    release.done();
  }
  expect(await result).toBeInstanceOf(Error);
  expect((await pending()).rows).toHaveLength(0);
  await close();
  await expect(
    admin.query('DELETE FROM timeline_authority.file_effect_events'),
  ).rejects.toThrow('APPEND_ONLY');
});

test('R1 paused unlink cannot cross a completed maintenance barrier or delete subsequently recovered bytes', async () => {
  const target = join(uploadRoot, 'community', randomUUID() + '.png'),
    url = '/uploads/community/' + target.split('/').pop();
  await fs.writeFile(target, png);
  const entered = latch(),
    release = latch(),
    native = fs.unlink;
  jest.spyOn(fs, 'unlink').mockImplementation(async (p) => {
    if (p === target) {
      entered.done();
      await release.promise;
    }
    return native(p);
  });
  const result = run(() => images.remove(url)).then(
    () => null,
    (e) => e as Error,
  );
  await entered.promise;
  try {
    await expect(close()).rejects.toThrow('UNSETTLED_FILE_EFFECTS');
    const c = await control();
    await expect(
      coordinateAuthority(
        op,
        mongo,
        { ...request('maintenance', 3), mongoClosedVersion: c.controlVersion },
        options,
      ),
    ).rejects.toThrow('UNSETTLED_FILE_EFFECTS');
  } finally {
    release.done();
  }
  expect(await result).toMatchObject({ status: 503 });
  await close();
  const c = await control();
  await coordinateAuthority(
    op,
    mongo,
    { ...request('maintenance', 3), mongoClosedVersion: c.controlVersion },
    options,
  );
  await fs.writeFile(target, Buffer.from('synthetic-recovered-file'));
  await run(() => images.cleanup(url, 'synthetic-old-cleanup'));
  expect((await fs.readFile(target)).toString()).toBe(
    'synthetic-recovered-file',
  );
});

test('upload create holds its durable permit through native write completion; maintenance rejects new creates/deletes', async () => {
  const entered = latch(),
    release = latch(),
    native = fs.open;
  jest
    .spyOn(fs, 'open')
    .mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await native(...args);
      if (String(args[0]).includes('/community/')) {
        const write = handle.writeFile.bind(handle) as typeof handle.writeFile;
        jest
          .spyOn(handle, 'writeFile')
          .mockImplementation(
            async (...input: Parameters<typeof handle.writeFile>) => {
              entered.done();
              await release.promise;
              await Reflect.apply(write, handle, input);
            },
          );
      }
      return handle;
    });
  const result = run(() => images.store(file())).then(
    () => null,
    (e) => e as Error,
  );
  await entered.promise;
  try {
    await expect(close()).rejects.toThrow('UNSETTLED_FILE_EFFECTS');
  } finally {
    release.done();
  }
  expect(await result).toMatchObject({ status: 503 });
  expect((await pending()).rows).toHaveLength(0);
  await close();
  const c = await control();
  await coordinateAuthority(
    op,
    mongo,
    { ...request('maintenance', 3), mongoClosedVersion: c.controlVersion },
    options,
  );
  const names = await fs.readdir(join(uploadRoot, 'community'));
  expect(names).toHaveLength(1);
  await expect(run(() => images.store(file()))).rejects.toMatchObject({
    status: 503,
  });
  await expect(
    run(() => images.remove('/uploads/community/' + names[0])),
  ).rejects.toMatchObject({ status: 503 });
  expect(await fs.readdir(join(uploadRoot, 'community'))).toEqual(names);
});

test('lost authority connection after admission prevents the next file mutation and leaves a nonexpiring recovery hazard', async () => {
  const target = join(uploadRoot, 'community', randomUUID() + '.png'),
    url = '/uploads/community/' + target.split('/').pop();
  await fs.writeFile(target, png);
  const entered = latch(),
    release = latch(),
    native = fs.lstat;
  jest
    .spyOn(fs, 'lstat')
    .mockImplementation(async (...args: Parameters<typeof fs.lstat>) => {
      const value = await native(...args);
      if (args[0] === target) {
        entered.done();
        await release.promise;
      }
      return value;
    });
  const result = run(() => images.remove(url)).then(
    () => null,
    (e) => e as Error,
  );
  await entered.promise;
  const p = (await pending()).rows[0];
  await admin.query('SELECT pg_terminate_backend($1)', [p.owner_pid]);
  release.done();
  expect(await result).toMatchObject({ status: 503 });
  expect(await fs.readFile(target)).toEqual(png);
  expect((await pending()).rows).toHaveLength(1);
  await expect(authority.assertOpen(A)).rejects.toThrow(
    'TIMELINE_CONTROL_UNAVAILABLE',
  );
  await expect(close()).rejects.toThrow('UNSETTLED_FILE_EFFECTS');
  const c = await control(),
    recovery = {
      ...request('resolve-effect', 3),
      effectId: p.effect_id,
      effectRecoveryReference: 'synthetic-reconciled-file',
      isolationReceiptId: randomUUID(),
      mongoClosedVersion: c.controlVersion,
    };
  await expect(
    coordinateAuthority(op, mongo, recovery, options),
  ).rejects.toThrow('ADMIN_ISOLATION_RECEIPT_REQUIRED');
  // The paused work is now settled; this fixture acts as the separately trusted
  // administrator. Actual Docker process-isolation receipt issuance is tested separately.
  const receipt = randomUUID();
  await admin.query(
    'SELECT timeline_authority.record_file_isolation($1,$2,$3,$4,$5,$6,$7)',
    [
      receipt,
      p.effect_id,
      environment,
      storageIdentity,
      3,
      'synthetic-settled-process',
      'a'.repeat(64),
    ],
  );
  await coordinateAuthority(
    op,
    mongo,
    { ...recovery, isolationReceiptId: receipt },
    options,
  );
  expect((await pending()).rows).toHaveLength(0);
  expect((await rawState()).mode).toBe('CLOSED');
});

test('runtime cannot settle another connection permit or mint isolation evidence; live owner cannot be administratively resolved', async () => {
  const id = randomUUID(),
    client = new Client({ connectionString: reader });
  await client.connect();
  try {
    await client.query(
      'SELECT timeline_authority.begin_file_effect($1,$2,$3,$4,$5,$6)',
      [environment, storageIdentity, A, 1, id, 'upload-remove'],
    );
    const other = new Client({ connectionString: reader });
    await other.connect();
    try {
      await expect(
        other.query('SELECT timeline_authority.finish_file_effect($1)', [id]),
      ).rejects.toThrow('OWNER_MISMATCH');
      await expect(
        other.query('UPDATE timeline_authority.file_effects SET status=$1', [
          'SETTLED',
        ]),
      ).rejects.toThrow();
    } finally {
      await other.end();
    }
    await expect(close()).rejects.toThrow('UNSETTLED_FILE_EFFECTS');
    await expect(
      admin.query(
        'SELECT timeline_authority.record_file_isolation($1,$2,$3,$4,$5,$6,$7)',
        [
          randomUUID(),
          id,
          environment,
          storageIdentity,
          3,
          'fake',
          'a'.repeat(64),
        ],
      ),
    ).rejects.toThrow('VERIFIED_FILE_ISOLATION_REQUIRED');
    await client.query('SELECT timeline_authority.finish_file_effect($1)', [
      id,
    ]);
  } finally {
    await client.end();
  }
});

test('readiness writable probe is fenced, CLOSED probes do not mutate uploads, and required-mode callbacks never use cached admission', async () => {
  const runProbe = () =>
    runReadinessProbes(
      mongo,
      uploadRoot,
      false,
      new AbortController().signal,
      2000,
      undefined,
      timeline.gate,
    );
  expect((await runProbe()).checks.uploads).toBe('ok');
  expect(
    (
      await admin.query<{ count: string }>(
        "SELECT count(*) FROM timeline_authority.file_effects WHERE kind='readiness-probe' AND status='SETTLED'",
      )
    ).rows[0].count,
  ).toBe('1');
  await close();
  const open = jest.spyOn(fs, 'open');
  expect((await runProbe()).checks.uploads).toBe('failed');
  expect(open).not.toHaveBeenCalled();
});

test('unavailable, wrong environment, stale generation, corrupt authority and timeout reject before native file creation', async () => {
  const real = reader,
    bad = new URL(reader);
  bad.port = '1';
  config.set('TIMELINE_AUTHORITY_URL', bad.toString());
  await expect(run(() => images.store(file()))).rejects.toMatchObject({
    status: 503,
  });
  config.set('TIMELINE_AUTHORITY_URL', real);
  config.set('TIMELINE_AUTHORITY_ENVIRONMENT', 'wrong-environment');
  await expect(run(() => images.store(file()))).rejects.toMatchObject({
    status: 503,
  });
  config.set('TIMELINE_AUTHORITY_ENVIRONMENT', environment);
  config.set('TIMELINE_AUTHORITY_GENERATION', 2);
  await expect(run(() => images.store(file()))).rejects.toMatchObject({
    status: 503,
  });
  config.set('TIMELINE_AUTHORITY_GENERATION', 1);
  await admin.query('UPDATE timeline_authority.state SET revision=revision+1');
  await expect(run(() => images.store(file()))).rejects.toMatchObject({
    status: 503,
  });
  await admin.query('UPDATE timeline_authority.state SET revision=revision-1');
  config.set('READINESS_TIMEOUT_MS', 100);
  await admin.query('BEGIN');
  await admin.query(
    'LOCK TABLE timeline_authority.state IN ACCESS EXCLUSIVE MODE',
  );
  try {
    await expect(run(() => images.store(file()))).rejects.toMatchObject({
      status: 503,
    });
  } finally {
    await admin.query('ROLLBACK');
  }
  expect(await fs.readdir(join(uploadRoot, 'community'))).toEqual([]);
});

function community() {
  const posts = mongo.model(CommunityPost.name, CommunityPostSchema),
    users = mongo.model(User.name, UserSchema),
    receipts = mongo.model(MutationReceipt.name, MutationReceiptSchema);
  return {
    posts,
    receipts,
    service: new CommunityService(
      posts,
      users,
      new MutationReceipts(receipts, timeline),
      images,
    ),
  };
}
test('failed Mongo metadata transaction compensates an owned file under a fresh durable permit', async () => {
  const c = community();
  jest
    .spyOn(c.posts.prototype, 'save')
    .mockRejectedValue(new Error('synthetic metadata failure'));
  await expect(
    run(() =>
      c.service.create(
        'synthetic-owner',
        'Synthetic',
        'en',
        'text',
        file(),
        randomUUID(),
      ),
    ),
  ).rejects.toMatchObject({ status: 503 });
  expect(await c.posts.countDocuments()).toBe(0);
  expect(await c.receipts.countDocuments()).toBe(0);
  expect(await fs.readdir(join(uploadRoot, 'community'))).toEqual([]);
  expect((await pending()).rows).toHaveLength(0);
});

test('delayed post-delete compensation retains A across B activation and cannot remove recovered B bytes', async () => {
  const c = community(),
    post = await run(() =>
      c.service.create(
        'synthetic-owner',
        'Synthetic',
        'en',
        'text',
        file(),
        randomUUID(),
      ),
    );
  const p = post as { _id: string; imageUrl: string; revision: number },
    target = join(uploadRoot, 'community', p.imageUrl.split('/').pop()!);
  const entered = latch(),
    release = latch(),
    cleanup = images.cleanup.bind(images) as typeof images.cleanup;
  jest
    .spyOn(images, 'cleanup')
    .mockImplementationOnce(
      async (...args: Parameters<typeof images.cleanup>) => {
        entered.done();
        await release.promise;
        await Reflect.apply(cleanup, images, args);
      },
    );
  const result = run(() =>
    c.service.delete(
      String(p._id),
      'synthetic-owner',
      randomUUID(),
      p.revision,
    ),
  );
  await entered.promise;
  try {
    await advanceB();
    await fs.writeFile(target, Buffer.from('synthetic-B-recovery'));
  } finally {
    release.done();
  }
  await result;
  expect((await fs.readFile(target)).toString()).toBe('synthetic-B-recovery');
  expect((await pending()).rows).toHaveLength(0);
});

test('captured delayed background work and stale application instances cannot reinterpret A after B or reconnect', async () => {
  let called = false;
  const job = () =>
    timeline.transaction(
      'synthetic-delayed-job',
      () => {
        called = true;
        return Promise.resolve();
      },
      admitted,
    );
  await advanceB();
  await expect(job()).rejects.toThrow();
  expect(called).toBe(false);
  config.set('DATA_TIMELINE_ID', A);
  config.set('TIMELINE_AUTHORITY_GENERATION', 1);
  await expect(authority.assertOpen(A)).rejects.toThrow();
  await expect(run(() => images.store(file()))).rejects.toMatchObject({
    status: 503,
  });
  config.set('DATA_TIMELINE_ID', B);
  config.set('TIMELINE_AUTHORITY_GENERATION', 2);
  const fresh = { ...admitted, dataTimelineId: B };
  await timeline.transaction(
    'synthetic-fresh-B',
    async (s) => {
      await mongo
        .db!.collection('synthetic')
        .insertOne({ ok: true }, { session: s });
    },
    fresh,
  );
  expect(await mongo.db!.collection('synthetic').countDocuments()).toBe(1);
});

test('real PostgreSQL outage after initial authorization aborts an active Mongo mutation before commit and recovery does not initialize authority', async () => {
  const signals = process.env.C1_TEST_SIGNAL_DIR;
  if (!signals) throw Error('EXTERNAL_DISPOSABLE_OUTAGE_ORCHESTRATOR_REQUIRED');
  const wait = async (name: string) => {
    for (let i = 0; i < 300; i++) {
      try {
        await fs.stat(join(signals, name));
        return;
      } catch {
        /* The external barrier has not been published yet. */
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw Error('OUTAGE_BARRIER_TIMEOUT');
  };
  const before = await readAuthority(
    reader,
    environment,
    storageIdentity,
    2000,
  );
  const result = timeline
    .transaction(
      'synthetic-real-outage',
      async (s) => {
        await fs.writeFile(join(signals, 'ready'), 'synthetic-only');
        await wait('continue');
        await mongo
          .db!.collection('synthetic')
          .insertOne({ mustAbort: true }, { session: s });
      },
      admitted,
    )
    .then(
      () => null,
      (e) => e as Error,
    );
  expect(await result).toBeInstanceOf(Error);
  expect(await mongo.db!.collection('synthetic').countDocuments()).toBe(0);
  await fs.writeFile(join(signals, 'done'), 'synthetic-only');
  await wait('recovered');
  expect(
    await readAuthority(reader, environment, storageIdentity, 2000),
  ).toEqual(before);
});
