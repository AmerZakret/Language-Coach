import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, mongo } from 'mongoose';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import request from 'supertest';

describe('application e2e (disposable infrastructure only)', () => {
  jest.setTimeout(120000);
  let replica: MongoMemoryReplSet | undefined;
  let root: string | undefined;
  let app: NestExpressApplication | undefined;
  let connection: Connection;
  let uri: string;
  let fetch: jest.SpyInstance;
  let mongoConnect: jest.SpyInstance | undefined;

  beforeAll(async () => {
    // Import no application module until both disposable resources exist.
    // Initialization failure cannot fall back to developer configuration.
    replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    uri = replica.getUri('phase9a_e2e');
    root = await mkdtemp(join(tmpdir(), 'language-9a-e2e-'));
    const environment: NodeJS.ProcessEnv = {};
    for (const name of [
      'PATH',
      'SystemRoot',
      'TEMP',
      'TMP',
      'HOME',
      'USERPROFILE',
    ])
      if (process.env[name]) environment[name] = process.env[name];
    Object.assign(environment, {
      NODE_ENV: 'test',
      MONGODB_URI: uri,
      JWT_SECRET: randomBytes(48).toString('base64'),
      AI_ENABLED: 'false',
      PRONUNCIATION_ENABLED: 'false',
      CORS_ORIGINS: 'https://app.example.invalid',
      UPLOAD_ROOT: root,
    });
    jest.replaceProperty(process, 'env', environment);

    const expected = new mongo.MongoClient(uri).options;
    const connect = mongo.MongoClient.prototype.connect;
    mongoConnect = jest
      .spyOn(mongo.MongoClient.prototype, 'connect')
      .mockImplementation(function (this: mongo.MongoClient) {
        const options = this.options;
        if (
          options.srvHost ||
          options.dbName !== expected.dbName ||
          options.replicaSet !== expected.replicaSet ||
          JSON.stringify(options.hosts.map(String).sort()) !==
            JSON.stringify(expected.hosts.map(String).sort())
        )
          throw new Error('E2E isolation rejected a non-fixture Mongo target.');
        return connect.call(this);
      });
    fetch = jest.spyOn(global, 'fetch').mockImplementation(() => {
      throw new Error('External providers are forbidden in e2e tests.');
    });

    // Force dotenv off BEFORE evaluating AppModule's decorator. Supplying an
    // environment alone is insufficient: ConfigModule otherwise reads .env.
    const forRoot = ConfigModule.forRoot.bind(ConfigModule);
    jest
      .spyOn(ConfigModule, 'forRoot')
      .mockImplementation((options) =>
        forRoot({ ...options, ignoreEnvFile: true }),
      );
    const { AppModule } =
      require('../src/app.module') as typeof import('../src/app.module');
    const { HttpSecurity } =
      require('../src/security/http-security') as typeof import('../src/security/http-security');
    const { TrafficLifecycle } =
      require('../src/operations/traffic-lifecycle.service') as typeof import('../src/operations/traffic-lifecycle.service');
    const { ReadinessService } =
      require('../src/operations/readiness.service') as typeof import('../src/operations/readiness.service');
    const { configureCommunityUploadServing } =
      require('../src/community/community-upload-serving') as typeof import('../src/community/community-upload-serving');

    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    app.useLogger(false);
    const security = app.get(HttpSecurity);
    security.install(app);
    app.get(TrafficLifecycle).attach(app);
    security.installBodyParsers(app);
    configureCommunityUploadServing(app);
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    await app.get(ReadinessService).refresh();
  });

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      // Memory-server's shutdown clients are not application connections.
      mongoConnect?.mockRestore();
      try {
        await replica?.stop();
      } finally {
        jest.restoreAllMocks();
        if (root) {
          const child = relative(resolve(tmpdir()), resolve(root));
          if (!child.startsWith('language-9a-e2e-') || child.includes(sep))
            throw new Error('Unsafe e2e fixture cleanup path.');
          await rm(root, { recursive: true, force: true });
        }
      }
    }
  });

  it('uses only generated infrastructure and synthetic environment, with dotenv disabled', () => {
    const config = app!.get(ConfigService);
    expect(config.get('MONGODB_URI')).toBe(uri);
    expect(config.get('UPLOAD_ROOT')).toBe(root);
    expect(config.get('NODE_ENV')).toBe('test');
    expect(config.get('AI_ENABLED')).toBe(false);
    expect(config.get('PRONUNCIATION_ENABLED')).toBe(false);
    expect(config.get('GEMINI_API_KEY')).toBe('');
    expect(config.get('PRONUNCIATION_SERVICE_TOKEN')).toBe('');
    expect(ConfigModule.forRoot).toHaveBeenCalled();
    expect(connection.getClient().options.dbName).toBe('phase9a_e2e');
  });

  it('rejects non-fixture database targets before any connection attempt', () => {
    const foreign = new mongo.MongoClient(
      'mongodb://db.example.invalid/forbidden',
    );
    const otherLocal = new mongo.MongoClient(
      'mongodb://127.0.0.1:1/phase9a_e2e',
    );
    const srv = new mongo.MongoClient(
      'mongodb+srv://db.example.invalid/forbidden',
    );
    const wrongDatabase = new mongo.MongoClient(
      replica!.getUri('not_the_fixture'),
    );
    expect(() => foreign.connect()).toThrow('E2E isolation rejected');
    expect(() => otherLocal.connect()).toThrow('E2E isolation rejected');
    expect(() => srv.connect()).toThrow('E2E isolation rejected');
    expect(() => wrongDatabase.connect()).toThrow('E2E isolation rejected');
  });

  it('serves the application and independent liveness/readiness endpoints', async () => {
    await request(app!.getHttpServer()).get('/').expect(200, 'Hello World!');
    await request(app!.getHttpServer())
      .get('/health/live')
      .expect(200, { status: 'ok' });
    await request(app!.getHttpServer()).get('/health/ready').expect(200);
  });

  it('rejects new generation and pronunciation without calling any provider', async () => {
    const inserted = await connection.db!.collection('users').insertOne({
      name: 'E2E fixture',
      email: 'e2e@example.invalid',
      passwordHash: 'unused-fixture',
      isGuest: false,
      totalXp: 0,
    });
    const token = app!
      .get(JwtService)
      .sign({ sub: inserted.insertedId.toString() });
    await request(app!.getHttpServer())
      .post('/ai-coach/chat')
      .auth(token, { type: 'bearer' })
      .set('X-Idempotency-Key', randomUUID())
      .send({ message: 'fixture', language: 'en', targetLanguage: 'en' })
      .expect(503)
      .expect((response) =>
        expect(response.body.code).toBe('FEATURE_DISABLED'),
      );
    expect(fetch).not.toHaveBeenCalled();
    expect(
      await connection.db!.collection('chatmessages').countDocuments(),
    ).toBe(0);
    await request(app!.getHttpServer())
      .post('/pronunciation/assess')
      .auth(token, { type: 'bearer' })
      .field('targetText', 'fixture')
      .field('targetLanguage', 'en')
      .attach('audio', Buffer.from('fixture'), 'fixture.wav')
      .expect(503)
      .expect((response) =>
        expect(response.body.code).toBe('FEATURE_DISABLED'),
      );
    expect(fetch).not.toHaveBeenCalled();
  });
});
