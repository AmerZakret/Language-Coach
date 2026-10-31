import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import {
  INestApplication,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { Model } from 'mongoose';
import { AuthModule } from '../auth/auth.module';
import { User } from '../users/schemas/user.schema';
import { CommunityModule } from './community.module';
import { SharedCommunityStorage } from './shared-community.storage';
import { CommunityImageStorage } from './community-image.storage';
import { configureCommunityUploadServing } from './community-upload-serving';
import { initializeTestTimeline } from '../../test/timeline-fixture';

describe('C2 authenticated backend-mediated image boundary', () => {
  jest.setTimeout(120000);
  let app: INestApplication,
    mongo: MongoMemoryReplSet,
    users: Model<User>,
    owner: string,
    other: string,
    png: Buffer;
  const name = randomUUID() + '.png',
    url = '/uploads/community/' + name;
  const shared = {
    enabled: () => true,
    read: jest.fn(),
    create: jest.fn(),
    prepareDelete: jest.fn(),
    retain: jest.fn(),
    remove: jest.fn(),
    checkAvailability: jest.fn(),
  };
  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MongooseModule.forRoot(mongo.getUri()),
        AuthModule,
        CommunityModule,
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({ JWT_SECRET: randomBytes(32).toString('hex') }),
      )
      .overrideProvider(SharedCommunityStorage)
      .useValue(shared)
      .compile();
    app = module.createNestApplication();
    app.useLogger(false);
    configureCommunityUploadServing(app as NestExpressApplication);
    await app.init();
    await initializeTestTimeline(app);
    users = module.get(getModelToken(User.name));
    await users.init();
    const a = await users.create({
        name: 'Synthetic owner',
        email: 'owner@synthetic.invalid',
        passwordHash: 'fixture',
      }),
      b = await users.create({
        name: 'Synthetic reader',
        email: 'reader@synthetic.invalid',
        passwordHash: 'fixture',
      });
    owner = app.get(JwtService).sign({ sub: String(a._id) });
    other = app.get(JwtService).sign({ sub: String(b._id) });
    png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer();
  });
  beforeEach(() => {
    shared.read.mockReset();
    shared.read.mockResolvedValue({ buffer: png, contentType: 'image/png' });
  });
  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });
  test('unauthenticated image request is 401 and never reaches object storage', async () => {
    await request(app.getHttpServer() as import('node:http').Server)
      .get(url)
      .expect(401);
    expect(shared.read).not.toHaveBeenCalled();
  });
  test('invalid JWT is 401 and never reaches object storage', async () => {
    await request(app.getHttpServer() as import('node:http').Server)
      .get(url)
      .auth('invalid', { type: 'bearer' })
      .expect(401);
    expect(shared.read).not.toHaveBeenCalled();
  });
  test('referenced community images are shared among authenticated members with private cache headers', async () => {
    for (const token of [owner, other]) {
      const r = await request(app.getHttpServer() as import('node:http').Server)
        .get(url)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(r.body).toEqual(png);
      expect(r.headers['cache-control']).toBe('private, no-store');
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['content-disposition']).toBe('inline');
    }
  });
  test('HEAD uses the same authenticated route without response bytes', async () => {
    const r = await request(app.getHttpServer() as import('node:http').Server)
      .head(url)
      .auth(other, { type: 'bearer' })
      .expect(200);
    expect(r.text).toBeUndefined();
    expect(Number(r.headers['content-length'])).toBe(png.length);
  });
  test('forged/unreferenced object returns 404 and never falls back to a filesystem path', async () => {
    shared.read.mockRejectedValue(new NotFoundException());
    await request(app.getHttpServer() as import('node:http').Server)
      .get(url)
      .auth(owner, { type: 'bearer' })
      .expect(404);
  });
  test('storage outage returns 503 through the authenticated route', async () => {
    shared.read.mockRejectedValue(new ServiceUnavailableException());
    await request(app.getHttpServer() as import('node:http').Server)
      .get(url)
      .auth(owner, { type: 'bearer' })
      .expect(503);
  });
  test.each([
    '/uploads/community/..%2fsecret.png',
    '/uploads/community/a/b.png',
    '/uploads/community/evil.svg',
  ])('forged path %s is not read', async (path) => {
    await request(app.getHttpServer() as import('node:http').Server)
      .get(path)
      .auth(owner, { type: 'bearer' })
      .expect(404);
    expect(shared.read).not.toHaveBeenCalled();
  });
  test('executable disguise rejected by image decoder before any shared create', async () => {
    await expect(
      app.get(CommunityImageStorage).store(
        {
          buffer: Buffer.from('<html>synthetic executable</html>'),
          originalname: 'image.png',
          mimetype: 'image/png',
        } as Express.Multer.File,
        'synthetic-owner',
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(shared.create).not.toHaveBeenCalled();
  });
});
