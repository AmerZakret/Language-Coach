import { applicationPgConfig } from './pg-config';
import { ApplicationDatabase } from './application-database';
import { ApplicationTransactions } from './application-transaction';
import { inspect } from 'node:util';
import { ApplicationPgError, pgError } from './pg-errors';
import {
  encodePayloadText,
  decodePayloadText,
  mapPayloadJson,
  safeCounter,
} from './pg-row-mapping';
import { loadApplicationManifest } from './pg-schema';

describe('application PostgreSQL foundation without infrastructure', () => {
  it('R1: error translation never invokes a hostile code getter or conversion', () => {
    let invoked = false;
    const error = Object.defineProperty({}, 'code', {
      get: () => {
        invoked = true;
        throw Error('synthetic-private-value');
      },
    });
    expect(() => pgError(error)).not.toThrow();
    expect(invoked).toBe(false);
    expect(
      pgError({
        code: {
          toString: () => {
            throw Error('synthetic-private-value');
          },
        },
      }).category,
    ).toBe('DATABASE');
  });
  const fixtureEnv = {
    APPLICATION_PG_MODE: 'foundation-test',
    APPLICATION_PG_DISPOSABLE: 'true',
    APPLICATION_DATABASE_URL:
      'postgresql://lc_app_runtime:synthetic-m3a-private@app-postgres/lc_app_m3a',
    APPLICATION_PG_ENVIRONMENT: 'synthetic-m3a',
    APPLICATION_PG_STORAGE_IDENTITY: 'synthetic-m3a-app',
    APPLICATION_PG_INSTANCE_ID: '33333333-3333-4333-8333-333333333333',
  };
  it('redacts configuration, provider serialization and diagnostics', async () => {
    const cfg = applicationPgConfig(fixtureEnv),
      db = new ApplicationDatabase(cfg);
    expect(JSON.stringify(cfg)).not.toContain('synthetic-m3a-private');
    expect(JSON.stringify(db)).not.toContain('postgresql:');
    expect(inspect(db)).not.toContain('synthetic-m3a-private');
    await db.close();
  });
  it('rejects a missing URI instead of accepting inherited pg connection defaults', () => {
    const cfg = applicationPgConfig(fixtureEnv);
    expect(() => new ApplicationDatabase({ ...cfg })).toThrow(
      'APPLICATION_PG_CONFIGURATION',
    );
  });
  it('explicit retry is bounded and never retries unknown commit', async () => {
    const db = new ApplicationDatabase(applicationPgConfig({})),
      tx = new ApplicationTransactions(db);
    await expect(
      tx.retryDatabaseOnly(() => Promise.resolve(1), {
        sideEffects: 'none',
        attempts: 0,
      }),
    ).rejects.toMatchObject({ category: 'CONFIGURATION' });
    await expect(tx.run(() => Promise.resolve(1))).rejects.toMatchObject({
      category: 'DISABLED',
    });
    const call = jest
      .spyOn(db, 'withClient')
      .mockRejectedValue(new ApplicationPgError('UNKNOWN_COMMIT'));
    await expect(
      tx.retryDatabaseOnly(() => Promise.resolve(1), {
        sideEffects: 'none',
        attempts: 12,
      }),
    ).rejects.toMatchObject({ category: 'UNKNOWN_COMMIT' });
    expect(call).toHaveBeenCalledTimes(1);
    call
      .mockClear()
      .mockRejectedValue(new ApplicationPgError('SERIALIZATION', '40001'));
    await expect(
      tx.retryDatabaseOnly(() => Promise.resolve(1), {
        sideEffects: 'none',
        attempts: 2,
      }),
    ).rejects.toMatchObject({ category: 'SERIALIZATION' });
    expect(call).toHaveBeenCalledTimes(2);
    call.mockRestore();
    await db.close();
  });
  it('is disabled without configuration and does not initialize or migrate', async () => {
    const db = new ApplicationDatabase(applicationPgConfig({}));
    expect(await db.health()).toBe(false);
    expect(db.metrics().total).toBe(0);
    await expect(db.inspect('SELECT 1')).rejects.toMatchObject({
      category: 'DISABLED',
    });
    await db.close();
  });
  it.each(['postgresql', 'enabled', 'production'])(
    'rejects unsupported mode %s rather than falling back',
    (mode) => {
      expect(() => applicationPgConfig({ APPLICATION_PG_MODE: mode })).toThrow(
        'APPLICATION_PG_CONFIGURATION',
      );
    },
  );
  it('rejects the authority endpoint and sanitizes malformed configuration', () => {
    expect(() =>
      applicationPgConfig({
        APPLICATION_PG_MODE: 'foundation-test',
        APPLICATION_PG_DISPOSABLE: 'true',
        APPLICATION_DATABASE_URL:
          'postgresql://timeline_reader:synthetic@authority/timeline_authority',
      }),
    ).toThrow('APPLICATION_PG_CONFIGURATION');
  });
  it('validates the entire reviewed manifest and six raw LF checksums', () => {
    const loaded = loadApplicationManifest();
    expect(loaded.manifest.entries).toHaveLength(6);
    expect(loaded.manifest.serverMajor).toBe(17);
  });
  it.each([
    ['23505', 'UNIQUE'],
    ['23503', 'FOREIGN_KEY'],
    ['23514', 'CHECK'],
    ['23502', 'CHECK'],
    ['40001', 'SERIALIZATION'],
    ['40P01', 'DEADLOCK'],
    ['57014', 'TIMEOUT'],
    ['55P03', 'TIMEOUT'],
    ['25P02', 'ABORTED'],
    ['42501', 'PERMISSION'],
    ['42P01', 'SCHEMA_MISMATCH'],
    ['08006', 'CONNECTION'],
  ])('classifies %s without retaining secret details', (code, category) => {
    const safe = pgError({
      code,
      detail: 'synthetic-private-data',
      message: 'synthetic-secret-url',
    });
    expect(safe.category).toBe(category);
    expect(JSON.stringify(safe)).not.toMatch(/synthetic-/);
    expect(safe.message).toBe('APPLICATION_PG_' + category);
    expect(safe).not.toHaveProperty('cause');
  });
  it.each(['', '\0', '\\0', '\\', 'a\\\0b', '🙂', 'x\0\\0\0\\'])(
    'round trips payload text %j',
    (value) => {
      expect(decodePayloadText(encodePayloadText(value))).toBe(value);
      expect(encodePayloadText(value)).not.toContain('\0');
    },
  );
  it('keeps prototype keys inert and does not invoke getters', () => {
    const source: unknown = JSON.parse(
      '{"__proto__":{"owner":"inert"},"constructor":"literal","a\\u0000":"\\\\0"}',
    );
    const decoded = mapPayloadJson(mapPayloadJson(source), true);
    expect(decoded).toEqual(source);
    expect(Object.getPrototypeOf(decoded)).toBeNull();
    let invoked = false;
    const getter = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => {
        invoked = true;
        return 'x';
      },
    });
    expect(() => mapPayloadJson(getter)).toThrow(ApplicationPgError);
    expect(invoked).toBe(false);
  });
  it('rejects malformed escapes, surrogate loss, unsupported BSON and unsafe counters', () => {
    expect(() => decodePayloadText('\\x')).toThrow(ApplicationPgError);
    expect(() => encodePayloadText('\ud800')).toThrow(ApplicationPgError);
    expect(() => mapPayloadJson(new Date())).toThrow(ApplicationPgError);
    expect(() => mapPayloadJson({ n: Infinity })).toThrow(ApplicationPgError);
    expect(() => safeCounter('9007199254740992')).toThrow(ApplicationPgError);
    expect(safeCounter('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
  });
});
