import { UnitTimelineModule } from '../../test/timeline-fixture';
import { PUBLIC_WRITER_INVENTORY } from './protocol-contract';
import { MutationTimeline } from '../operations/mutation-timeline';
import { unitTimeline, TEST_TIMELINE } from '../../test/timeline-fixture';
import { Body, Controller, Get, Post, RequestMethod } from '@nestjs/common';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { SecurityModule } from '../security/security.module';
import { HttpSecurity } from '../security/http-security';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FlashcardsController } from '../flashcards/flashcards.controller';
import { FlashcardsService } from '../flashcards/flashcards.service';
import { FlashcardIdempotencyService } from '../flashcards/flashcard-idempotency.service';
import { AppController } from '../app.controller';
import { AuthController } from '../auth/auth.controller';
import { UsersController } from '../users/users.controller';
import { LessonsController } from '../lessons/lessons.controller';
import { ProgressController } from '../progress/progress.controller';
import { CommunityController } from '../community/community.controller';
import { CommunityObjectController } from '../community/community-object.controller';
import { AiCoachController } from '../ai-coach/ai-coach.controller';
import { PronunciationController } from '../pronunciation/pronunciation.controller';
import { HealthController } from '../operations/health.controller';
import { CompatibilityController } from './compatibility.controller';
import {
  CURRENT_CLIENT_PROTOCOL,
  PROTOCOL_ROUTES,
  protocolRoute,
} from './protocol-contract';
import { validateEnvironment } from '../config/runtime-config';

const owner = '507f1f77bcf86cd799439011';
@Controller('progress')
class ProgressProbe {
  @Post(':userId/complete-lesson')
  complete(@Body() body: unknown) {
    return { accepted: true, body };
  }
  @Get(':userId')
  read() {
    return { readable: true };
  }
}
@Controller('auth')
class AuthProbe {
  @Post('login')
  login() {
    return { usable: true };
  }
}

