import {
  Body,
  Controller,
  Get,
  HttpException,
  Injectable,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import request from 'supertest';
import { SecurityModule } from '../security/security.module';
import { HttpSecurity } from '../security/http-security';
import { AbuseControls } from '../security/abuse-controls';
import { AbusePolicy, rule } from '../security/abuse-policy';
import { CommunityImageStorage } from '../community/community-image.storage';
import { HealthController } from './health.controller';
import { ReadinessService } from './readiness.service';
import { TrafficLifecycle } from './traffic-lifecycle.service';
import {
  OperationalTelemetry,
  telemetry,
  receiptEvent,
  StructuredNestLogger,
} from './telemetry';
import { observedTransaction } from './observed-transaction';
import * as probes from './readiness-probes';
import { ProviderFailure } from './provider-client';

const marker = randomUUID();
@Injectable()
class OwnerFixture {
  canActivate(context: any) {
    context.switchToHttp().getRequest().user = {
      _id: '000000000000000000000001',
      isGuest: true,
    };
    return true;
  }
}
@Controller('observed')
class DiagnosticFixture {
  @Post(':id') @UseGuards(OwnerFixture) post(@Body() _body: unknown) {
    receiptEvent(
      'receipt.replay',
      'community-create',
      '000000000000000000000001',
      marker,
    );
    return { ok: true };
  }
  @Get('failure') fail() {
    throw new Error(`raw-body-password-${marker} /private/${marker}`);
  }
  @Get('timeout') timeout() {
    throw new ProviderFailure('PROVIDER_TIMEOUT', true);
  }
  @Get('config') config() {
    throw new ProviderFailure('PROVIDER_CONFIGURATION', false);
  }
  @Get('rate') rate() {
    throw new ProviderFailure('PROVIDER_RATE_LIMITED', true, 5);
  }
  @Post('auth/login') @AbusePolicy('login') login() {
    return { ok: true };
  }
}

describe('8D structured operational diagnostics', () => {
  let rows: any[], local: OperationalTelemetry;
  beforeEach(() => {
    rows = [];
    local = new OperationalTelemetry((line) => rows.push(JSON.parse(line)));
    jest
      .spyOn(telemetry, 'emit')
      .mockImplementation((event, fields, level, quiet) => {
        const context = telemetry.context.getStore();
        if (context)
          local.context.run(context, () =>
            local.emit(event, fields, level, quiet),
          );
        else local.emit(event, fields, level, quiet);
      });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  test('central redaction removes known secrets, Mongo URIs, bearer/JWT, key/password/cookie values', () => {
    const secret = `private-${randomUUID()}`;
    const uri = `mongodb://${'synthetic-user'}:${secret}@db.example.invalid/private`;
    const jwt = `eyJhbGciOiJIUzI1NiJ9.${'a'.repeat(24)}.${'b'.repeat(40)}`;
    const apiKey = 'AIza' + 'A'.repeat(35);
    local.configure(new ConfigService({ JWT_SECRET: secret }));
    local.emit('diagnostic.test', {
      message: `${secret} ${uri} Bearer ${jwt} ${apiKey} password="${marker}" Cookie=${marker}`,
    });
    const text = JSON.stringify(rows);
    for (const value of [secret, uri, jwt, apiKey, marker])
      expect(text).not.toContain(value);
    expect(text).toContain('REDACTED');
    expect(rows[0]).toMatchObject({
      event: 'diagnostic.test',
      level: 'info',
      timestamp: expect.any(String),
    });
    local.emit('diagnostic.test', { message: 'transaction_probe_failed' });
    expect(rows[1].message).toBe('transaction_probe_failed');
  });
  test('log fields/length and counter cardinality are bounded; object dumps are excluded', () => {
    local.emit('diagnostic.test', {
      message: 'x'.repeat(100000),
      route: 'y'.repeat(100000),
      password: marker,
      body: marker,
      requestId: '\nforged-log',
    });
    expect(JSON.stringify(rows[0]).length).toBeLessThan(1400);
    expect(rows[0]).not.toHaveProperty('password');
    expect(rows[0]).not.toHaveProperty('body');
    expect(rows[0].requestId).not.toContain('\n');
    for (let n = 0; n < 200; n++) local.count(`test.${'a'.repeat(n + 1)}`);
    expect(Object.keys(local.snapshotCounters()).length).toBeLessThanOrEqual(
      100,
    );
    const logger = new StructuredNestLogger();
    logger.error(new Error(marker));
    expect(JSON.stringify(rows)).not.toContain(marker);
  });
  test('receipt events contain only operation/owner fingerprints, never raw stored results', () => {
    receiptEvent('receipt.replay', 'ai-send', 'raw-owner-id', marker);
    receiptEvent('receipt.conflict', 'ai-send', 'raw-owner-id', marker);
    receiptEvent('receipt.created', 'ai-send', 'raw-owner-id', marker);
    expect(rows.map((row) => row.event)).toEqual([
      'receipt.replay',
      'receipt.conflict',
      'receipt.created',
    ]);
    expect(JSON.stringify(rows)).not.toMatch(
      new RegExp(`${marker}|raw-owner-id`),
    );
    expect(rows[0].operationFingerprint).toMatch(/^[a-f0-9]{16}$/);
  });
  test('transaction callback retry/final failure is observed without adding retry loops or logging errors', async () => {
    const work = jest.fn(async () => 'ok');
    const session = {
      withTransaction: async (callback: any) => {
        await callback(session);
        return callback(session);
      },
    };
    await expect(
      observedTransaction(session as any, 'fixture', work),
    ).resolves.toBe('ok');
    expect(work).toHaveBeenCalledTimes(2);
    expect(
      rows.filter((row) => row.event === 'transaction.retry'),
    ).toHaveLength(1);
    const error = new Error(marker);
    await expect(
      observedTransaction(
        {
          withTransaction: async () => {
            throw error;
          },
        } as any,
        'fixture',
        work,
      ),
    ).rejects.toBe(error);
    expect(
      rows.find((row) => row.event === 'transaction.failed'),
    ).toMatchObject({ failureCategory: 'database_failure' });
    expect(JSON.stringify(rows)).not.toContain(marker);
  });
  test('upload cleanup failure keeps best-effort semantics and logs no filename/path', async () => {
    const storage = new CommunityImageStorage();
    jest
      .spyOn(storage, 'remove')
      .mockRejectedValue(new Error(`/private/${marker}`));
    await expect(
      storage.cleanup(`/uploads/${marker}`, 'delete'),
    ).resolves.toBeUndefined();
    expect(rows).toContainEqual(
      expect.objectContaining({
        event: 'upload.cleanup_failed',
        failureCategory: 'filesystem_or_containment',
      }),
    );
    expect(JSON.stringify(rows)).not.toContain(marker);
  });
  test('readiness transitions log only actual changes, including reconnect and shutdown', async () => {
    const connection = Object.assign(new EventEmitter(), { readyState: 1 });
    jest.spyOn(probes, 'runReadinessProbes').mockResolvedValue({
      checks: {
        database: 'ok',
        transactions: 'ok',
        indexes: 'ok',
        uploads: 'ok',
      },
      diagnostics: [],
    });
    const service = new ReadinessService(
      connection as any,
      new ConfigService({ NODE_ENV: 'test' }),
      { root: '/disposable-fixture' } as any,
    );
    try {
      await service.onApplicationBootstrap();
      await service.refresh();
      service.snapshot();
      connection.readyState = 0;
      connection.emit('disconnected');
      connection.emit('disconnected');
      service.snapshot();
      connection.readyState = 1;
      connection.emit('connected');
      await service.refresh();
      service.stop();
      service.stop();
      service.snapshot();
      expect(
        rows
          .filter((row) => row.event === 'readiness.transition')
          .map((row) => row.to),
      ).toEqual(['ready', 'not_ready', 'ready', 'shutting_down']);
      expect(JSON.stringify(rows)).not.toContain('/disposable-fixture');
    } finally {
      service.stop();
    }
  });
  test('shutdown drain/watchdog diagnostics coalesce and remain bounded', async () => {
    jest.useFakeTimers();
    const readiness = {
      stop: jest.fn(),
      snapshot: () => ({ status: 'ready' }),
    };
    const lifecycle = new TrafficLifecycle(
      readiness as any,
      new ConfigService({ SHUTDOWN_GRACE_MS: 1000 }),
    );
    const server = {
      closeIdleConnections: jest.fn(),
      closeAllConnections: jest.fn(),
    };
    const hardExit = jest.fn();
    lifecycle.attach(
      {
        getHttpServer: () => server,
        use: () => {},
        useGlobalInterceptors: () => {},
        close: async () => {},
      } as any,
      hardExit,
    );
    lifecycle.middleware(
      { path: '/work' } as any,
      new EventEmitter() as any,
      () => {},
    );
    const first = lifecycle.beginShutdown();
    expect(lifecycle.beginShutdown()).toBe(first);
    await jest.advanceTimersByTimeAsync(800);
    await first;
    await jest.advanceTimersByTimeAsync(200);
    for (const event of [
      'shutdown.requested',
      'shutdown.drain_started',
      'shutdown.drain_timeout',
      'shutdown.drain_completed',
      'shutdown.watchdog',
    ])
      expect(rows.filter((row) => row.event === event)).toHaveLength(1);
    expect(hardExit).toHaveBeenCalledTimes(1);
    expect(readiness.stop).toHaveBeenCalledTimes(1);
  });

  describe('real HTTP request correlation and completion', () => {
    let app: NestExpressApplication;
    beforeEach(async () => {
      const module = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
          SecurityModule,
        ],
        controllers: [DiagnosticFixture, HealthController],
        providers: [
          OwnerFixture,
          {
            provide: ReadinessService,
            useValue: { snapshot: () => ({ status: 'ready', checks: {} }) },
          },
        ],
      })
        .overrideProvider(ConfigService)
        .useValue(
          new ConfigService({
            NODE_ENV: 'production',
            JWT_SECRET: marker,
            CORS_ORIGINS: 'https://app.example.invalid',
            TRUST_PROXY: 'false',
          }),
        )
        .compile();
      local.configure(new ConfigService({ JWT_SECRET: marker }));
      app = module.createNestApplication<NestExpressApplication>({
        bodyParser: false,
      });
      app.useLogger(false);
      app.get(HttpSecurity).install(app);
      app.get(HttpSecurity).installBodyParsers(app);
      await app.init();
    });
    afterEach(async () => {
      await app?.close();
    });
    test.each([
      undefined,
      'safe-client-request_123',
      'bad value',
      'x'.repeat(2000),
      marker,
    ])('request ID handling %# and one safe completion event', async (id) => {
      const rawPrompt = 'PRIVATE_PROMPT_' + randomUUID();
      const call = request(app.getHttpServer())
        .post(`/observed/${marker}`)
        .query({ token: marker })
        .set('Authorization', `Bearer ${marker}`)
        .set('X-Idempotency-Key', marker)
        .send({ prompt: rawPrompt });
      if (id) call.set('X-Request-ID', id);
      const response = await call.expect(201);
      const assigned = response.headers['x-request-id'];
      expect(assigned).toMatch(/^[A-Za-z0-9_.:-]{1,64}$/);
      if (id === 'safe-client-request_123') expect(assigned).toBe(id);
      else expect(assigned).not.toBe(id);
      const completed = rows.filter((row) => row.event === 'http.completed');
      expect(completed).toHaveLength(1);
      expect(completed[0]).toMatchObject({
        requestId: assigned,
        statusCode: 201,
        durationMs: expect.any(Number),
        method: 'POST',
        route: '/observed/:id',
        ownerType: 'backend_guest',
      });
      expect(completed[0].ownerFingerprint).toMatch(/^[a-f0-9]{16}$/);
      expect(JSON.stringify(rows)).not.toContain(marker);
      expect(JSON.stringify(rows)).not.toContain(rawPrompt);
      expect(JSON.stringify(rows)).not.toContain('000000000000000000000001');
      expect(rows.find((row) => row.event === 'receipt.replay').requestId).toBe(
        assigned,
      );
    });
    test('unknown errors retain correlation server-side while redacting client and logs', async () => {
      const response = await request(app.getHttpServer())
        .get('/observed/failure')
        .set('X-Request-ID', 'known-safe-id')
        .expect(500);
      expect(response.body.code).toBe('INTERNAL_SERVER_ERROR');
      expect(rows.find((row) => row.event === 'http.failed')).toMatchObject({
        requestId: 'known-safe-id',
        failureCategory: 'unexpected_failure',
        route: '/observed/failure',
      });
      expect(rows.find(row => row.event === 'http.failed').stack).toContain('DiagnosticFixture.fail');
      expect(
        JSON.stringify(rows) + JSON.stringify(response.body),
      ).not.toContain(marker);
      expect(JSON.stringify(rows)).not.toContain('/private');
    });
    test('rate-limit rejection and completion share correlation without exposing IP buckets', async () => {
      for (let n = 0; n < 10; n++)
        await request(app.getHttpServer())
          .post('/observed/auth/login')
          .expect(201);
      await request(app.getHttpServer())
        .post('/observed/auth/login')
        .set('X-Request-ID', 'limited-request')
        .expect(429);
      expect(
        rows.find((row) => row.event === 'rate_limit.rejected'),
      ).toMatchObject({
        requestId: 'limited-request',
        scope: 'ip',
        policy: 'login-ip',
      });
      expect(
        rows.find(
          (row) =>
            row.event === 'http.completed' &&
            row.requestId === 'limited-request',
        ),
      ).toMatchObject({ rateLimited: true, statusCode: 429 });
      expect(JSON.stringify(rows)).not.toContain('127.0.0.1');
    });
    test('health completion noise is suppressed; correlation remains available', async () => {
      const response = await request(app.getHttpServer())
        .get('/health/live')
        .expect(200);
      expect(response.headers['x-request-id']).toBeDefined();
      expect(rows.filter((row) => row.event === 'http.completed')).toHaveLength(
        0,
      );
    });
    test.each([
      ['timeout', 'PROVIDER_TIMEOUT', 503],
      ['config', 'PROVIDER_CONFIGURATION', 503],
      ['rate', 'PROVIDER_RATE_LIMITED', 503],
    ])('safe provider %s contract', async (route, code, status) => {
      const response = await request(app.getHttpServer())
        .get(`/observed/${route}`)
        .expect(status);
      expect(response.body.code).toBe(code);
      if (route === 'rate') expect(response.headers['retry-after']).toBe('5');
    });
    test('oversized input logs type/size bucket, not content', async () => {
      await request(app.getHttpServer())
        .post('/observed/input')
        .send({ prompt: marker.repeat(2000) })
        .expect(413);
      expect(rows.find((row) => row.event === 'input.rejected')).toMatchObject({
        inputType: 'json',
        inputBucket: 'over_32k',
        failureCategory: 'oversized',
      });
      expect(JSON.stringify(rows)).not.toContain(marker);
    });
  });
});
