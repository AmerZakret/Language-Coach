// Explicit Docker suite: real PostgreSQL, Mongo transactions and private versioned S3.
import { Client } from 'pg';
import { createConnection, Connection, Model } from 'mongoose';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { ConfigService } from '@nestjs/config';
import {
  AuthorityOperator,
  AuthorityRequest,
  coordinateAuthority,
} from '../tooling/durable-control';
import { DurableTimelineAuthority } from '../operations/durable-authority';
import { MutationTimeline } from '../operations/mutation-timeline';
import {
  TimelineWriteGate,
  readTimelineControl,
} from '../operations/timeline-gate';
import { CRITICAL_INDEXES } from '../operations/index-inventory';
import { CommunityImageStorage } from './community-image.storage';
import {
  SharedCommunityStorage,
  StoredObject,
} from './shared-community.storage';
import {
  S3ObjectStorage,
  objectConfig,
  ObjectRequestError,
} from './object-storage';
import { CommunityService } from './community.service';
import { assertNewEmptyObjectStore } from '../tooling/object-bootstrap-cli';
import {
  CommunityPost,
  CommunityPostSchema,
  CommunityPostDocument,
} from './schemas/community-post.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  MutationReceipt,
  MutationReceiptSchema,
  MutationReceipts,
} from '../common/mutation-receipt';

jest.setTimeout(60000);
const A = '11111111-1111-4111-8111-111111111111',
  B = '22222222-2222-4222-8222-222222222222',
  owner = '333333333333333333333333';
let admin: Client,
  op: AuthorityOperator,
  mongo: Connection,
  config: ConfigService,
  authority: DurableTimelineAuthority,
  timeline: MutationTimeline,
  shared: SharedCommunityStorage,
  images: CommunityImageStorage,
  service: CommunityService,
  posts: Model<CommunityPostDocument>,
  adapter: S3ObjectStorage,
  adminAdapter: S3ObjectStorage,
  restore: { restore: () => void };
let options: Parameters<typeof coordinateAuthority>[3], png: Buffer;
let closePlan: AuthorityRequest;
const version = (row: StoredObject) => {
  if (!row.version_id) throw Error('ACKNOWLEDGED_OBJECT_VERSION_REQUIRED');
  return row.version_id;
};
const objectRows = async () =>
  (
    await admin.query<StoredObject>(
      'SELECT * FROM timeline_authority.objects ORDER BY created_at',
    )
  ).rows;
const pending = async () =>
  Number(
    (
      await admin.query<{ count: string }>(
        "SELECT count(*) FROM timeline_authority.file_effects WHERE status='ACTIVE'",
      )
    ).rows[0].count,
  );
const request = (
  action: AuthorityRequest['action'],
  expectedRevision: number,
  timelineId = A,
): AuthorityRequest => ({
  action,
  expectedRevision,
  timelineId,
  eventId: randomUUID(),
  environment: 'language-coach-11b-local',
  storageIdentity: 'synthetic-c2-authority',
  operatorReference: 'synthetic-c2-test',
  isolationReference: 'synthetic-stopped-writers',
  uploadRecoveryReference: 'synthetic-version-inventory',
  historyContinuityReference: 'synthetic-reviewed-independent-history',
  mongoClosedVersion: 0,
});
const scope = {
  dataTimelineId: A,
  protocol: 2 as const,
  legacyReceipts: false,
};
const run = <T>(work: () => T) => timeline.run(scope, work);
const image = () =>
  ({
    buffer: png,
    originalname: 'synthetic.png',
    mimetype: 'image/png',
  }) as Express.Multer.File;
const create = (operation = randomUUID()) =>
  run(() =>
    service.create(owner, 'Synthetic', 'en', 'synthetic', image(), operation),
  );