// Actual HTTP boundary, guards, public error filter and real flashcard controller.
// No DB/provider is imported or connected by this fixture.
describe('client protocol HTTP contract', () => {
  let app: INestApplication<Server>;
  let config: ConfigService;
  const calls: string[] = [];
  const receipts = new Map<string, object>();
  const execute = jest.fn(
    (userId: string, key: string | undefined, type: string) => {
      calls.push(userId);
      const identity = `${userId}:${type}:${key}`;
      if (!key) return Promise.resolve({ _id: 'legacy' });
      if (!receipts.has(identity))
        receipts.set(identity, { _id: 'keyed-result' });
      return Promise.resolve(receipts.get(identity));
    },
  );
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              CLIENT_PROTOCOL_POLICY: 'ALLOW_LEGACY',
              CORS_ORIGINS: 'https://app.example.invalid',
              RELEASE_BUILD_ID: 'ci-fixture.1',
              TRUST_PROXY: 'false',
            }),
          ],
        }),
        SecurityModule,
        UnitTimelineModule,
      ],
      controllers: [ProgressProbe, AuthProbe, FlashcardsController],
      providers: [
        { provide: MutationTimeline, useValue: unitTimeline },
        {
          provide: FlashcardsService,
          useValue: { getAllCards: () => [], getDueCards: () => [] },
        },
        { provide: FlashcardIdempotencyService, useValue: { execute } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: {
          switchToHttp(): { getRequest(): { user: object } };
        }) {
          context.switchToHttp().getRequest().user = { _id: owner };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useLogger(false);
    config = app.get(ConfigService);
    app
      .get(HttpSecurity)
      .install(app as Parameters<HttpSecurity['install']>[0]);
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    config.set('CLIENT_PROTOCOL_POLICY', 'ENFORCE_MUTATIONS');
  });

  test('migration/reporting stage accepts absent legacy protocol; enforcement is explicit', async () => {
    config.set('CLIENT_PROTOCOL_POLICY', 'ALLOW_LEGACY');
    await request(app.getHttpServer())
      .post(`/progress/${owner}/complete-lesson`)
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post('/flashcards')
      .send({
        targetWord: 'word',
        turkishTranslation: 'translation',
        targetLanguage: 'en',
      })
      .expect(201);
  });
  test('current protocol is accepted without changing authoritative owner identity', async () => {
    await request(app.getHttpServer())
      .post('/flashcards')
      .set('X-Client-Protocol', String(CURRENT_CLIENT_PROTOCOL))
      .set('X-Data-Timeline', TEST_TIMELINE)
      .set('X-Idempotency-Key', 'stable-create')
      .send({
        targetWord: 'word',
        turkishTranslation: 'translation',
        targetLanguage: 'en',
      })
      .expect(201);
    expect(calls.at(-1)).toBe(owner);
  });
  test.each([
    undefined,
    '0',
    '1',
    '01',
    '-1',
    '1.0',
    '1, 1',
    '9999999',
    'internal-sensitive-value',
  ])(
    'rejects unsupported/missing mutation protocol %s with a safe non-401 contract',
    async (raw) => {
      let call = request(app.getHttpServer()).post(
        `/progress/${owner}/complete-lesson`,
      );
      if (raw !== undefined) call = call.set('X-Client-Protocol', raw);
      const response = await call.send({}).expect(426);
      expect(response.body).toEqual({
        statusCode: 426,
        code:
          raw === undefined
            ? 'CLIENT_PROTOCOL_REQUIRED'
            : 'CLIENT_PROTOCOL_UNSUPPORTED',
        message: 'Client update or pending-work reconciliation is required.',
        updateRequired: true,
        currentProtocolRevision: CURRENT_CLIENT_PROTOCOL,
        minimumMutationRevision: CURRENT_CLIENT_PROTOCOL,
        timelineAwareProtocolRevision: 2,
        policy: 'ENFORCE_MUTATIONS',
        buildId: 'ci-fixture.1',
      });
      expect(JSON.stringify(response.body)).not.toContain(
        'internal-sensitive-value',
      );
    },
  );
  test('unsupported declared generations fail safely even during legacy rollout', async () => {
    config.set('CLIENT_PROTOCOL_POLICY', 'ALLOW_LEGACY');
    await request(app.getHttpServer())
      .post(`/progress/${owner}/complete-lesson`)
      .set('X-Client-Protocol', '3')
      .send({})
      .expect(426);
  });
  test('read, auth and cheap no-store discovery remain usable', async () => {
    await request(app.getHttpServer())
      .get(`/progress/${owner}`)
      .set('X-Client-Protocol', '999')
      .expect(200);
    await request(app.getHttpServer()).post('/auth/login').send({}).expect(201);
    const response = await request(app.getHttpServer())
      .get('/compatibility')
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      currentProtocolRevision: CURRENT_CLIENT_PROTOCOL,
      minimumMutationRevision: CURRENT_CLIENT_PROTOCOL,
      timelineAwareProtocolRevision: 2,
      policy: 'ENFORCE_MUTATIONS',
      buildId: 'ci-fixture.1',
      dataTimelineId: null,
      timelineWriteState: 'UNAVAILABLE',
    });
  });
  test('CORS permits protocol alongside existing authorization and mutation headers', async () => {
    const response = await request(app.getHttpServer())
      .options('/flashcards')
      .set('Origin', 'https://app.example.invalid')
      .set('Access-Control-Request-Method', 'POST')
      .set(
        'Access-Control-Request-Headers',
        'x-client-protocol,authorization,x-idempotency-key',
      )
      .expect(204);
    expect(
      String(response.headers['access-control-allow-headers']).toLowerCase(),
    ).toContain('x-client-protocol');
    expect(
      String(response.headers['access-control-allow-headers']).toLowerCase(),
    ).toContain('x-idempotency-key');
  });
  test.each(['ALLOW_LEGACY', 'ENFORCE_MUTATIONS'])(
    'all four declared-current flashcard mutations require keys under %s',
    async (policy) => {
      config.set('CLIENT_PROTOCOL_POLICY', policy);
      for (const [method, path] of [
        ['post', '/flashcards'],
        ['put', '/flashcards/card'],
        ['put', '/flashcards/card/review'],
        ['delete', '/flashcards/card'],
      ] as const) {
        const response = await request(app.getHttpServer())
          [method](path)
          .set('X-Client-Protocol', String(CURRENT_CLIENT_PROTOCOL))
          .set('X-Data-Timeline', TEST_TIMELINE)
          .send({})
          .expect(400);
        expect((response.body as Record<string, unknown>).code).toBe(
          'INVALID_OPERATION_ID',
        );
      }
    },
  );
  test('keyed retries reach the same owner/type/key receipt contract', async () => {
    const size = receipts.size;
    for (let i = 0; i < 2; i++)
      await request(app.getHttpServer())
        .put('/flashcards/card/review')
        .set('X-Client-Protocol', String(CURRENT_CLIENT_PROTOCOL))
        .set('X-Data-Timeline', TEST_TIMELINE)
        .set('X-Idempotency-Key', 'stable-review')
        .send({ score: 4 })
        .expect(200, { _id: 'keyed-result' });
    expect(receipts.size).toBe(size + 1);
    expect(execute.mock.calls.at(-1)?.slice(0, 3)).toEqual([
      owner,
      'stable-review',
      'review-flashcard',
    ]);
  });
  test('production policy has no implicit default and build identity is bounded', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'production' })).toThrow(
      'CLIENT_PROTOCOL_POLICY',
    );
    expect(() =>
      validateEnvironment({ CLIENT_PROTOCOL_POLICY: 'guess' }),
    ).toThrow('CLIENT_PROTOCOL_POLICY');
    expect(() =>
      validateEnvironment({ RELEASE_BUILD_ID: '../private' }),
    ).toThrow('RELEASE_BUILD_ID');
  });
});

