// Test-only capability. No URI/env/production target can be supplied by a caller.
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { NestExpressApplication } from '@nestjs/platform-express';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, mongo } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  writeFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { ProgressModule } from '../src/progress/progress.module';
import { FlashcardsModule } from '../src/flashcards/flashcards.module';
import { CommunityModule } from '../src/community/community.module';
import { AiCoachModule } from '../src/ai-coach/ai-coach.module';
import { SecurityModule } from '../src/security/security.module';
import { HttpSecurity } from '../src/security/http-security';
import { OperationsModule } from '../src/operations/operations.module';
import { TrafficLifecycle } from '../src/operations/traffic-lifecycle.service';
import { ReadinessService } from '../src/operations/readiness.service';
import { readTimelineControl } from '../src/operations/timeline-gate';
import { applyControlRequest } from '../src/tooling/timeline-control';
import { CRITICAL_INDEXES } from '../src/operations/index-inventory';
import { User } from '../src/users/schemas/user.schema';
import { AiContextService } from '../src/flashcards/services/ai-context.service';
import {
  captureRestoreManifest,
  auditRestoreConsistency,
} from '../src/tooling/restore-consistency';

export const A = '11111111-1111-4111-8111-111111111111';
export const B = '22222222-2222-4222-8222-222222222222';
export const C = '33333333-3333-4333-8333-333333333333';
export function latch<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
export class RestoreDrill {
  replica!: MongoMemoryReplSet;
  root!: string;
  db!: Connection;
  apps: NestExpressApplication[] = [];
  configs: ConfigService[] = [];
  owner!: string;
  token!: string;
  readonly database = `restore10e_${randomUUID().replaceAll('-', '')}`;
  async start() {
    this.root = await mkdtemp(join(tmpdir(), 'restore-10e-'));
    process.env.UPLOAD_ROOT = this.root;
    this.replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const secret = randomUUID() + randomUUID();
    for (let i = 0; i < 2; i++) {
      const config = new ConfigService({
        NODE_ENV: 'test',
        JWT_SECRET: secret,
        GEMINI_API_KEY: 'synthetic-only',
        AI_ENABLED: true,
        PRONUNCIATION_ENABLED: false,
        TRUST_PROXY: 'false',
        CORS_ORIGINS: 'https://app.example.invalid',
        READINESS_TIMEOUT_MS: 5000,
      });
      const app = await this.createInstance(config);
      this.apps.push(app);
      this.configs.push(config);
    }
    this.db = this.apps[0].get<Connection>(getConnectionToken());
    this.assertDisposable();
    await mkdir(join(this.root, 'community'), { recursive: true });
  }
  private async createInstance(config: ConfigService) {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MongooseModule.forRoot(this.replica.getUri(this.database), {
          monitorCommands: true,
        }),
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
      .useValue(config)
      .overrideProvider(AiContextService)
      .useValue({
        generateContext: () =>
          Promise.resolve({ sentences: [], mnemonics: [] }),
      })
      .compile();
    const app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    app.useLogger(false);
    app.get<HttpSecurity>(HttpSecurity).install(app);
    app.get<TrafficLifecycle>(TrafficLifecycle).attach(app);
    app.get<HttpSecurity>(HttpSecurity).installBodyParsers(app);
    await app.init();
    return app;
  }
  async restart(instance: number) {
    this.assertDisposable();
    await this.apps[instance].close();
    this.apps[instance] = await this.createInstance(this.configs[instance]);
    await this.apps[instance].get<ReadinessService>(ReadinessService).refresh();
  }
  assertDisposable() {
    if (
      this.db.name !== this.database ||
      !this.db
        .getClient()
        .options.hosts.every(
          (host) => host.host === '127.0.0.1' && host.port > 0,
        )
    )
      throw new Error('Not the owned disposable Mongo');
    const child = relative(resolve(tmpdir()), resolve(this.root));
    if (!child.startsWith('restore-10e-') || child.includes(sep))
      throw new Error('Not the owned temporary upload root');
  }
  async reset() {
    this.assertDisposable();
    for (const config of this.configs) config.set('DATA_WRITE_MODE', 'CLOSED');
    await this.db.dropDatabase();
    await this.restoreUploads({});
    await applyControlRequest(
      this.db,
      {
        action: 'initialize',
        eventId: randomUUID(),
        targetTimelineId: A,
        operatorReference: 'disposable-10e',
      },
      { expectedTimelineId: A, writeMode: 'CLOSED' },
    );
    for (const model of this.db.modelNames())
      await this.db.model(model).createIndexes();
    for (const index of CRITICAL_INDEXES)
      await this.db
        .db!.collection(index.collection)
        .createIndex(index.key, { unique: true, name: index.id });
    await this.transition('open');
    for (const config of this.configs) {
      config.set('DATA_TIMELINE_ID', A);
      config.set('DATA_WRITE_MODE', 'OPEN');
      config.set('CLIENT_PROTOCOL_POLICY', 'ENFORCE_MUTATIONS');
      config.set('NODE_ENV', 'production');
    }
    const user = await this.apps[0]
      .get<Model<User>>(getModelToken(User.name))
      .create({
        name: 'Synthetic',
        email: 'synthetic@example.invalid',
        passwordHash: 'fixture',
        progressEpoch: 5,
      });
    this.owner = String(user._id);
    this.token = this.apps[0]
      .get<JwtService>(JwtService)
      .sign({ sub: this.owner });
    await this.db.db!.collection('lessons').insertOne({
      id: 'one',
      targetLanguage: 'en',
      xpReward: 50,
      title: 'Synthetic',
    });
    await this.refresh();
  }
  async refresh() {
    for (const app of this.apps)
      await app.get<ReadinessService>(ReadinessService).refresh();
  }
  async transition(
    action: 'close' | 'open' | 'install-timeline',
    target?: string,
  ) {
    const row = await readTimelineControl(this.db, 5000);
    return applyControlRequest(
      this.db,
      {
        action,
        eventId: randomUUID(),
        targetTimelineId: target ?? row.dataTimelineId,
        expectedTimelineId: row.dataTimelineId,
        expectedState: row.writeState,
        expectedVersion: row.controlVersion,
        operatorReference: 'disposable-10e',
        ...(action === 'install-timeline'
          ? { sourceTimelineId: row.dataTimelineId }
          : {}),
      },
      {
        expectedTimelineId: target ?? row.dataTimelineId,
        writeMode: action === 'open' ? 'OPEN' : 'CLOSED',
      },
    );
  }
  call(
    method: 'post' | 'put' | 'patch' | 'delete',
    path: string,
    timeline: string | null = A,
    key = randomUUID(),
    instance = 0,
    protocol = '2',
  ) {
    let req = request(this.apps[instance].getHttpServer())
      [method](path)
      .auth(this.token, { type: 'bearer' })
      .set('X-Client-Protocol', protocol)
      .set('X-Idempotency-Key', key);
    if (timeline !== null) req = req.set('X-Data-Timeline', timeline);
    return req;
  }
  send(timeline = A, key = randomUUID()) {
    return this.call('post', '/ai-coach/chat', timeline, key).send({
      message: 'synthetic',
      language: 'en',
      targetLanguage: 'en',
    });
  }
  clear(timeline = A, key = randomUUID()) {
    return this.call('delete', '/ai-coach/clear', timeline, key).query({
      targetLanguage: 'en',
    });
  }
  async snapshot() {
    this.assertDisposable();
    const collections: Record<string, mongo.Document[]> = {};
    for (const { name } of await this.db.db!.listCollections().toArray())
      if (!name.startsWith('system.'))
        collections[name] = await this.db
          .db!.collection(name)
          .find({})
          .toArray();
    const uploads: Record<string, Buffer> = {};
    for (const name of await readdir(join(this.root, 'community')))
      uploads[name] = await readFile(join(this.root, 'community', name));
    return {
      collections,
      uploads,
      manifest: await captureRestoreManifest(this.db, this.root, randomUUID()),
    };
  }
  async restoreUploads(files: Record<string, Buffer>) {
    this.assertDisposable();
    const folder = join(this.root, 'community');
    await mkdir(folder, { recursive: true });
    for (const name of await readdir(folder)) {
      if (name.includes('/') || name.includes('\\') || name === '..')
        throw new Error('Unsafe fixture entry');
      await rm(join(folder, name));
    }
    for (const [name, bytes] of Object.entries(files)) {
      if (name.includes('/') || name.includes('\\') || name === '..')
        throw new Error('Unsafe snapshot entry');
      await writeFile(join(folder, name), bytes);
    }
  }
  async restore(
    snapshot: Awaited<ReturnType<RestoreDrill['snapshot']>>,
    uploads = true,
  ) {
    this.assertDisposable();
    if (
      this.configs.some((config) => config.get('DATA_WRITE_MODE') !== 'CLOSED')
    )
      throw new Error('Restore requires external isolation');
    const current = (await this.db.db!.listCollections().toArray()).map(
      (item) => item.name,
    );
    for (const name of new Set([
      ...current,
      ...Object.keys(snapshot.collections),
    ])) {
      if (name.startsWith('system.')) continue;
      await this.db.db!.collection(name).deleteMany({});
      const rows = snapshot.collections[name] ?? [];
      if (rows.length)
        await this.db
          .db!.collection(name)
          .insertMany(
            rows.map((row) =>
              mongo.BSON.deserialize(mongo.BSON.serialize(row)),
            ),
          );
    }
    if (uploads) await this.restoreUploads(snapshot.uploads);
    // S0 can contain OPEN A. External isolation remains CLOSED throughout.
    if ((await readTimelineControl(this.db, 5000)).writeState === 'OPEN')
      await this.transition('close');
  }
  async restoreB(
    snapshot: Awaited<ReturnType<RestoreDrill['snapshot']>>,
    uploads = true,
    reopen = true,
  ) {
    for (const config of this.configs) config.set('DATA_WRITE_MODE', 'CLOSED');
    await this.transition('close');
    await this.restore(snapshot, uploads);
    if (reopen) {
      const restored = await readTimelineControl(this.db, 5000);
      const evidence = await auditRestoreConsistency(
        this.db,
        this.root,
        snapshot.manifest,
        { expectedTimelineId: restored.dataTimelineId, writeMode: 'CLOSED' },
      );
      if (!evidence.coordinatedSnapshotMatches)
        throw new Error('Restored source audit requires reconciliation');
    }
    await this.transition('install-timeline', B);
    for (const config of this.configs) config.set('DATA_TIMELINE_ID', B);
    if (reopen) {
      const evidence = await auditRestoreConsistency(
        this.db,
        this.root,
        snapshot.manifest,
        { expectedTimelineId: B, writeMode: 'CLOSED' },
      );
      if (!evidence.coordinatedSnapshotMatches)
        throw new Error(
          'Drill canary requires matching coordinated snapshot evidence',
        );
      await this.transition('open');
      for (const config of this.configs) config.set('DATA_WRITE_MODE', 'OPEN');
    }
    await this.refresh();
  }
  async stop() {
    for (const app of this.apps) await app.close();
    await this.replica?.stop();
    if (this.root) {
      this.assertDisposableRoot();
      await rm(this.root, { recursive: true, force: true });
    }
    delete process.env.UPLOAD_ROOT;
  }
  private assertDisposableRoot() {
    const child = relative(resolve(tmpdir()), resolve(this.root));
    if (!child.startsWith('restore-10e-') || child.includes(sep))
      throw new Error('Unsafe fixture cleanup');
  }
}

