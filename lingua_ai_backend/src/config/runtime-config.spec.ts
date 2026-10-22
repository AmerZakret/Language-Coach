import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ConfigService } from '@nestjs/config';
import { mongo } from 'mongoose';
import { AiCoachService } from '../ai-coach/ai-coach.service';
import { AiContextService } from '../flashcards/services/ai-context.service';
import { PronunciationService } from '../pronunciation/pronunciation.service';
import {
  corsOptions,
  safeConfigSummary,
  validateEnvironment,
} from './runtime-config';

function production(overrides: Record<string, unknown> = {}) {
  return {
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb://db.example.invalid/language',
    JWT_SECRET: randomBytes(48).toString('base64'),
    PORT: '3000',
    CORS_ORIGINS: 'https://app.example.invalid',
    UPLOAD_ROOT: resolve('persistent-uploads'),
    AI_ENABLED: 'false',
    PRONUNCIATION_ENABLED: 'false',
    ...overrides,
  };
}

describe('Phase 8A production configuration (no external services)', () => {
  test.each([
    ['MONGODB_URI', undefined],
    ['MONGODB_URI', ''],
    ['MONGODB_URI', 'https://db.example.invalid'],
    ['MONGODB_URI', 'mongodb://'],
    ['MONGODB_URI', 'mongodb://localhost/db'],
    ['MONGODB_URI', 'mongodb://127.0.0.1/db'],
    ['MONGODB_URI', 'mongodb://[::1]/db'],
    ['MONGODB_URI', 'mongodb://[0:0:0:0:0:0:0:1]/db'],
    ['MONGODB_URI', 'mongodb+srv://localhost/db'],
    ['JWT_SECRET', undefined],
    ['JWT_SECRET', '   '],
    ['JWT_SECRET', 'secret'],
    ['JWT_SECRET', 'your_jwt_secret_key_here'],
    ['JWT_SECRET', 'super-secret-development-fallback-value'],
    ['JWT_SECRET', 'a'.repeat(64)],
    ['JWT_SECRET', '1234567890'.repeat(8)],
    ['JWT_SECRET', '0123456789abcdef'.repeat(4)],
    ['JWT_SECRET', 'abcdefghijklmnopqrstuvwxyzabcdefghijk'],
    ['PORT', '0'],
    ['PORT', '65536'],
    ['PORT', '3000garbage'],
    ['PORT', ''],
    ['NODE_ENV', 'prod'],
    ['AI_ENABLED', undefined],
    ['AI_ENABLED', 'yes'],
    ['PRONUNCIATION_ENABLED', undefined],
    ['CORS_ORIGINS', undefined],
    ['CORS_ORIGINS', '*'],
    ['CORS_ORIGINS', 'https://*.example.invalid'],
    ['CORS_ORIGINS', 'https://app.example.invalid/path'],
    ['CORS_ORIGINS', 'http://localhost:5173'],
    ['CORS_ORIGINS', 'not-an-origin'],
    ['UPLOAD_ROOT', undefined],
    ['UPLOAD_ROOT', ' '],
    ['UPLOAD_ROOT', 'relative/uploads'],
    ['UPLOAD_ROOT', resolve('dist/uploads')],
    ['UPLOAD_ROOT', resolve('build/uploads')],
  ])('rejects unsafe %s configuration %#', (field, value) => {
    expect(() => validateEnvironment(production({ [field]: value }))).toThrow(
      field,
    );
  });
  test('Mongo parser and validation never connect', () => {
    const connect = jest.spyOn(mongo.MongoClient.prototype, 'connect');
    try {
      expect(validateEnvironment(production()).NODE_ENV).toBe('production');
      expect(connect).not.toHaveBeenCalled();
    } finally {
      connect.mockRestore();
    }
  });
  test('explicit self-hosted overrides permit configured local dependencies', () => {
    const env = production({
      MONGODB_URI: 'mongodb://127.0.0.1/db',
      ALLOW_LOCAL_MONGODB: 'true',
      CORS_ORIGINS: 'http://localhost:5173',
      ALLOW_LOCAL_ORIGINS: 'true',
      PRONUNCIATION_ENABLED: 'true',
      PRONUNCIATION_SERVICE_URL: 'http://localhost:8001',
      ALLOW_LOCAL_PRONUNCIATION: 'true',
    });
    expect(validateEnvironment(env).PRONUNCIATION_ENABLED).toBe(true);
  });
  test('explicit dependency flags control configuration requirements', () => {
    expect(() =>
      validateEnvironment(production({ AI_ENABLED: 'true' })),
    ).toThrow('GEMINI_API_KEY');
    expect(() =>
      validateEnvironment(
        production({
          AI_ENABLED: 'true',
          GEMINI_API_KEY: 'your_gemini_api_key_here',
        }),
      ),
    ).toThrow('GEMINI_API_KEY');
    expect(validateEnvironment(production()).AI_ENABLED).toBe(false);
    expect(() =>
      validateEnvironment(production({ PRONUNCIATION_ENABLED: 'true' })),
    ).toThrow('PRONUNCIATION_SERVICE_URL');
    expect(() =>
      validateEnvironment(
        production({
          PRONUNCIATION_ENABLED: 'true',
          PRONUNCIATION_SERVICE_URL: 'http://localhost:8001',
        }),
      ),
    ).toThrow('PRONUNCIATION_SERVICE_URL');
    expect(
      validateEnvironment(
        production({
          PRONUNCIATION_ENABLED: 'true',
          PRONUNCIATION_SERVICE_URL: 'http://whisper.internal:8001',
        }),
      ).PRONUNCIATION_ENABLED,
    ).toBe(true);
    expect(
      validateEnvironment(
        production({
          AI_ENABLED: 'true',
          GEMINI_API_KEY: randomBytes(32).toString('hex'),
        }),
      ).AI_ENABLED,
    ).toBe(true);
  });
  test('development retains local defaults', () => {
    const env = validateEnvironment({
      MONGODB_URI: 'mongodb://localhost/dev',
      JWT_SECRET: 'test-only',
    });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.PRONUNCIATION_SERVICE_URL).toBe('http://localhost:8001');
  });
  test('origins are normalized; native no-Origin and explicit origins are allowed', () => {
    const config = validateEnvironment(
      production({
        CORS_ORIGINS:
          ' https://APP.example.invalid/ , https://app.example.invalid, https://admin.example.invalid ',
      }),
    );
    expect(config.CORS_ORIGINS).toBe(
      'https://app.example.invalid,https://admin.example.invalid',
    );
    const options = corsOptions(new ConfigService(config));
    expect(options.credentials).toBe(false);
    const origin = options.origin as (
      value: string | undefined,
      done: (error: Error | null, allowed: boolean) => void,
    ) => void;
    for (const value of [undefined, 'https://app.example.invalid']) {
      const done = jest.fn();
      origin(value, done);
      expect(done).toHaveBeenCalledWith(null, true);
    }
    const denied = jest.fn();
    origin('https://other.example.invalid', denied);
    expect(denied).toHaveBeenCalledWith(null, false);
  });
  test('validation errors and summary contain no secret values', () => {
    const markers = [
      randomBytes(30).toString('hex'),
      randomBytes(30).toString('hex'),
      randomBytes(30).toString('hex'),
    ];
    const env = production({
      MONGODB_URI: `mongodb://${markers[0]}@db.example.invalid/db`,
      JWT_SECRET: markers[1],
      GEMINI_API_KEY: markers[2],
    });
    const summary = JSON.stringify(
      safeConfigSummary(new ConfigService(validateEnvironment(env))),
    );
    const messages: string[] = [];
    for (const [key, value] of [
      ['MONGODB_URI', `invalid://${markers[0]}`],
      ['JWT_SECRET', `secret-${markers[1]}`],
      ['CORS_ORIGINS', `https://${markers[2]}@app.example.invalid`],
    ]) {
      try {
        validateEnvironment({ ...env, [key]: value });
      } catch (error) {
        messages.push(error.message);
      }
    }
    expect(messages).toHaveLength(3);
    for (const marker of markers)
      expect(summary + messages.join()).not.toContain(marker);
    expect(summary).not.toContain('MONGODB_URI');
  });
  test('disabled features make no provider calls even if keys exist', async () => {
    const config = new ConfigService({
      AI_ENABLED: false,
      PRONUNCIATION_ENABLED: false,
      GEMINI_API_KEY: randomBytes(32).toString('hex'),
    });
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('Provider must not be called'));
    try {
      const coach = new AiCoachService(
        config,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );
      jest.spyOn(coach as any, 'findUser').mockResolvedValue({});
      await expect(
        (coach as any).generateReply('hello', 'en', 'en'),
      ).rejects.toMatchObject({ status: 503 });
      await expect(
        coach.checkWriting('owner', 'topic', 'text', 'en', 'en'),
      ).rejects.toMatchObject({ status: 503 });
      const pronunciation = new PronunciationService(config);
      await expect(
        pronunciation.assess({} as any, {} as any),
      ).rejects.toMatchObject({ status: 503 });
      expect(
        await (pronunciation as any).generateGeminiFeedback(
          'hello',
          'English',
          'hello',
          100,
          'correct',
        ),
      ).toContain('Excellent');
      expect(
        await new AiContextService(config).generateContext(
          'word',
          'translation',
          'en',
        ),
      ).toHaveProperty('sentences');
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  test('source/docs/test fixtures contain no live-looking credential literals', () => {
    const root = resolve(__dirname, '../../..');
    const files = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd: root, encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean);
    const suspicious: string[] = [];
    for (const file of files) {
      const bytes = readFileSync(resolve(root, file));
      if (bytes.includes(0)) continue;
      const source = bytes.toString('utf8');
      const uris =
        source.match(/mongodb(?:\+srv)?:\/\/[^\s'"`]+@[^\s'"`]+/g) || [];
      const redactionFixture = ['mongodb://', 'SECRET', '@HOST'].join('');
      if (
        uris.some(
          (uri) =>
            !uri.includes('${') &&
            !(
              file === 'lingua_ai_backend/src/tooling/progress-audit.spec.ts' &&
              uri === redactionFixture
            ),
        )
      )
        suspicious.push(file);
      if (
        /AIza[\w-]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(
          source,
        )
      )
        suspicious.push(file);
    }
    // Report paths only; heuristic hygiene checks cannot verify remote rotation.
    expect(suspicious).toEqual([]);
  });

  const backend = resolve(__dirname, '../..');
  test('compiled production application starts with disposable Mongo and serves native/allowed-origin requests', async () => {
    const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    let child: ReturnType<typeof spawn> | undefined;
    try {
      const reservation = createServer();
      reservation.listen(0, '127.0.0.1');
      await once(reservation, 'listening');
      const port = (reservation.address() as { port: number }).port;
      await new Promise<void>((done) => reservation.close(() => done()));
      const env = production({
        MONGODB_URI: replica.getUri(),
        ALLOW_LOCAL_MONGODB: 'true',
        PORT: String(port),
      });
      child = spawn(process.execPath, ['scripts/start-production.cjs'], {
        cwd: backend,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          ...env,
        } as NodeJS.ProcessEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout?.on('data', (chunk) => {
        output += chunk.toString();
      });
      child.stderr?.on('data', (chunk) => {
        output += chunk.toString();
      });
      const endpoint = `http://127.0.0.1:${port}/health`;
      let ready = false;
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline && child.exitCode === null) {
        try {
          const response = await fetch(endpoint, {
            signal: AbortSignal.timeout(500),
          });
          ready = response.ok && (await response.json()).status === 'ok';
          if (ready) break;
        } catch {
          /* Disposable process is still starting. */
        }
        await new Promise((done) => setTimeout(done, 100));
      }
      expect(ready).toBe(true);
      const allowed = await fetch(endpoint, {
        headers: { Origin: 'https://app.example.invalid' },
        signal: AbortSignal.timeout(1000),
      });
      expect(allowed.headers.get('access-control-allow-origin')).toBe(
        'https://app.example.invalid',
      );
      expect(
        allowed.headers.get('access-control-allow-credentials'),
      ).toBeNull();
      const denied = await fetch(endpoint, {
        headers: { Origin: 'https://other.example.invalid' },
        signal: AbortSignal.timeout(1000),
      });
      expect(denied.headers.get('access-control-allow-origin')).toBeNull();
      expect(output).toContain('"aiEnabled":false');
      expect(output).not.toContain(env.JWT_SECRET);
      expect(output).not.toContain(env.MONGODB_URI);
    } finally {
      if (child && child.exitCode === null) {
        const stopped = once(child, 'exit');
        child.kill();
        await stopped;
      }
      await replica.stop();
    }
  }, 90000);

  test('built production entry point exists and startup uses the same resolver', () => {
    const { productionEntry } = require('../../scripts/production-entry.cjs');
    expect(productionEntry()).toBe(resolve(backend, 'dist/src/main.js'));
    const pkg = JSON.parse(
      readFileSync(resolve(backend, 'package.json'), 'utf8'),
    );
    expect(pkg.scripts['start:prod']).toBe('node scripts/start-production.cjs');
    expect(
      existsSync(resolve(backend, 'dist/src/config/runtime-config.js')),
    ).toBe(true);
    // Execute the real launcher, intercepting only the validated application entry.
    const script = `const Module=require('node:module'); const load=Module._load;
      const entry=require('./scripts/production-entry.cjs').productionEntry();
      Module._load=function(name,...args){if(name===entry){console.log('VALIDATED_ENTRY');return {};}return load.call(this,name,...args);};
      require('./scripts/start-production.cjs');`;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: backend,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        ...production(),
      } as NodeJS.ProcessEnv,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('VALIDATED_ENTRY');
  });
  test('production launcher rejects bad secrets before application loading; preflight is offline', () => {
    const marker = `secret-${randomBytes(32).toString('hex')}`;
    for (const script of [
      'scripts/start-production.cjs',
      'scripts/validate-production.cjs',
    ]) {
      const result = spawnSync(process.execPath, [script], {
        cwd: backend,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          ...production({ JWT_SECRET: marker }),
        } as NodeJS.ProcessEnv,
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('JWT_SECRET');
      expect(result.stderr + result.stdout).not.toContain(marker);
    }
    const good = spawnSync(
      process.execPath,
      ['scripts/validate-production.cjs'],
      {
        cwd: backend,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          ...production(),
        } as NodeJS.ProcessEnv,
        encoding: 'utf8',
      },
    );
    expect(good.status).toBe(0);
    expect(good.stdout).toContain('No connections made');
    const unset = spawnSync(
      process.execPath,
      ['scripts/start-production.cjs'],
      {
        cwd: backend,
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
        encoding: 'utf8',
      },
    );
    expect(unset.status).toBe(1);
  });
});