async function close() {
  options.writeMode = 'CLOSED';
  return coordinateAuthority(op, mongo, closePlan, options);
}
beforeAll(async () => {
  if (
    new URL(process.env.C1_TEST_ADMIN_URL || '').hostname !== 'authority' ||
    !process.env.C1_TEST_MONGO_URI?.startsWith('mongodb://mongo:27017/') ||
    process.env.OBJECT_STORAGE_ENDPOINT !== 'http://object-store:8333'
  )
    throw Error('SYNTHETIC_DOCKER_TARGETS_REQUIRED');
  png = await sharp({
    create: { width: 3, height: 2, channels: 3, background: '#123456' },
  })
    .png()
    .toBuffer();
});
beforeEach(async () => {
  const base = new URL(process.env.C1_TEST_ADMIN_URL!),
    db = 'c2_' + randomUUID().replaceAll('-', ''),
    root = new Client({ connectionString: base.toString() });
  await root.connect();
  await root.query('CREATE DATABASE ' + db);
  await root.end();
  base.pathname = '/' + db;
  admin = new Client({ connectionString: base.toString() });
  await admin.connect();
  await admin.query(
    readFileSync(
      resolve(__dirname, '../../../deployment/staging/authority-schema.sql'),
      'utf8',
    ),
  );
  const credential = (user: string, password: string) => {
    const u = new URL(base);
    u.username = user;
    u.password = password;
    return u.toString();
  };
  const reader = credential(
    'timeline_reader',
    process.env.C1_TEST_READER_PASSWORD!,
  );
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
  restore = jest.replaceProperty(process, 'env', {
    ...process.env,
    UPLOAD_STORAGE_BACKEND: 'S3',
    TIMELINE_AUTHORITY_MODE: 'DURABLE_REQUIRED',
    TIMELINE_AUTHORITY_URL: reader,
    TIMELINE_AUTHORITY_ENVIRONMENT: 'language-coach-11b-local',
    TIMELINE_AUTHORITY_STORAGE_ID: 'synthetic-c2-authority',
    TIMELINE_AUTHORITY_GENERATION: '1',
    READINESS_TIMEOUT_MS: '2000',
  });
  const c = objectConfig(process.env);
  adapter = new S3ObjectStorage(c);
  adminAdapter = new S3ObjectStorage({
    ...c,
    accessKey: process.env.STAGING_OBJECT_ADMIN_ACCESS_KEY!,
    secretKey: process.env.STAGING_OBJECT_ADMIN_SECRET_KEY!,
  });
  await op.client.query('SELECT timeline_authority.bind_objects($1,$2,$3,$4)', [
    c.environment,
    c.namespace,
    c.bucket,
    c.storageIdentity,
  ]);
  options = {
    environment: c.environment,
    storageIdentity: 'synthetic-c2-authority',
    newEnvironment: true,
    uploadRoot: '/tmp',
    deploymentTimeline: A,
    deploymentGeneration: 1,
    writeMode: 'CLOSED',
    protocolPolicy: 'ENFORCE_MUTATIONS',
  };
  await coordinateAuthority(op, mongo, request('initialize', 0), options);
  await op.client.query(
    'SELECT timeline_authority.object_reconcile_complete($1,1,0,$2,$3)',
    [
      randomUUID(),
      createHash('sha256').update('[]').digest('hex'),
      'synthetic-empty-inventory',
    ],
  );
  options.writeMode = 'OPEN';
  await coordinateAuthority(op, mongo, request('open', 1), options);
  closePlan = request('close', 2);
  config = new ConfigService({
    ...process.env,
    DATA_TIMELINE_ID: A,
    DATA_WRITE_MODE: 'OPEN',
    TIMELINE_AUTHORITY_GENERATION: 1,
    CLIENT_PROTOCOL_POLICY: 'ENFORCE_MUTATIONS',
    READINESS_TIMEOUT_MS: 2000,
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
  shared = new SharedCommunityStorage(config, timeline, mongo);
  adapter = shared.adapter!;
  images = new CommunityImageStorage(timeline, shared);
  posts = mongo.model(CommunityPost.name, CommunityPostSchema);
  service = new CommunityService(
    posts,
    mongo.model(User.name, UserSchema),
    new MutationReceipts(
      mongo.model(MutationReceipt.name, MutationReceiptSchema),
      timeline,
    ),
    images,
  );
});
afterEach(async () => {
  jest.restoreAllMocks();
  authority?.onModuleDestroy();
  restore?.restore();
  await Promise.all([admin?.end(), op?.close(), mongo?.close()]);
});

test('private runtime role denies anonymous/control/unrelated namespace/list/version deletion and IAM actions', async () => {
  await adapter.verifyIdentity();
  const c = adapter.config;
  for (const [method, key, query] of [
    ['PUT', 'control/identity.json', {}],
    ['PUT', 'other/synthetic.png', {}],
    ['GET', '', { 'list-type': '2' }],
    ['PUT', '', { versioning: '' }],
    [
      'DELETE',
      'community/language-coach-11b-local/' + A + '/1/' + randomUUID() + '.png',
      { versionId: 'forged' },
    ],
  ] as [string, string, Record<string, string>][])
    await expect(adapter.request(method, key, query)).rejects.toMatchObject({
      status: 403,
    });
  const unrelated = new S3ObjectStorage({
    ...c,
    bucket: 'unrelated-synthetic-bucket',
  });
  await expect(unrelated.request('PUT')).rejects.toMatchObject({ status: 403 });
  const anonymous = await fetch(
    c.endpoint + '/' + c.bucket + '/control/identity.json',
  );
  expect(anonymous.status).toBe(403);
  const anonymousWrite = await fetch(
    c.endpoint + '/' + c.bucket + '/control/identity.json',
    {
      method: 'PUT',
      body: 'unauthorized-synthetic-write',
    },
  );
  expect(anonymousWrite.status).toBe(403);
  const otherEnvironment = new S3ObjectStorage({
    ...c,
    environment: 'other-environment',
  });
  await expect(
    otherEnvironment.request(
      'PUT',
      'community/other-environment/' + A + '/1/' + randomUUID() + '.png',
      {},
      png,
    ),
  ).rejects.toMatchObject({ status: 403 });
  const invalid = new S3ObjectStorage({
    ...c,
    accessKey: 'f'.repeat(64),
    secretKey: 'e'.repeat(64),
  });
  await expect(invalid.verifyIdentity()).rejects.toMatchObject({ status: 403 });
});

test('runtime cannot alter independent object history, bind/adopt storage or mint reconciliation evidence', async () => {
  const runtime = new Client({
    connectionString: config.getOrThrow<string>('TIMELINE_AUTHORITY_URL'),
  });
  await runtime.connect();
  try {
    for (const sql of [
      'SELECT * FROM timeline_authority.objects',
      "UPDATE timeline_authority.objects SET status='DELETED'",
      'DELETE FROM timeline_authority.object_events',
      "SELECT timeline_authority.bind_objects('other','other','other','other')",
      "SELECT timeline_authority.object_adopt('11111111-1111-4111-8111-111111111111',2,'forged')",
      "SELECT timeline_authority.object_reconcile_complete('11111111-1111-4111-8111-111111111111',2,0,repeat('a',64),'forged')",
    ])
      await expect(runtime.query(sql)).rejects.toThrow();
  } finally {
    await runtime.end();
  }
  await expect(
    op.client.query('UPDATE timeline_authority.objects SET bytes=1'),
  ).rejects.toThrow();
  await expect(
    admin.query('DELETE FROM timeline_authority.object_reconciliations'),
  ).rejects.toThrow('APPEND_ONLY');
});

test('new-empty bootstrap verifies real bounded version inventory and refuses retained history', async () => {
  const empty = new S3ObjectStorage({
    ...adminAdapter.config,
    bucket: 'c2-r1-' + randomUUID(),
  });
  await empty.request('PUT');
  await expect(assertNewEmptyObjectStore(empty)).resolves.toBeUndefined();
  await expect(assertNewEmptyObjectStore(adminAdapter)).rejects.toThrow(
    'NEW_EMPTY_OBJECT_STORE_REQUIRED',
  );
});

test.each([
  ['TIMELINE_AUTHORITY_GENERATION', 0],
  ['TIMELINE_AUTHORITY_GENERATION', 99],
  ['TIMELINE_AUTHORITY_ENVIRONMENT', 'wrong-environment'],
  ['TIMELINE_AUTHORITY_STORAGE_ID', 'wrong-authority-store'],
] as const)(
  'invalid required authority %s=%s rejects before any object PUT',
  async (key, value) => {
    config.set(key, value);
    const put = jest.spyOn(adapter, 'createImmutable');
    await expect(create()).rejects.toMatchObject({ status: 503 });
    expect(put).not.toHaveBeenCalled();
    expect(await objectRows()).toHaveLength(0);
  },
);
test('create/replay/read/delete/replay retain immutable versions and exactly one completion receipt', async () => {
  const operation = randomUUID(),
    post = (await create(operation)) as CommunityPost;
  expect(((await create(operation)) as CommunityPost)._id.toString()).toBe(
    post._id.toString(),
  );
  expect(await objectRows()).toHaveLength(1);
  expect((await images.readShared(post.imageUrl!)).buffer).toEqual(png);
  const row = (await objectRows())[0],
    deletion = randomUUID();
  await run(() => service.delete(String(post._id), owner, deletion, 0));
  await run(() => service.delete(String(post._id), owner, deletion, 0));
  expect((await objectRows())[0].status).toBe('DELETED');
  expect(await pending()).toBe(0);
  await expect(images.readShared(post.imageUrl!)).rejects.toMatchObject({
    status: 404,
  });
  expect(await adapter.read(row.object_key, version(row))).toEqual(png);
  expect(
    Number(
      (
        await admin.query<{ count: string }>(
          "SELECT count(*) FROM timeline_authority.object_events WHERE event='DELETED'",
        )
      ).rows[0].count,
    ),
  ).toBe(1);
});
test('cross-owner deletion is refused before an intent or object mutation', async () => {
  const p = (await create()) as CommunityPost;
  await expect(
    run(() =>
      service.delete(
        String(p._id),
        '444444444444444444444444',
        randomUUID(),
        0,
      ),
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect((await objectRows())[0].status).toBe('LINKED');
  expect(await posts.countDocuments()).toBe(1);
});

test('an aborted metadata delete does not poison a later owner-authorized operation', async () => {
  const p = (await create()) as CommunityPost;
  const failure = jest.spyOn(posts, 'deleteOne').mockImplementationOnce(() => {
    throw new Error('synthetic-metadata-abort-after-intent');
  });
  await expect(
    run(() => service.delete(String(p._id), owner, randomUUID(), 0)),
  ).rejects.toMatchObject({ status: 503 });
  failure.mockRestore();
  expect(await posts.countDocuments()).toBe(1);
  expect((await objectRows())[0].status).toBe('DELETE_PENDING');
  await run(() => service.delete(String(p._id), owner, randomUUID(), 0));
  expect(await posts.countDocuments()).toBe(0);
  expect((await objectRows())[0].status).toBe('DELETED');
  expect(await pending()).toBe(0);
});

test('concurrent deletion retries claim one dispatch and leave no orphaned permit', async () => {
  const p = (await create()) as CommunityPost;
  const paused = jest.spyOn(shared, 'remove').mockResolvedValueOnce(undefined);
  await run(() => service.delete(String(p._id), owner, randomUUID(), 0));
  paused.mockRestore();
  let entered!: () => void, release!: () => void;
  const dispatched = new Promise<void>((r) => {
    entered = r;
  });
  const hold = new Promise<void>((r) => {
    release = r;
  });
  const remote = adapter.delete.bind(adapter) as S3ObjectStorage['delete'];
  const deletes = jest
    .spyOn(adapter, 'delete')
    .mockImplementation(async (key) => {
      entered();
      await hold;
      await remote(key);
    });
  const first = run(() => shared.remove(p.imageUrl!));
  await dispatched;
  try {
    await run(() =>
      new SharedCommunityStorage(config, timeline, mongo).remove(p.imageUrl!),
    );
  } finally {
    release();
  }
  await first;
  expect(deletes).toHaveBeenCalledTimes(1);
  expect((await objectRows())[0].status).toBe('DELETED');
  expect(await pending()).toBe(0);
  expect(
    Number(
      (
        await admin.query<{ count: string }>(
          "SELECT count(*) FROM timeline_authority.object_events WHERE event='DELETED'",
        )
      ).rows[0].count,
    ),
  ).toBe(1);
});
test('Mongo transaction failure after upload preserves an audited unreferenced object for review', async () => {
  jest
    .spyOn(posts.prototype, 'save')
    .mockRejectedValue(new Error('synthetic-metadata-failure'));
  await expect(create()).rejects.toMatchObject({ status: 503 });
  expect(await posts.countDocuments()).toBe(0);
  const row = (await objectRows())[0];
  expect(row.status).toBe('STORED');
  expect(await pending()).toBe(0);
  expect(await adapter.read(row.object_key, version(row))).toEqual(png);
  await expect(
    images.readShared('/uploads/community/' + row.public_name),
  ).rejects.toMatchObject({ status: 404 });
});

test('crash after Mongo upload commit before LINKED remains visible only by its live reference and replay allocates no new object', async () => {
  const operation = randomUUID();
  const link = jest
    .spyOn(shared, 'retain')
    .mockRejectedValue(new Error('synthetic-process-stopped-before-link'));
  const p = (await create(operation)) as CommunityPost;
  link.mockRestore();
  expect((await objectRows())[0].status).toBe('STORED');
  expect(await posts.countDocuments()).toBe(1);
  expect(await pending()).toBe(0);
  expect((await images.readShared(p.imageUrl!)).buffer).toEqual(png);
  // The caller lost the response after commit: the exact operation replays its result.
  expect(String(((await create(operation)) as CommunityPost)._id)).toBe(
    String(p._id),
  );
  expect(await objectRows()).toHaveLength(1);
});

test('authority connection loss after admission and before object dispatch preserves an orphan permit and creates no object', async () => {
  const check = adapter.checkAvailability.bind(
    adapter,
  ) as S3ObjectStorage['checkAvailability'];
  jest.spyOn(adapter, 'checkAvailability').mockImplementation(async () => {
    await check();
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND application_name='language-coach-file-effect'",
    );
  });
  const put = jest.spyOn(adapter, 'createImmutable');
  await expect(create()).rejects.toMatchObject({ status: 503 });
  expect(put).not.toHaveBeenCalled();
  expect(await objectRows()).toHaveLength(0);
  expect(await posts.countDocuments()).toBe(0);
  expect(await pending()).toBe(1);
  await expect(close()).rejects.toThrow('UNSETTLED_FILE_EFFECTS');
});

test.each(['CLOSED', 'MAINTENANCE'])(
  '%s refuses fresh upload and deletion before storage mutation',
  async (mode) => {
    const p = (await create()) as CommunityPost;
    await close();
    if (mode === 'MAINTENANCE') {
      const control = await readTimelineControl(mongo, 2000);
      await coordinateAuthority(
        op,
        mongo,
        {
          ...request('maintenance', 3),
          mongoClosedVersion: control.controlVersion,
        },
        options,
      );
    }
    const put = jest.spyOn(adapter, 'createImmutable'),
      del = jest.spyOn(adapter, 'delete');
    await expect(create()).rejects.toMatchObject({ status: 503 });
    await expect(
      run(() => service.delete(String(p._id), owner, randomUUID(), 0)),
    ).rejects.toMatchObject({ status: 503 });
    expect(put).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(await posts.countDocuments()).toBe(1);
    expect(await pending()).toBe(0);
  },
);

test('Mongo and independent authority timeline mismatch rejects before object dispatch', async () => {
  await mongo
    .db!.collection('timelinecontrol')
    .updateOne({}, { $set: { dataTimelineId: B } });
  const put = jest.spyOn(adapter, 'createImmutable');
  await expect(create()).rejects.toMatchObject({ status: 503 });
  expect(put).not.toHaveBeenCalled();
  expect(await objectRows()).toHaveLength(0);
});

test('object outage after committed intent preserves durable pending state and a fresh client completes it', async () => {
  const p = (await create()) as CommunityPost;
  jest
    .spyOn(adapter, 'checkAvailability')
    .mockRejectedValue(new ObjectRequestError());
  await run(() => service.delete(String(p._id), owner, randomUUID(), 0));
  const row = (await objectRows())[0];
  expect(row.status).toBe('DELETE_PENDING');
  expect(row.delete_operation).toBeTruthy();
  expect(await posts.countDocuments()).toBe(0);
  expect(await pending()).toBe(0);
  await run(() =>
    new SharedCommunityStorage(config, timeline, mongo).remove(p.imageUrl!),
  );
  expect((await objectRows())[0].status).toBe('DELETED');
  expect(await pending()).toBe(0);
});

test('an already absent owned object deletes idempotently while retained version remains recoverable', async () => {
  const p = (await create()) as CommunityPost,
    row = (await objectRows())[0];
  await adapter.delete(row.object_key);
  await run(() => service.delete(String(p._id), owner, randomUUID(), 0));
  await run(() => shared.remove(p.imageUrl!));
  expect((await objectRows())[0].status).toBe('DELETED');
  expect(await adapter.read(row.object_key, version(row))).toEqual(png);
  expect(await pending()).toBe(0);
});

test('concurrent creators and a create/delete race use unique immutable keys with consistent live references', async () => {
  const [a, b] = (await Promise.all([create(), create()])) as CommunityPost[];
  expect(a.imageUrl).not.toBe(b.imageUrl);
  const [, c] = await Promise.all([
    run(() => service.delete(String(a._id), owner, randomUUID(), 0)),
    create(),
  ]);
  const rows = await objectRows();
  expect(new Set(rows.map((r) => r.object_key)).size).toBe(3);
  expect(await posts.countDocuments()).toBe(2);
  expect(rows.filter((r) => r.status === 'DELETED')).toHaveLength(1);
  for (const p of [b, c as CommunityPost])
    expect((await images.readShared(p.imageUrl!)).buffer).toEqual(png);
  await expect(images.readShared(a.imageUrl!)).rejects.toMatchObject({
    status: 404,
  });
  expect(await pending()).toBe(0);
});
test('store unavailable before upload denies work without a pending object mutation', async () => {
  jest
    .spyOn(adapter, 'checkAvailability')
    .mockRejectedValue(new ObjectRequestError());
  await expect(create()).rejects.toMatchObject({ status: 503 });
  expect(await objectRows()).toHaveLength(0);
  expect(await posts.countDocuments()).toBe(0);
  expect(await pending()).toBe(0);
});
test('lost upload acknowledgement after object write retains independent PENDING history and a nonexpiring permit', async () => {
  const put = adapter.createImmutable.bind(
    adapter,
  ) as S3ObjectStorage['createImmutable'];
  jest.spyOn(adapter, 'createImmutable').mockImplementation(async (...args) => {
    await put(...args);
    throw new ObjectRequestError(true);
  });
  await expect(create()).rejects.toMatchObject({ status: 503 });
  const row = (await objectRows())[0];
  expect(row.status).toBe('PENDING');
  expect(row.create_effect).toBeTruthy();
  expect(await pending()).toBe(1);
  await expect(close()).rejects.toThrow('UNSETTLED_FILE_EFFECTS');
});
test('authority close during upload cannot complete maintenance until remote work settles', async () => {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => (enter = r)),
    hold = new Promise<void>((r) => (release = r)),
    put = adapter.createImmutable.bind(
      adapter,
    ) as S3ObjectStorage['createImmutable'];
  jest.spyOn(adapter, 'createImmutable').mockImplementation(async (...args) => {
    const result = await put(...args);
    enter();
    await hold;
    return result;
  });
  const work = create().then(
    () => null,
    (e: unknown) => e,
  );
  await entered;
  try {
    await expect(close()).rejects.toThrow('UNSETTLED_FILE_EFFECTS');
    expect(await pending()).toBe(1);
    const control = await readTimelineControl(mongo, 2000);
    await expect(
      coordinateAuthority(
        op,
        mongo,
        {
          ...request('maintenance', 3),
          mongoClosedVersion: control.controlVersion,
        },
        options,
      ),
    ).rejects.toThrow('UNSETTLED_FILE_EFFECTS');
    expect(
      (
        await admin.query<{ timeline_id: string }>(
          'SELECT timeline_id FROM timeline_authority.state',
        )
      ).rows[0].timeline_id,
    ).toBe(A);
  } finally {
    release();
  }
  expect(await work).toMatchObject({ status: 503 });
  expect(await pending()).toBe(0);
  expect(await posts.countDocuments()).toBe(0);
  await close();
  const control = await readTimelineControl(mongo, 2000);
  await coordinateAuthority(
    op,
    mongo,
    {
      ...request('maintenance', 3),
      mongoClosedVersion: control.controlVersion,
    },
    options,
  );
});
test('authority unavailable during deletion keeps the object reference and rejects metadata deletion', async () => {
  const p = (await create()) as CommunityPost,
    u = new URL(String(config.get('TIMELINE_AUTHORITY_URL')));
  u.port = '1';
  config.set('TIMELINE_AUTHORITY_URL', u.toString());
  await expect(
    run(() => service.delete(String(p._id), owner, randomUUID(), 0)),
  ).rejects.toMatchObject({ status: 503 });
  expect(await posts.countDocuments()).toBe(1);
  expect((await objectRows())[0].status).toBe('LINKED');
});
test('crash boundary after Mongo commit leaves a durable deletion intent that a fresh process can retry idempotently', async () => {
  const p = (await create()) as CommunityPost,
    remove = jest
      .spyOn(shared, 'remove')
      .mockRejectedValue(new Error('synthetic-process-stop'));
  await run(() => service.delete(String(p._id), owner, randomUUID(), 0));
  expect(await posts.countDocuments()).toBe(0);
  expect((await objectRows())[0].status).toBe('DELETE_PENDING');
  remove.mockRestore();
  const restarted = new SharedCommunityStorage(config, timeline, mongo);
  await run(() => restarted.remove(p.imageUrl!));
  await run(() => restarted.remove(p.imageUrl!));
  expect((await objectRows())[0].status).toBe('DELETED');
  expect(await pending()).toBe(0);
});
test('lost deletion acknowledgement retains intent/permit and the original version; no expiry cleanup', async () => {
  const p = (await create()) as CommunityPost,
    del = adapter.delete.bind(adapter) as S3ObjectStorage['delete'];
  jest.spyOn(adapter, 'delete').mockImplementation(async (key) => {
    await del(key);
    throw new ObjectRequestError(true);
  });
  await run(() => service.delete(String(p._id), owner, randomUUID(), 0));
  const row = (await objectRows())[0];
  expect(row.status).toBe('DELETE_PENDING');
  expect(row.delete_effect).toBeTruthy();
  expect(await pending()).toBe(1);
  expect(await adapter.read(row.object_key, version(row))).toEqual(png);
  await expect(close()).rejects.toThrow('UNSETTLED_FILE_EFFECTS');
});
test('wrong bucket/namespace identity and missing referenced object fail closed', async () => {
  await expect(
    new S3ObjectStorage({
      ...adapter.config,
      namespace: 'wrong',
    }).verifyIdentity(),
  ).rejects.toThrow('IDENTITY_MISMATCH');
  await expect(
    new S3ObjectStorage({
      ...adapter.config,
      bucket: 'wrong-bucket',
    }).verifyIdentity(),
  ).rejects.toThrow();
  const p = (await create()) as CommunityPost,
    row = (await objectRows())[0];
  await adminAdapter.request('DELETE', row.object_key, {
    versionId: version(row),
  });
  await expect(images.readShared(p.imageUrl!)).rejects.toMatchObject({
    status: 503,
  });
  expect(await posts.countDocuments()).toBe(1);
});
test.each(['LINKED', 'DELETED'])(
  'B verifies a restored %s reference without replaying A deletion or absent-reference cleanup',
  async (initialState) => {
    const p = (await create()) as CommunityPost,
      row = (await objectRows())[0];
    const staleConfig = new ConfigService({
      ...process.env,
      DATA_TIMELINE_ID: A,
      DATA_WRITE_MODE: 'OPEN',
      TIMELINE_AUTHORITY_GENERATION: 1,
    });
    if (initialState === 'DELETED')
      await run(() => service.delete(String(p._id), owner, randomUUID(), 0));
    await close();
    if (initialState === 'DELETED') await posts.create(p); // Synthetic restored metadata, while CLOSED.
    let control = await readTimelineControl(mongo, 2000);
    await coordinateAuthority(
      op,
      mongo,
      {
        ...request('maintenance', 3),
        mongoClosedVersion: control.controlVersion,
      },
      options,
    );
    await coordinateAuthority(
      op,
      mongo,
      {
        ...request('allocate', 4, B),
        mongoClosedVersion: control.controlVersion,
      },
      options,
    );
    await coordinateAuthority(
      op,
      mongo,
      {
        ...request('install', 5, B),
        mongoClosedVersion: control.controlVersion,
      },
      options,
    );
    options.deploymentTimeline = B;
    options.deploymentGeneration = 2;
    config.set('DATA_TIMELINE_ID', B);
    config.set('TIMELINE_AUTHORITY_GENERATION', 2);
    process.env.TIMELINE_AUTHORITY_GENERATION = '2';
    expect((await objectRows())[0].verified_timeline).toBe(A);
    // Explicit operator verifies this exact retained version and current Mongo reference.
    expect(await adapter.read(row.object_key, version(row))).toEqual(png);
    await op.client.query('SELECT timeline_authority.object_adopt($1,6,$2)', [
      row.id,
      'synthetic-verified-B-reference',
    ]);
    await op.client.query(
      'SELECT timeline_authority.object_reconcile_complete($1,6,1,$2,$3)',
      [randomUUID(), row.sha256, 'synthetic-complete-B-inventory'],
    );
    control = await readTimelineControl(mongo, 2000);
    await coordinateAuthority(
      op,
      mongo,
      {
        ...request('reconcile', 6, B),
        mongoClosedVersion: control.controlVersion,
      },
      options,
    );
    options.writeMode = 'OPEN';
    await coordinateAuthority(op, mongo, request('open', 7, B), options);
    const staleAuthority = new DurableTimelineAuthority(staleConfig);
    try {
      const staleTimeline = new MutationTimeline(
        mongo,
        staleConfig,
        new TimelineWriteGate(
          mongo,
          staleConfig,
          () => false,
          () => true,
          staleAuthority,
        ),
      );
      await expect(
        staleTimeline.run(scope, () =>
          new SharedCommunityStorage(
            staleConfig,
            staleTimeline,
            mongo,
          ).prepareDelete(p.imageUrl!, randomUUID(), owner),
        ),
      ).rejects.toMatchObject({ status: 503 });
    } finally {
      staleAuthority.onModuleDestroy();
    }
    expect((await objectRows())[0].delete_operation).toBeNull();
    expect((await objectRows())[0].delete_effect).toBeNull();
    expect((await images.readShared(p.imageUrl!)).buffer).toEqual(png);
    await run(() => images.cleanup(p.imageUrl, 'synthetic-stale-A'));
    expect(await adapter.read(row.object_key, version(row))).toEqual(png);
    await posts.deleteMany({});
    await timeline.run(
      { dataTimelineId: B, protocol: 2, legacyReceipts: false },
      () => shared.remove(p.imageUrl!),
    );
    expect((await objectRows())[0].status).toBe('LINKED');
    expect(await adapter.read(row.object_key, version(row))).toEqual(png);
    await expect(images.readShared(p.imageUrl!)).rejects.toMatchObject({
      status: 404,
    });
  },
);