test('every current controller route has an explicit protocol classification', () => {
  const controllers = [
    AppController,
    AuthController,
    UsersController,
    LessonsController,
    ProgressController,
    FlashcardsController,
    CommunityController,
    CommunityObjectController,
    AiCoachController,
    PronunciationController,
    HealthController,
    CompatibilityController,
  ];
  const src = resolve(__dirname, '..');
  const controllerFiles = readdirSync(src, { recursive: true }).filter((name) =>
    String(name).endsWith('.controller.ts'),
  );
  expect(controllerFiles).toHaveLength(controllers.length);
  const actual = new Set<string>();
  for (const controller of controllers) {
    const prefix = Reflect.getMetadata(PATH_METADATA, controller) as string;
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const descriptor = Object.getOwnPropertyDescriptor(
        controller.prototype,
        name,
      );
      const handler = descriptor?.value as object | undefined;
      if (!handler || typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as
        | RequestMethod
        | undefined;
      if (method === undefined) continue;
      const suffix = Reflect.getMetadata(PATH_METADATA, handler) as string;
      const path =
        `/${prefix}/${suffix}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
      actual.add(`${RequestMethod[method]} ${path}`);
    }
  }
  expect([...actual].sort()).toEqual(
    PROTOCOL_ROUTES.map((row) => `${row[0]} ${row[1]}`).sort(),
  );
  expect(
    [...actual].filter((route) => !/^(GET|HEAD|OPTIONS) /.test(route)).sort(),
  ).toEqual(PUBLIC_WRITER_INVENTORY.map((row) => `${row[0]} ${row[1]}`).sort());
  for (const [method, path, classification] of PUBLIC_WRITER_INVENTORY) {
    if (classification === 'FENCED')
      expect(protocolRoute(method, path)).toBe(
        'PROTOCOL_REQUIRED_WHEN_ENFORCED',
      );
  }
  expect(protocolRoute('POST', '/new-unclassified-writer')).toBe(
    'PROTOCOL_REQUIRED_WHEN_ENFORCED',
  );
});