// label, external timeline/mode, Mongo timeline/gate, protocol, client timeline, policy, expected HTTP
export const restoreReopeningMatrix = [
  ['A baseline', A, 'OPEN', A, 'OPEN', '2', A, 'ENFORCE_MUTATIONS', 200],
  ['both closed', B, 'CLOSED', B, 'CLOSED', '2', B, 'ENFORCE_MUTATIONS', 503],
  ['Mongo closed', B, 'OPEN', B, 'CLOSED', '2', B, 'ENFORCE_MUTATIONS', 503],
  ['external closed', B, 'CLOSED', B, 'OPEN', '2', B, 'ENFORCE_MUTATIONS', 503],
  ['old A', B, 'OPEN', B, 'OPEN', '2', A, 'ENFORCE_MUTATIONS', 409],
  ['unknown C', B, 'OPEN', B, 'OPEN', '2', C, 'ENFORCE_MUTATIONS', 409],
  ['malformed', B, 'OPEN', B, 'OPEN', '2', 'bad', 'ENFORCE_MUTATIONS', 400],
  ['missing', B, 'OPEN', B, 'OPEN', '2', null, 'ENFORCE_MUTATIONS', 428],
  [
    'transitional unmarked legacy',
    B,
    'OPEN',
    B,
    'OPEN',
    '1',
    null,
    'ALLOW_LEGACY',
    200,
  ],
  [
    'enforced legacy',
    B,
    'OPEN',
    B,
    'OPEN',
    '1',
    null,
    'ENFORCE_MUTATIONS',
    426,
  ],
  ['current B', B, 'OPEN', B, 'OPEN', '2', B, 'ENFORCE_MUTATIONS', 200],
  ['external mismatch', A, 'OPEN', B, 'OPEN', '2', B, 'ENFORCE_MUTATIONS', 503],
] as const;
