import { CommunityService } from './community.service';
import { MutationReceipts } from '../common/mutation-receipt';
import { initializeTestTimeline } from '../../test/timeline-fixture';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import sharp from 'sharp';
import { AuthModule } from '../auth/auth.module';
import { User } from '../users/schemas/user.schema';
import { CommunityModule } from './community.module';
import { CommunityPost } from './schemas/community-post.schema';
import {
  COMMUNITY_IMAGE_LIMIT,
  COMMUNITY_PIXEL_LIMIT,
  CommunityImageStorage,
  resolveUploadRoot,
} from './community-image.storage';
import { configureCommunityUploadServing } from './community-upload-serving';
import { telemetry } from '../operations/telemetry';

// Real multipart interceptor, validation pipe, JWT strategy, filesystem, image
// decoder and disposable MongoDB. No production upload path or database is used.
describe('Phase 7B community image safety and lifecycle', () => {
  jest.setTimeout(120000);
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let temporary: string;
  let uploadRoot: string;
  let previousRoot: string | undefined;
  let users: Model<User>;
  let posts: Model<CommunityPost>;
  let images: CommunityImageStorage;
  let owner: User;
  let foreign: User;
  let token: string;
  let png: Buffer;
  const create = () =>
    request(app.getHttpServer() as import('node:http').Server)
      .post('/community/posts')
      .auth(token, { type: 'bearer' })
      .set('X-Idempotency-Key', crypto.randomUUID());
  const files = async () =>
    fs.readdir(join(uploadRoot, 'community')).catch((error) => {
      if (error.code === 'ENOENT') return [] as string[];
      throw error;
    });
  const disk = (url: string) =>
    join(uploadRoot, 'community', url.split('/').pop()!);
  const upload = (buffer: Buffer, filename: string, contentType: string) =>
    create()
      .field('learningLanguage', 'English')
      .attach('image', buffer, { filename, contentType });
  const file = (
    buffer = png,
    originalname = 'client.png',
    mimetype = 'image/png',
  ) =>
    ({
      buffer,
      originalname,
      mimetype,
      size: buffer.length,
    }) as Express.Multer.File;
  const imagePost = async () =>
    (await upload(png, 'client.png', 'image/png').expect(201)).body as {
      _id: string;
      imageUrl: string;
      revision: number;
    };
  const edit = (id: string) =>
    request(app.getHttpServer() as import('node:http').Server)
      .put(`/community/posts/${id}`)
      .auth(token, { type: 'bearer' })
      .set('X-Idempotency-Key', crypto.randomUUID())
      .field('expectedRevision', '0');

  beforeAll(async () => {
    temporary = await fs.mkdtemp(join(tmpdir(), 'lingua-community-test-'));
    uploadRoot = join(temporary, 'uploads');
    previousRoot = process.env.UPLOAD_ROOT;
    process.env.UPLOAD_ROOT = uploadRoot;
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
        new ConfigService({
          JWT_SECRET: crypto.randomBytes(32).toString('hex'),
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
    configureCommunityUploadServing(app as NestExpressApplication);
    users = module.get(getModelToken(User.name));
    posts = module.get(getModelToken(CommunityPost.name));
    images = module.get(CommunityImageStorage);
    await app.init();
    await initializeTestTimeline(app);
    await Promise.all([users.init(), posts.init()]);
    png = await sharp({
      create: { width: 4, height: 3, channels: 3, background: '#654321' },
    })
      .png()
      .toBuffer();
  });
  beforeEach(async () => {
    await Promise.all([users.deleteMany({}), posts.deleteMany({})]);
    // Only flat files inside this test's explicitly created upload directory.
    for (const name of await files())
      await fs.unlink(join(uploadRoot, 'community', name));
    owner = await users.create({
      name: 'Owner',
      email: 'owner@example.test',
      passwordHash: 'fixture',
    });
    foreign = await users.create({
      name: 'Other',
      email: 'other@example.test',
      passwordHash: 'fixture',
    });
    token = app
      .get(JwtService)
      .sign({ sub: owner._id.toString(), email: foreign.email });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
    if (previousRoot === undefined) delete process.env.UPLOAD_ROOT;
    else process.env.UPLOAD_ROOT = previousRoot;
    if (temporary) {
      const absolute = resolve(temporary);
      if (
        !absolute.startsWith(`${resolve(tmpdir())}${sep}lingua-community-test-`)
      )
        throw new Error('Unsafe test cleanup root');
      await fs.rm(absolute, { recursive: true, force: true });
    }
  });

  it.each(['jpeg', 'png', 'webp'] as const)(
    'accepts decoded %s, derives extension, serves from the same root with nosniff',
    async (format) => {
      const buffer = await sharp(png).toFormat(format).toBuffer();
      const response = await upload(
        buffer,
        format === 'jpeg' ? 'UNTRUSTED.JPEG' : `UNTRUSTED.${format}`,
        `image/${format}`,
      ).expect(201);
      const extension = format === 'jpeg' ? 'jpg' : format;
      expect((response.body as { imageUrl: string }).imageUrl).toMatch(
        new RegExp(`^/uploads/community/[a-f\\d-]{36}\\.${extension}$`),
      );
      expect(response.body.userId).toBe(owner._id.toString());
      expect(images.root).toBe(resolveUploadRoot());
      const stored = await fs.readFile(
        disk((response.body as { imageUrl: string }).imageUrl),
      );
      expect((await sharp(stored).metadata()).format).toBe(format);
      const served = await request(
        app.getHttpServer() as import('node:http').Server,
      )
        .get((response.body as { imageUrl: string }).imageUrl)
        .expect(200);
      expect(served.headers['content-type']).toContain(`image/${format}`);
      expect(served.headers['x-content-type-options']).toBe('nosniff');
      expect(served.body).toEqual(stored);
    },
  );

  it.each([
    [
      Buffer.from('<html><script>alert(1)</script></html>'),
      'evil.jpg',
      'image/jpeg',
    ],
    [
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
      'evil.svg',
      'image/svg+xml',
    ],
    [Buffer.from('<?xml version="1.0"?><svg/>'), 'evil.png', 'image/png'],
    [Buffer.from('invalid binary'), 'claimed.png', 'image/png'],
    [
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]),
      'truncated.png',
      'image/png',
    ],
    [Buffer.from('GIF89a'), 'animated.gif', 'image/gif'],
  ])(
    'rejects scriptable/unknown/corrupt input %s named %s',
    async (buffer, filename, mime) => {
      await upload(buffer, filename, mime).expect(400);
      expect(await files()).toEqual([]);
      expect(await posts.countDocuments()).toBe(0);
    },
  );

  it.each([
    ['wrong.jpg', 'image/png'],
    ['wrong.png', 'image/jpeg'],
    ['evil.html', 'image/png'],
    ['evil.svg', 'image/png'],
  ])('rejects PNG with mismatched declaration %s / %s', async (name, mime) => {
    await upload(png, name, mime).expect(400);
    expect(await files()).toEqual([]);
  });

  it('user basename/path cannot control storage; original trailing content is discarded', async () => {
    const malicious = Buffer.concat([
      png,
      Buffer.from('<script>trailing-secret</script>'),
    ]);
    const normalized = await images.normalize(
      file(malicious, '../../chosen.png'),
    );
    const url = await images.store(file(malicious, '../../chosen.png'));
    expect(url).not.toContain('chosen');
    expect(url).not.toContain('..');
    expect(normalized.buffer.includes(Buffer.from('trailing-secret'))).toBe(
      false,
    );
    expect((await sharp(normalized.buffer).metadata()).format).toBe('png');
  });

  it('oversized multipart upload returns controlled 413 without a permanent/partial file', async () => {
    await upload(
      Buffer.alloc(COMMUNITY_IMAGE_LIMIT + 1),
      'large.png',
      'image/png',
    ).expect(413);
    await expect(
      images.store(file(Buffer.alloc(COMMUNITY_IMAGE_LIMIT + 1))),
    ).rejects.toThrow('5 MB');
    expect(await files()).toEqual([]);
    expect(await posts.countDocuments()).toBe(0);
  });

  it('bounds pixel processing without writing a compressed oversized canvas', async () => {
    const bomb = await sharp({
      create: { width: 4001, height: 4000, channels: 3, background: '#000' },
    })
      .png()
      .toBuffer();
    expect(4001 * 4000).toBeGreaterThan(COMMUNITY_PIXEL_LIMIT);
    expect(bomb.length).toBeLessThan(COMMUNITY_IMAGE_LIMIT);
    await upload(bomb, 'canvas.png', 'image/png').expect(400);
    expect(await files()).toEqual([]);
  });

  it.each(['missing language', 'unknown field', 'oversized text'])(
    'invalid DTO (%s) leaves no file',
    async (kind) => {
      const req = create();
      if (kind !== 'missing language') req.field('learningLanguage', 'en');
      if (kind === 'unknown field') req.field('userId', foreign._id.toString());
      if (kind === 'oversized text') req.field('text', 'x'.repeat(1001));
      await req.attach('image', png, 'client.png').expect(400);
      expect(await files()).toEqual([]);
    },
  );

  it.each(['unknown field', 'oversized text'])(
    'invalid update DTO (%s) preserves the old image without storing a new file',
    async (kind) => {
      const post = await imagePost(),
        store = jest.spyOn(images, 'store');
      const req = edit(post._id);
      if (kind === 'unknown field') req.field('userId', foreign._id.toString());
      else req.field('text', 'x'.repeat(1001));
      await req.attach('image', png, 'replacement.png').expect(400);
      expect(store).not.toHaveBeenCalled();
      expect(await files()).toHaveLength(1);
      expect((await posts.findById(post._id))!.imageUrl).toBe(post.imageUrl);
      await fs.access(disk(post.imageUrl));
    },
  );

  it('multiple files are rejected during bounded staging without a permanent upload', async () => {
    await create()
      .field('learningLanguage', 'en')
      .attach('image', png, 'first.png')
      .attach('image', png, 'second.png')
      .expect(400);
    expect(await files()).toEqual([]);
    expect(await posts.countDocuments()).toBe(0);
  });

  it('JWT is required before staging and tokenless local_guest cannot upload', async () => {
    await request(app.getHttpServer() as import('node:http').Server)
      .post('/community/posts')
      .field('learningLanguage', 'en')
      .attach('image', png, 'client.png')
      .expect(401);
    expect(await files()).toEqual([]);
  });

  it('foreign and missing posts are rejected before image storage', async () => {
    const post = await posts.create({
      userId: foreign._id.toString(),
      userName: foreign.name,
      learningLanguage: 'en',
      text: 'foreign',
    });
    const store = jest.spyOn(images, 'store');
    await edit(post._id.toString())
      .attach('image', png, 'client.png')
      .expect(403);
    await edit('507f1f77bcf86cd799439099')
      .attach('image', png, 'client.png')
      .expect(404);
    expect(store).not.toHaveBeenCalled();
    expect(await files()).toEqual([]);
  });

  it('DB create failure compensates the new file and retains the original error', async () => {
    jest.spyOn(posts.prototype, 'save').mockImplementation(async () => {
      expect(await files()).toHaveLength(1);
      throw new Error('DB create failed');
    });
    await upload(png, 'client.png', 'image/png').expect(503);
    expect(await files()).toEqual([]);
    expect(await posts.countDocuments()).toBe(0);
  });

  it('cleanup failure is logged without hiding the create failure', async () => {
    const original = new Error('Original DB failure');
    jest.spyOn(posts.prototype, 'save').mockRejectedValue(original);
    jest
      .spyOn(images, 'remove')
      .mockRejectedValue(
        Object.assign(new Error('cleanup'), { code: 'EACCES' }),
      );
    const log = jest.spyOn(telemetry, 'emit').mockImplementation(() => {});
    const service = app.get(CommunityService);
    await expect(
      service.create(
        owner._id.toString(),
        owner.name,
        'en',
        undefined,
        file(),
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(log).toHaveBeenCalledWith(
      'upload.cleanup_failed',
      expect.objectContaining({ code: 'EACCES' }),
      'warn',
    );
    expect(await files()).toHaveLength(1);
  });

  it('unavailable DB revalidation preserves the new file and the original failure', async () => {
    const original = new Error('DB save failed');
    jest.spyOn(posts.prototype, 'save').mockRejectedValue(original);
    jest.spyOn(posts, 'exists').mockImplementation(
      () =>
        ({
          exec: () => Promise.reject(new Error('DB unavailable')),
        }) as unknown as ReturnType<typeof posts.exists>,
    );
    const log = jest.spyOn(telemetry, 'emit').mockImplementation(() => {});
    const service = app.get(CommunityService);
    await expect(
      service.create(
        owner._id.toString(),
        owner.name,
        'en',
        undefined,
        file(),
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(log).toHaveBeenCalledWith(
      'upload.cleanup_failed',
      expect.objectContaining({
        failureCategory: 'reference_check_unavailable',
      }),
      'warn',
    );
    expect(await files()).toHaveLength(1);
  });

  it('partial file write failure compensates only the exclusively created new file', async () => {
    const fileSystem = fs,
      open = fileSystem.open;
    jest
      .spyOn(fileSystem, 'open')
      .mockImplementation(async (...args: Parameters<typeof fs.open>) => {
        const handle = await open(...args);
        jest.spyOn(handle, 'writeFile').mockImplementation(async () => {
          await handle.write(Buffer.from('partial'));
          throw new Error('Write failed');
        });
        return handle;
      });
    await expect(images.store(file())).rejects.toThrow('Write failed');
    expect(await files()).toEqual([]);
  });

  it('lost DB create acknowledgement preserves the image referenced by the committed post', async () => {
    const receipts = app.get(MutationReceipts);
    const execute = receipts.execute.bind(receipts) as typeof receipts.execute;
    jest
      .spyOn(receipts, 'execute')
      .mockImplementation(
        async (...args: Parameters<typeof receipts.execute>) => {
          await execute(...args);
          throw new Error('Lost committed acknowledgement');
        },
      );
    await upload(png, 'client.png', 'image/png').expect(500);
    const saved = await posts.findOne().exec();
    expect(saved).not.toBeNull();
    expect(await fs.readFile(disk(saved!.imageUrl!))).toBeDefined();
  });

  it('replacement commits the new reference before old-file deletion', async () => {
    const post = await imagePost(),
      old = post.imageUrl;
    const remove = images.remove.bind(images) as typeof images.remove;
    jest.spyOn(images, 'remove').mockImplementation(async (url) => {
      const saved = await posts.findById(post._id).exec();
      expect(saved!.imageUrl).not.toBe(old);
      await fs.access(disk(saved!.imageUrl!));
      await fs.access(disk(old));
      return remove(url);
    });
    const updated = await edit(post._id)
      .attach('image', png, 'replacement.png')
      .expect(200);
    expect((updated.body as { imageUrl: string }).imageUrl).not.toBe(old);
    await expect(fs.access(disk(old))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await files()).toHaveLength(1);
  });

  it('failed replacement preserves old DB reference and file; new file is compensated', async () => {
    const post = await imagePost();
    jest
      .spyOn(posts.prototype, 'save')
      .mockRejectedValue(new Error('Update failed'));
    await edit(post._id).attach('image', png, 'replacement.png').expect(503);
    expect((await posts.findById(post._id))!.imageUrl).toBe(post.imageUrl);
    await fs.access(disk(post.imageUrl));
    expect(await files()).toHaveLength(1);
  });

  it('lost update acknowledgement preserves the committed new reference and its file', async () => {
    const post = await imagePost();
    const receipts = app.get(MutationReceipts);
    const execute = receipts.execute.bind(receipts) as typeof receipts.execute;
    jest
      .spyOn(receipts, 'execute')
      .mockImplementation(
        async (...args: Parameters<typeof receipts.execute>) => {
          await execute(...args);
          throw new Error('Lost committed acknowledgement');
        },
      );
    await edit(post._id).attach('image', png, 'replacement.png').expect(500);
    const saved = await posts.findById(post._id);
    expect(saved!.imageUrl).not.toBe(post.imageUrl);
    await fs.access(disk(saved!.imageUrl!));
    await fs.access(disk(post.imageUrl));
    expect(await files()).toHaveLength(2);
  });

  it('old cleanup failure leaves the new live reference intact', async () => {
    const post = await imagePost();
    jest
      .spyOn(images, 'remove')
      .mockRejectedValue(
        Object.assign(new Error('cleanup'), { code: 'EACCES' }),
      );
    const updated = await edit(post._id)
      .attach('image', png, 'replacement.png')
      .expect(200);
    await fs.access(disk((updated.body as { imageUrl: string }).imageUrl));
    expect(await files()).toHaveLength(2);
    expect((await posts.findById(post._id))!.imageUrl).toBe(
      (updated.body as { imageUrl: string }).imageUrl,
    );
  });

  it('image removal persists valid text before deleting old file; empty edit retains image', async () => {
    const post = await imagePost();
    await edit(post._id).field('removeImage', 'true').expect(400);
    await fs.access(disk(post.imageUrl));
    await edit(post._id)
      .field('text', 'valid text')
      .field('removeImage', 'true')
      .expect(200);
    expect((await posts.findById(post._id))!.imageUrl).toBeUndefined();
    expect(await files()).toEqual([]);
  });

  it('delete ownership failure preserves the post and image', async () => {
    const post = await imagePost(),
      otherToken = app.get(JwtService).sign({ sub: foreign._id.toString() });
    await request(app.getHttpServer() as import('node:http').Server)
      .delete(`/community/posts/${post._id}`)
      .auth(otherToken, { type: 'bearer' })
      .set('X-Idempotency-Key', crypto.randomUUID())
      .set('X-Resource-Revision', '0')
      .expect(403);
    expect(await posts.findById(post._id)).not.toBeNull();
    await fs.access(disk(post.imageUrl));
  });

  it('failed DB deletion keeps the referenced file', async () => {
    const post = await imagePost();
    jest.spyOn(posts, 'deleteOne').mockImplementation(
      () =>
        ({
          exec: () => Promise.reject(new Error('DB deletion failed')),
        }) as unknown as ReturnType<typeof posts.deleteOne>,
    );
    await request(app.getHttpServer() as import('node:http').Server)
      .delete(`/community/posts/${post._id}`)
      .auth(token, { type: 'bearer' })
      .set('X-Idempotency-Key', crypto.randomUUID())
      .set('X-Resource-Revision', '0')
      .expect(503);
    expect(await posts.findById(post._id)).not.toBeNull();
    await fs.access(disk(post.imageUrl));
  });

  it('successful deletion removes the DB record before safely cleaning its file', async () => {
    const post = await imagePost(),
      remove = images.remove.bind(images) as typeof images.remove;
    jest.spyOn(images, 'remove').mockImplementation(async (url) => {
      expect(await posts.findById(post._id)).toBeNull();
      return remove(url);
    });
    await request(app.getHttpServer() as import('node:http').Server)
      .delete(`/community/posts/${post._id}`)
      .auth(token, { type: 'bearer' })
      .set('X-Idempotency-Key', crypto.randomUUID())
      .set('X-Resource-Revision', '0')
      .expect(200);
    expect(await files()).toEqual([]);
  });

  it('delete rechecks transaction snapshot/revision when an image changes after ownership read', async () => {
    const post = await imagePost(),
      replacement = await images.store(file());
    const deleteOne = posts.deleteOne.bind(posts);
    let changed = false;
    jest.spyOn(posts, 'deleteOne').mockImplementation((...args: any[]) => {
      const query = (deleteOne as any)(...args);
      const execute = query.exec.bind(query);
      query.exec = async () => {
        if (!changed) {
          changed = true;
          await posts.updateOne(
            { _id: post._id },
            { $set: { imageUrl: replacement, revision: 1 } },
          );
        }
        return execute();
      };
      return query;
    });
    await request(app.getHttpServer() as import('node:http').Server)
      .delete(`/community/posts/${post._id}`)
      .auth(token, { type: 'bearer' })
      .set('X-Idempotency-Key', crypto.randomUUID())
      .set('X-Resource-Revision', '0')
      .expect(409);
    expect((await posts.findById(post._id))!.imageUrl).toBe(replacement);
    await fs.access(disk(replacement));
    await fs.access(disk(post.imageUrl));
  });

  it('failed deletion cleanup preserves successful DB deletion and logs the orphan', async () => {
    const post = await imagePost();
    jest
      .spyOn(images, 'remove')
      .mockRejectedValue(
        Object.assign(new Error('cleanup'), { code: 'EACCES' }),
      );
    const log = jest.spyOn(telemetry, 'emit').mockImplementation(() => {});
    await request(app.getHttpServer() as import('node:http').Server)
      .delete(`/community/posts/${post._id}`)
      .auth(token, { type: 'bearer' })
      .set('X-Idempotency-Key', crypto.randomUUID())
      .set('X-Resource-Revision', '0')
      .expect(200);
    expect(await posts.findById(post._id)).toBeNull();
    await fs.access(disk(post.imageUrl));
    expect(log).toHaveBeenCalledWith(
      'upload.cleanup_failed',
      expect.objectContaining({ code: 'EACCES' }),
      'warn',
    );
  });

  it('unique backend guests can upload their own image, and another guest cannot replace it', async () => {
    const first = (
      await request(app.getHttpServer() as import('node:http').Server)
        .post('/auth/guest')
        .expect(201)
    ).body as { access_token: string; user: { id: string } };
    const second = (
      await request(app.getHttpServer() as import('node:http').Server)
        .post('/auth/guest')
        .expect(201)
    ).body as { access_token: string; user: { id: string } };
    const post = (
      await request(app.getHttpServer() as import('node:http').Server)
        .post('/community/posts')
        .auth(first.access_token, { type: 'bearer' })
        .set('X-Idempotency-Key', crypto.randomUUID())
        .field('learningLanguage', 'en')
        .attach('image', png, 'guest.png')
        .expect(201)
    ).body as { _id: string; userId: string; imageUrl: string };
    expect(post.userId).toBe(first.user.id);
    expect(first.user.id).not.toBe(second.user.id);
    const store = jest.spyOn(images, 'store');
    await request(app.getHttpServer() as import('node:http').Server)
      .put(`/community/posts/${post._id}`)
      .auth(second.access_token, { type: 'bearer' })
      .set('X-Idempotency-Key', crypto.randomUUID())
      .field('expectedRevision', '0')
      .attach('image', png, 'foreign.png')
      .expect(403);
    expect(store).not.toHaveBeenCalled();
    await fs.access(disk(post.imageUrl));
    expect(await files()).toHaveLength(1);
  });

  it('cleanup does not delete an image still referenced by another historical post', async () => {
    const post = await imagePost();
    await posts.create({
      userId: foreign._id.toString(),
      userName: foreign.name,
      learningLanguage: 'en',
      imageUrl: post.imageUrl,
    });
    await request(app.getHttpServer() as import('node:http').Server)
      .delete(`/community/posts/${post._id}`)
      .auth(token, { type: 'bearer' })
      .set('X-Idempotency-Key', crypto.randomUUID())
      .set('X-Resource-Revision', '0')
      .expect(200);
    await fs.access(disk(post.imageUrl));
  });

  it('cleanup refuses absolute URLs, traversal, encoded separators and outside-root paths', async () => {
    const outside = join(temporary, 'protected.png');
    await fs.writeFile(outside, png);
    for (const url of [
      outside,
      'https://other/uploads/community/post-1-1.png',
      '/uploads/community/../../protected.png',
      '/uploads/community/%2e%2e%2fprotected.png',
      '/uploads/community/..\\protected.png',
      '/uploads/other/post-1-1.png',
    ])
      await expect(images.remove(url)).rejects.toThrow();
    expect(await fs.readFile(outside)).toEqual(png);
  });

  it('directory symlink escape cannot be written, served or cleaned', async () => {
    const directory = join(uploadRoot, 'community'),
      outside = join(temporary, 'outside');
    await fs.mkdir(outside);
    await fs.mkdir(directory, { recursive: true });
    await fs.rmdir(directory);
    await fs.symlink(
      outside,
      directory,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await fs.writeFile(join(outside, 'post-1-1.png'), png);
    try {
      await expect(images.store(file())).rejects.toThrow('outside upload root');
      await expect(
        images.remove('/uploads/community/post-1-1.png'),
      ).rejects.toThrow('outside upload root');
      await request(app.getHttpServer() as import('node:http').Server)
        .get('/uploads/community/post-1-1.png')
        .expect(404);
      expect(await fs.readFile(join(outside, 'post-1-1.png'))).toEqual(png);
    } finally {
      await fs.unlink(directory);
    }
  });

  it('UUID collision retries exclusively and never overwrites or cleans the existing file', async () => {
    const fixed = '11111111-1111-4111-8111-111111111111',
      other = '22222222-2222-4222-8222-222222222222';
    const id = jest.spyOn(crypto, 'randomUUID').mockReturnValue(fixed);
    const existing = await images.store(file());
    const bytes = await fs.readFile(disk(existing));
    id.mockReturnValueOnce(fixed).mockReturnValue(other);
    const fresh = await images.store(file());
    expect(fresh).toContain(other);
    expect(await fs.readFile(disk(existing))).toEqual(bytes);
    id.mockReturnValue(fixed);
    await expect(images.store(file())).rejects.toThrow(
      'allocate image filename',
    );
    expect(await fs.readFile(disk(existing))).toEqual(bytes);
  });

  it('upload root resolves absolute, relative and default configuration independently of module location', () => {
    try {
      delete process.env.UPLOAD_ROOT;
      expect(resolveUploadRoot()).toBe(resolve(process.cwd(), 'uploads'));
      process.env.UPLOAD_ROOT = 'relative-test-uploads';
      expect(resolveUploadRoot()).toBe(
        resolve(process.cwd(), 'relative-test-uploads'),
      );
      process.env.UPLOAD_ROOT = uploadRoot;
      expect(new CommunityImageStorage().root).toBe(resolve(uploadRoot));
      // The DI instance keeps the same root for serving and lifecycle work even
      // if the environment changes after startup. No directories are created.
      process.env.UPLOAD_ROOT = join(temporary, 'changed-after-startup');
      expect(images.root).toBe(resolve(uploadRoot));
    } finally {
      process.env.UPLOAD_ROOT = uploadRoot;
    }
  });

  it('static serving rejects legacy scriptable files and revalidates changed raster files', async () => {
    await fs.mkdir(join(uploadRoot, 'community'), { recursive: true });
    for (const name of ['post-1-1.html', 'post-1-1.svg', 'post-1-1.jpg']) {
      await fs.writeFile(
        join(uploadRoot, 'community', name),
        '<html><script>unsafe</script></html>',
      );
      await request(app.getHttpServer() as import('node:http').Server)
        .get(`/uploads/community/${name}`)
        .expect(404);
    }
    const post = await imagePost();
    await request(app.getHttpServer() as import('node:http').Server)
      .get(post.imageUrl)
      .expect(200);
    await fs.writeFile(disk(post.imageUrl), 'corrupt after verification');
    await request(app.getHttpServer() as import('node:http').Server)
      .get(post.imageUrl)
      .expect(404);
  });

  it('runtime rule ignores prospective uploads and none remain tracked in the index', () => {
    const repository = resolve(process.cwd(), '..');
    const ignored = execFileSync(
      'git',
      [
        'check-ignore',
        '--no-index',
        'lingua_ai_backend/uploads/community/runtime-test.png',
      ],
      { cwd: repository, encoding: 'utf8' },
    );
    expect(ignored.trim()).toBe(
      'lingua_ai_backend/uploads/community/runtime-test.png',
    );
    expect(
      execFileSync('git', ['ls-files', 'lingua_ai_backend/uploads'], {
        cwd: repository,
        encoding: 'utf8',
      }).trim(),
    ).toBe('');
    // No runtime file is generated in the repository by this check.
  });
});
