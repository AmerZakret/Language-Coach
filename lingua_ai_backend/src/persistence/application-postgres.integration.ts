// Explicit real disposable PostgreSQL suite. No skip/fallback/memory database.
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { applicationPgConfig, type ApplicationPgConfig } from './pg-config';
import { ApplicationDatabase, type PgDiagnostic } from './application-database';
import {
  ApplicationTransactions,
  type FoundationTx,
  type Isolation,
} from './application-transaction';
import {
  migrateApplication,
  type MigrationPlan,
} from './application-migrations';
import {
  applicationMigrationDirectory,
  loadApplicationManifest,
  applicationCatalogDigest,
} from './pg-schema';
import { pgError, ApplicationPgError } from './pg-errors';
import {
  encodePayloadText,
  decodePayloadText,
  mapPayloadJson,
} from './pg-row-mapping';

jest.setTimeout(60000);
const fixture = {
  environment: 'synthetic-m3a',
  storageIdentity: 'synthetic-m3a-app',
  databaseInstanceId: '33333333-3333-4333-8333-333333333333',
};
const U = '111111111111111111111111',
  U2 = '222222222222222222222222';
const C = '333333333333333333333333',
  P = '444444444444444444444444';
const plan: MigrationPlan = {
  action: 'apply-isolated-application-schema',
  reference: 'synthetic-m3a-test',
  emptyTargetApproved: true,
  closedAndIsolated: true,
};
const resources: ApplicationDatabase[] = [];
const clients: Client[] = [];
const password = (kind: string) => {
  const value = process.env[`M3A_${kind.toUpperCase()}_PASSWORD`] ?? '';
  if (!value.startsWith('synthetic-m3a-'))
    throw Error('Synthetic disposable credentials required');
  return value;
};
function config(
  database = 'lc_app_m3a',
  role = 'runtime',
  overrides: NodeJS.ProcessEnv = {},
): ApplicationPgConfig {
  const url = new URL('postgresql://app-postgres/' + database);
  url.username = 'lc_app_' + role;
  url.password = password(role);
  return applicationPgConfig({
    APPLICATION_PG_MODE: 'foundation-test',
    APPLICATION_PG_DISPOSABLE: 'true',
    APPLICATION_DATABASE_URL: url.toString(),
    APPLICATION_PG_ENVIRONMENT: fixture.environment,
    APPLICATION_PG_STORAGE_IDENTITY: fixture.storageIdentity,
    APPLICATION_PG_INSTANCE_ID: fixture.databaseInstanceId,
    ...overrides,
  });
}
async function admin(database = 'lc_app_m3a'): Promise<Client> {
  const client = new Client({
    host: 'app-postgres',
    user: 'lc_app_bootstrap',
    password: password('admin'),
    database,
    options: '-c search_path=pg_catalog -c timezone=UTC',
    statement_timeout: 5000,
  });
  client.on('error', () => undefined);
  await client.connect();
  clients.push(client);
  return client;
}
function database(
  name = 'lc_app_m3a',
  overrides: NodeJS.ProcessEnv = {},
  events?: PgDiagnostic[],
) {
  const db = new ApplicationDatabase(config(name, 'runtime', overrides), (e) =>
    events?.push(e),
  );
  resources.push(db);
  return db;
}
async function fresh(): Promise<string> {
  const name = 'lc_app_test_' + randomUUID().replaceAll('-', '');
  const root = await admin();
  // Name generated here and validated; never supplied by a user/export.
  if (!/^lc_app_test_[0-9a-f]{32}$/.test(name)) throw Error('Invalid fixture');
  await root.query(`CREATE DATABASE ${name} OWNER lc_app_owner`);
  await root.query(`REVOKE ALL ON DATABASE ${name} FROM PUBLIC`);
  await root.query(
    `GRANT CONNECT ON DATABASE ${name} TO lc_app_migrator,lc_app_runtime,lc_app_reference,lc_app_probe,lc_app_audit,lc_app_operator`,
  );
  const marker = JSON.stringify({
    purpose: 'language-coach-application-foundation',
    database: name,
    ...fixture,
  });
  // SQL identifiers and strings are generated allowlisted fixture constants.
  await root.query(`COMMENT ON DATABASE ${name} IS '${marker}'`);
  const provision = await admin(name);
  await provision.query(
    'ALTER DEFAULT PRIVILEGES FOR ROLE lc_app_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
  );
  return name;
}
async function seed(tx: ApplicationTransactions, handle: FoundationTx) {
  await tx.query(
    handle,
    `INSERT INTO lc_app.users(id,name,email,password_hash) VALUES($1,'Fixture','fixture@example.invalid','synthetic-test-hash')`,
    [U],
  );
}
async function expectState(operation: Promise<unknown>, code: string) {
  await expect(operation).rejects.toMatchObject({ code });
}
async function rolledBack(work: (client: Client) => Promise<void>) {
  const client = await admin();
  await client.query('BEGIN');
  try {
    await work(client);
  } finally {
    await client.query('ROLLBACK');
  }
}
async function waitFor(predicate: () => Promise<boolean>) {
  const end = Date.now() + 3000;
  while (!(await predicate())) {
    if (Date.now() > end)
      throw Error('Deterministic wait condition not observed');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
beforeAll(async () => {
  if (
    process.env.APPLICATION_PG_DISPOSABLE !== 'true' ||
    process.env.APPLICATION_PG_ENVIRONMENT !== fixture.environment
  )
    throw Error('Explicit M3-A Docker environment required');
  const root = await admin();
  console.log(
    'REAL APPLICATION POSTGRESQL:',
    (await root.query('SHOW server_version')).rows[0],
  );
  await migrateApplication(config('lc_app_m3a', 'migrator'), plan);
});
afterEach(async () => {
  await Promise.all(
    resources.splice(0).map((db) => db.close().catch(() => undefined)),
  );
  await Promise.all(
    clients.splice(0).map((client) => client.end().catch(() => undefined)),
  );
});

describe('real application PostgreSQL foundation', () => {
  it('R1: inherited connection variables and search paths cannot redirect an explicit application connection', async () => {
    const injected = {
      PGHOST: 'authority',
      PGDATABASE: 'timeline_authority',
      PGUSER: 'timeline_operator',
      PGPASSWORD: 'synthetic-m3a-invalid',
      PGOPTIONS: '-c search_path=lc_meta,pg_catalog',
    };
    const original = Object.fromEntries(
      Object.keys(injected).map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, injected);
    try {
      const db = database();
      expect(await db.health()).toBe(true);
      const observed = await db.inspect<{ database: string; path: string }>(
        `SELECT current_database() AS database,current_setting('search_path') AS path`,
      );
      expect(observed.rows[0]).toEqual({
        database: 'lc_app_m3a',
        path: 'pg_catalog',
      });
    } finally {
      for (const key of Object.keys(injected)) {
        if (original[key] === undefined) delete process.env[key];
        else process.env[key] = original[key];
      }
    }
  });
  it('R1: failed migration postconditions roll back DDL and release the session lock', async () => {
    const name = await fresh(),
      dir = mkdtempSync(resolve(tmpdir(), 'lc-r1-seal-'));
    cpSync(applicationMigrationDirectory(), dir, { recursive: true });
    const manifest = JSON.parse(
      readFileSync(resolve(dir, 'manifest.json'), 'utf8'),
    ) as { entries: { catalogSha256: string }[] };
    manifest.entries[0].catalogSha256 = '0'.repeat(64);
    writeFileSync(resolve(dir, 'manifest.json'), JSON.stringify(manifest));
    await expect(
      migrateApplication(config(name, 'migrator'), { ...plan, directory: dir }),
    ).rejects.toMatchObject({ category: 'SCHEMA_MISMATCH' });
    const root = await admin(name);
    expect(
      (
        await root.query<{ present: string | null }>(
          `SELECT to_regnamespace('lc_app')::text AS present`,
        )
      ).rows[0].present,
    ).toBeNull();
    const locked = (
      await root.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(110014,1) AS locked',
      )
    ).rows[0].locked;
    try {
      expect(locked).toBe(true);
    } finally {
      if (locked) await root.query('SELECT pg_advisory_unlock(110014,1)');
    }
    expect(
      await migrateApplication(config(name, 'migrator'), plan),
    ).toHaveLength(6);
  });
  it('R1: constraint errors cannot leave a pooled transaction aborted', async () => {
    const db = database('lc_app_m3a', { APPLICATION_PG_POOL_MAX: '1' });
    await expect(
      db.withClient(async (c) => {
        await c.query('BEGIN');
        await c.query(
          `INSERT INTO lc_app.users(id,name,email,password_hash) VALUES($1,'Fixture','r1-error@example.invalid','synthetic')`,
          [U],
        );
        await c.query(
          `INSERT INTO lc_app.users(id,name,email,password_hash) VALUES($1,'Fixture','r1-error@example.invalid','synthetic')`,
          [U2],
        );
      }),
    ).rejects.toMatchObject({ category: 'UNIQUE', sqlState: '23505' });
    expect(
      (
        await db.inspect<{ n: number }>(
          'SELECT count(*)::int AS n FROM lc_app.users',
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('R1: read-only SQL and isolation injection are rejected without leaking a client', async () => {
    const db = database(),
      tx = new ApplicationTransactions(db);
    await expect(
      tx.run((h) => tx.query(h, `UPDATE lc_app.users SET name='forbidden'`), {
        readOnly: true,
      }),
    ).rejects.toMatchObject({ category: 'PERMISSION', sqlState: '25006' });
    await expect(
      tx.run(() => Promise.resolve(1), {
        isolation: 'READ COMMITTED; COMMIT' as Isolation,
      }),
    ).rejects.toMatchObject({ category: 'TRANSACTION_USAGE' });
    expect(db.metrics().leased).toBe(0);
    expect(await db.health()).toBe(true);
  });
  it('R1: a disconnect after acknowledged work preserves success and later connectivity recovers', async () => {
    const name = await fresh();
    await migrateApplication(config(name, 'migrator'), plan);
    const root = await admin(name),
      db = database(name);
    const value = await db.withClient(async (c) => {
      const pid = (
        await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
      ).rows[0].pid;
      await c.query(
        `INSERT INTO lc_app.users(id,name,email,password_hash) VALUES($1,'Fixture','r1-ack@example.invalid','synthetic')`,
        [U],
      );
      await root.query('SELECT pg_terminate_backend($1)', [pid]);
      return 'acknowledged';
    });
    expect(value).toBe('acknowledged');
    expect(await db.health()).toBe(true);
    expect(
      (
        await root.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM lc_app.users',
        )
      ).rows[0].n,
    ).toBe(1);
    expect(db.metrics().leased).toBe(0);
  });
  it('R1: SQL drift while a migrator waits for its lock is rejected before DDL', async () => {
    const name = await fresh(),
      root = await admin(name);
    const dir = mkdtempSync(resolve(tmpdir(), 'lc-r1-drift-'));
    cpSync(applicationMigrationDirectory(), dir, { recursive: true });
    await root.query('SELECT pg_advisory_lock(110014,1)');
    const outcome = migrateApplication(config(name, 'migrator'), {
      ...plan,
      directory: dir,
    }).then(
      () => null,
      (error: unknown) => pgError(error),
    );
    try {
      await waitFor(async () =>
        Boolean(
          (
            await root.query(
              `SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND application_name='lc-app-migrator' AND query LIKE 'SELECT pg_try_advisory_lock%'`,
              [name],
            )
          ).rowCount,
        ),
      );
      writeFileSync(
        resolve(dir, '0001_foundation.sql'),
        '\nCREATE TABLE public.r1_unverified(id integer);\n',
        { flag: 'a' },
      );
    } finally {
      await root.query('SELECT pg_advisory_unlock(110014,1)');
    }
    expect(await outcome).toMatchObject({ category: 'SCHEMA_MISMATCH' });
    expect(
      (
        await root.query<{ present: string | null }>(
          `SELECT to_regnamespace('lc_app')::text AS present`,
        )
      ).rows[0].present,
    ).toBeNull();
    expect(
      (
        await root.query<{ present: string | null }>(
          `SELECT to_regclass('public.r1_unverified')::text AS present`,
        )
      ).rows[0].present,
    ).toBeNull();
  });
  it.each([
    ['runtime', 'pg_write_all_data'],
    ['reference', 'pg_read_all_data'],
  ])(
    'R1: inherited privilege escalation on %s fails readiness',
    async (role, grant) => {
      const root = await admin();
      // Both identifiers come from the fixed test cases, never a payload.
      await root.query(`GRANT ${grant} TO lc_app_${role}`);
      const db = new ApplicationDatabase(config('lc_app_m3a', role));
      resources.push(db);
      try {
        const observed = await root.query<{ allowed: boolean }>(
          'SELECT has_table_privilege($1,$2,$3) AS allowed',
          [
            `lc_app_${role}`,
            role === 'runtime'
              ? 'lc_app.application_timeline_control'
              : 'lc_app.users',
            role === 'runtime' ? 'UPDATE' : 'SELECT',
          ],
        );
        expect(observed.rows[0].allowed).toBe(true);
        expect(await db.health()).toBe(false);
      } finally {
        await root.query(`REVOKE ${grant} FROM lc_app_${role}`);
      }
      expect(await db.health()).toBe(true);
    },
  );
  it('R1: a pooled client cannot carry an open transaction or session poison to its next borrower', async () => {
    const db = database('lc_app_m3a', { APPLICATION_PG_POOL_MAX: '1' });
    await db.withClient(async (c) => {
      await c.query(`SELECT set_config('application_name','r1-poison',false)`);
      await c.query(
        `SELECT set_config('search_path','public,pg_catalog',false)`,
      );
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO lc_app.users(id,name,email,password_hash) VALUES($1,'Fixture','r1@example.invalid','synthetic')`,
        [U],
      );
    });
    const observed = await db.withClient(async (c) => ({
      count: (
        await c.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM lc_app.users',
        )
      ).rows[0].n,
      name: (
        await c.query<{ name: string }>(
          `SELECT current_setting('application_name') AS name`,
        )
      ).rows[0].name,
      path: (
        await c.query<{ path: string }>(
          `SELECT current_setting('search_path') AS path`,
        )
      ).rows[0].path,
    }));
    expect(observed.count).toBe(0);
    expect(observed.name).toBe('language-coach-app-foundation');
    expect(observed.path).toBe('pg_catalog');
  });
  it('R1: unreviewed schema object families are rejected, including unused collations', async () => {
    const name = await fresh();
    await migrateApplication(config(name, 'migrator'), plan);
    const root = await admin(name);
    await root.query(
      'CREATE COLLATION lc_app.r1_unexpected FROM pg_catalog."C"',
    );
    await expect(
      migrateApplication(config(name, 'migrator'), plan),
    ).rejects.toMatchObject({ category: 'SCHEMA_MISMATCH' });
    expect(await database(name).health()).toBe(false);
  });
  it('R1: forged manifest role expectations cannot authorize bootstrap', async () => {
    const name = await fresh(),
      dir = mkdtempSync(resolve(tmpdir(), 'lc-r1-roles-'));
    cpSync(applicationMigrationDirectory(), dir, { recursive: true });
    const manifest = JSON.parse(
      readFileSync(resolve(dir, 'manifest.json'), 'utf8'),
    ) as { roles: string[] };
    manifest.roles = ['timeline_operator'];
    writeFileSync(resolve(dir, 'manifest.json'), JSON.stringify(manifest));
    await expect(
      migrateApplication(config(name, 'migrator'), { ...plan, directory: dir }),
    ).rejects.toMatchObject({ category: 'SCHEMA_MISMATCH' });
  });
  it('R1: missing attestation, forged identity row and invalid credentials fail closed', async () => {
    const name = await fresh(),
      root = await admin(name);
    await root.query(`COMMENT ON DATABASE ${name} IS NULL`);
    await expect(
      migrateApplication(config(name, 'migrator'), plan),
    ).rejects.toMatchObject({ category: 'IDENTITY' });
    const other = await fresh();
    await migrateApplication(config(other, 'migrator'), plan);
    const c = await admin(other);
    await c.query(
      `UPDATE lc_meta.database_identity SET storage_identity='synthetic-forged'`,
    );
    expect(await database(other).health()).toBe(false);
    const cfg = config(),
      url = new URL(cfg.connectionString!);
    url.password = 'synthetic-m3a-invalid';
    const invalid = new ApplicationDatabase({
      ...cfg,
      connectionString: url.toString(),
      acquireMs: 100,
    });
    resources.push(invalid);
    expect(await invalid.health()).toBe(false);
    await expect(invalid.inspect('SELECT 1')).rejects.toMatchObject({
      category: 'CONNECTION',
    });
  });
  it('R1: forged metadata views cannot execute before the catalog seal is verified', async () => {
    for (const kind of ['history', 'identity']) {
      const name = await fresh(),
        root = await admin(name);
      await root.query(
        'CREATE SCHEMA lc_app AUTHORIZATION lc_app_owner; CREATE SCHEMA lc_meta AUTHORIZATION lc_app_owner',
      );
      await root.query('CREATE TABLE lc_meta.r1_effects(value integer)');
      if (kind === 'history') {
        await root.query(`CREATE FUNCTION lc_meta.r1_forged() RETURNS TABLE(migration_id text,ordinal integer,file_sha256 text,manifest_sha256 text)
          LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN INSERT INTO lc_meta.r1_effects VALUES(1); RETURN; END $$`);
        await root.query(
          'CREATE VIEW lc_meta.schema_migrations AS SELECT * FROM lc_meta.r1_forged(); ALTER VIEW lc_meta.schema_migrations OWNER TO lc_app_owner',
        );
        await expect(
          migrateApplication(config(name, 'migrator'), plan),
        ).rejects.toMatchObject({ category: 'SCHEMA_MISMATCH' });
      } else {
        await root.query(`CREATE FUNCTION lc_meta.r1_forged() RETURNS TABLE(environment text,storage_identity text,database_instance_id uuid)
          LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN INSERT INTO lc_meta.r1_effects VALUES(1); RETURN QUERY SELECT 'synthetic-m3a'::text,'synthetic-m3a-app'::text,'33333333-3333-4333-8333-333333333333'::uuid; END $$`);
        await root.query(
          'CREATE VIEW lc_meta.database_identity AS SELECT true AS singleton,f.* FROM lc_meta.r1_forged() f; ALTER VIEW lc_meta.database_identity OWNER TO lc_app_owner',
        );
        expect(await database(name).health()).toBe(false);
      }
      expect(
        (
          await root.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM lc_meta.r1_effects',
          )
        ).rows[0].n,
      ).toBe(0);
    }
  });
  it('R: read-only defaults and PUBLIC DDL privilege drift make foundation health fail closed', async () => {
    const name = await fresh();
    await migrateApplication(config(name, 'migrator'), plan);
    const c = await admin(name);
    await c.query(
      `ALTER DATABASE ${name} SET default_transaction_read_only='on'`,
    );
    expect(await database(name).health()).toBe(false);
    const other = await fresh();
    await migrateApplication(config(other, 'migrator'), plan);
    const d = await admin(other);
    await d.query('GRANT CREATE ON SCHEMA public TO PUBLIC');
    expect(await database(other).health()).toBe(false);
  });
  it('K: a live handle from another concurrent transaction on the same provider is rejected', async () => {
    const db = database(),
      tx = new ApplicationTransactions(db);
    let saved!: FoundationTx, notify!: () => void, release!: () => void;
    const ready = new Promise<void>((r) => {
        notify = r;
      }),
      gate = new Promise<void>((r) => {
        release = r;
      });
    const first = tx.run(async (h) => {
      saved = h;
      notify();
      await gate;
    });
    await ready;
    try {
      await tx.run(async (h) => {
        await expect(tx.query(saved, 'SELECT 1')).rejects.toMatchObject({
          category: 'TRANSACTION_USAGE',
        });
        expect(
          (await tx.query<{ n: number }>(h, 'SELECT 1::int AS n')).rows[0].n,
        ).toBe(1);
      });
    } finally {
      release();
      await first;
    }
  });
  it('M/P: the transaction absolute deadline also bounds pool acquisition; abandoned checkout is released', async () => {
    const db = database('lc_app_m3a', { APPLICATION_PG_POOL_MAX: '1' }),
      tx = new ApplicationTransactions(db);
    let release!: () => void, notify!: () => void;
    const gate = new Promise<void>((r) => {
        release = r;
      }),
      ready = new Promise<void>((r) => {
        notify = r;
      });
    const held = db.withClient(async () => {
      notify();
      await gate;
    });
    await ready;
    let entered = false;
    const started = Date.now();
    await expect(
      tx.run(
        () => {
          entered = true;
          return Promise.resolve(1);
        },
        { timeoutMs: 50 },
      ),
    ).rejects.toMatchObject({ category: 'TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(500);
    expect(entered).toBe(false);
    release();
    await held;
    await waitFor(() => Promise.resolve(db.metrics().waiting === 0));
    expect(await db.health()).toBe(true);
  });
  it('A: creates all 17 reviewed tables, 40 indexes and 8 domains; seeds no timeline', async () => {
    const c = await admin();
    const names = (
      await c.query(
        `SELECT n.nspname||'.'||c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('lc_app','lc_meta') AND c.relkind='r' ORDER BY 1`,
      )
    ).rows;
    expect(names).toHaveLength(17);
    expect(
      (
        await c.query<{ n: number }>(
          `SELECT count(*)::integer AS n FROM pg_indexes WHERE schemaname IN ('lc_app','lc_meta')`,
        )
      ).rows[0].n,
    ).toBe(40);
    expect(
      (
        await c.query<{ n: number }>(
          `SELECT count(*)::integer AS n FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='lc_app' AND t.typtype='d'`,
        )
      ).rows[0].n,
    ).toBe(8);
    expect(
      (
        await c.query<{ n: number }>(
          'SELECT count(*)::integer AS n FROM lc_app.application_timeline_control',
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('B: idempotent rerun is read-only and preserves exact history', async () => {
    const c = await admin();
    const before = (
      await c.query('SELECT * FROM lc_meta.schema_migrations ORDER BY ordinal')
    ).rows;
    expect(
      await migrateApplication(config('lc_app_m3a', 'migrator'), plan),
    ).toEqual([]);
    expect(
      (
        await c.query(
          'SELECT * FROM lc_meta.schema_migrations ORDER BY ordinal',
        )
      ).rows,
    ).toEqual(before);
  });
  it('C: rejects checksum drift and extra/nontransactional migration files before SQL', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'lc-m3a-manifest-'));
    cpSync(applicationMigrationDirectory(), dir, { recursive: true });
    writeFileSync(resolve(dir, '0002_users_lessons.sql'), '-- changed\n', {
      flag: 'a',
    });
    await expect(
      migrateApplication(config('lc_app_m3a', 'migrator'), {
        ...plan,
        directory: dir,
      }),
    ).rejects.toMatchObject({ category: 'SCHEMA_MISMATCH' });
    const extra = mkdtempSync(resolve(tmpdir(), 'lc-m3a-extra-'));
    cpSync(applicationMigrationDirectory(), extra, { recursive: true });
    writeFileSync(resolve(extra, 'unexpected.sql'), 'SELECT 1');
    expect(() => loadApplicationManifest(extra)).toThrow(ApplicationPgError);
    const manifest = JSON.parse(
      readFileSync(resolve(extra, 'manifest.json'), 'utf8'),
    ) as { entries: { transaction: string }[] };
    manifest.entries[0].transaction = 'nontransactional';
    writeFileSync(resolve(extra, 'manifest.json'), JSON.stringify(manifest));
    expect(() => loadApplicationManifest(extra)).toThrow(ApplicationPgError);
  });
  it('D: concurrent migration invocations serialize and apply each file once', async () => {
    const name = await fresh();
    const results = await Promise.all([
      migrateApplication(config(name, 'migrator'), plan),
      migrateApplication(config(name, 'migrator'), plan),
    ]);
    expect(results.map((x) => x.length).sort()).toEqual([0, 6]);
    const c = await admin(name);
    expect(
      (
        await c.query<{ n: number }>(
          'SELECT count(*)::integer AS n FROM lc_meta.schema_migrations',
        )
      ).rows[0].n,
    ).toBe(6);
  });
  it('D: advisory lock acquisition has a bounded refusal', async () => {
    const c = await admin();
    await c.query('SELECT pg_advisory_lock(110014,1)');
    try {
      await expect(
        migrateApplication(config('lc_app_m3a', 'migrator'), {
          ...plan,
          lockWaitMs: 60,
        }),
      ).rejects.toMatchObject({ category: 'TIMEOUT' });
    } finally {
      await c.query('SELECT pg_advisory_unlock(110014,1)');
    }
  });
  it('E: runtime cannot DDL, edit immutable receipts/history, SET ROLE or access authority', async () => {
    const db = database();
    await db.withClient(async (c) => {
      for (const sql of [
        'CREATE TABLE lc_app.forbidden(id int)',
        'ALTER TABLE lc_app.users ADD COLUMN forbidden int',
        'DROP TABLE lc_app.users',
        'CREATE TABLE public.forbidden(id int)',
        'CREATE TEMP TABLE forbidden(id int)',
        'SET ROLE lc_app_owner',
        'UPDATE lc_meta.schema_migrations SET ordinal=99',
        'DELETE FROM lc_app.mutation_receipts',
        'TRUNCATE lc_app.progress_resets',
      ]) {
        await expectState(c.query(sql), '42501');
      }
      expect(
        (
          await c.query<{ authority: string | null }>(
            `SELECT to_regnamespace('timeline_authority') AS authority`,
          )
        ).rows[0].authority,
      ).toBeNull();
      await expectState(
        c.query('SELECT * FROM timeline_authority.state'),
        '42P01',
      );
    });
  });
  it('E: dedicated reference identity cannot read passwords or lock/mutate metadata', async () => {
    const db = new ApplicationDatabase(config('lc_app_m3a', 'reference'));
    resources.push(db);
    await db.withClient(async (c) => {
      await c.query('SELECT id,image_url FROM lc_app.community_posts');
      await expectState(
        c.query('SELECT password_hash FROM lc_app.users'),
        '42501',
      );
      await expectState(
        c.query('SELECT id FROM lc_app.community_posts FOR UPDATE'),
        '42501',
      );
      await expectState(c.query('DELETE FROM lc_app.community_posts'), '42501');
    });
  });
  it('E: append-only history trigger rejects even owner mutation', async () => {
    await rolledBack(async (c) => {
      await expectState(
        c.query('UPDATE lc_meta.schema_migrations SET runner_version=$1', [
          'changed',
        ]),
        '42501',
      );
    });
  });
  it('F: orphan owners are rejected by a real FK', async () => {
    await rolledBack(async (c) => {
      await expectState(
        c.query(
          `INSERT INTO lc_app.flashcards(id,user_id,target_word,turkish_translation) VALUES($1,$2,'word','translation')`,
          [C, U],
        ),
        '23503',
      );
    });
  });
  it('G: raw language/missing-null card slot uniqueness is enforced', async () => {
    await rolledBack(async (c) => {
      await c.query(
        `INSERT INTO lc_app.users(id,name,email,password_hash) VALUES($1,'Fixture','u@example.invalid','synthetic')`,
        [U],
      );
      await c.query(
        `INSERT INTO lc_app.flashcards(id,user_id,target_word,turkish_translation) VALUES($1,$2,'word','translation')`,
        [C, U],
      );
      await expectState(
        c.query(
          `INSERT INTO lc_app.flashcards(id,user_id,target_word,turkish_translation,target_language) VALUES($1,$2,'word','translation',NULL)`,
          [P, U],
        ),
        '23505',
      );
    });
  });
  it('G: receipt uniqueness remains global across timelines and deleted resources', async () => {
    await rolledBack(async (c) => {
      await c.query(
        `INSERT INTO lc_app.users(id,name,email,password_hash) VALUES($1,'Fixture','u@example.invalid','synthetic')`,
        [U],
      );
      const insert = `INSERT INTO lc_app.flashcard_operations(id,user_id,operation_id,operation_type,request_hash,resource_id,data_timeline_id) VALUES($1,$2,'original-key','delete-flashcard',$3,$4,$5)`;
      await c.query(insert, [
        C,
        U,
        'a'.repeat(64),
        P,
        '11111111-1111-4111-8111-111111111111',
      ]);
      await expectState(
        c.query(insert, [
          P,
          U,
          'a'.repeat(64),
          P,
          '22222222-2222-4222-8222-222222222222',
        ]),
        '23505',
      );
    });
  });
  it('H: application protected identities have no partial predicates; SQL partial uniqueness works in isolated scratch only', async () => {
    await rolledBack(async (c) => {
      expect(
        (
          await c.query<{ n: number }>(
            `SELECT count(*)::integer AS n FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('lc_app','lc_meta') AND i.indpred IS NOT NULL`,
          )
        ).rows[0].n,
      ).toBe(0);
      await c.query(
        'CREATE TEMP TABLE partial_fixture(k int,active boolean) ON COMMIT DROP',
      );
      await c.query(
        'CREATE UNIQUE INDEX partial_fixture_key ON partial_fixture(k) WHERE active',
      );
      await c.query(
        'INSERT INTO partial_fixture VALUES(1,false),(1,false),(1,true)',
      );
      await expectState(
        c.query('INSERT INTO partial_fixture VALUES(1,true)'),
        '23505',
      );
    });
  });
  it.each(['ABCDEFABCDEFABCDEFABCDEF', 'short', 'x'.repeat(24)])(
    'I: rejects invalid stored ObjectId %s',
    async (id) => {
      await rolledBack(async (c) => {
        await expectState(
          c.query(
            `INSERT INTO lc_app.users(id,name,email,password_hash) VALUES($1,'Fixture','u@example.invalid','synthetic')`,
            [id],
          ),
          '23514',
        );
      });
    },
  );
  it('J: metadata missing members cannot pass a CHECK on UNKNOWN', async () => {
    await rolledBack(async (c) => {
      await expectState(
        c.query(
          `INSERT INTO lc_app.users(id,name,email,password_hash,legacy_meta) VALUES($1,'Fixture','u@example.invalid','synthetic',$2)`,
          [U, JSON.stringify({ v: 1 })],
        ),
        '23514',
      );
    });
  });
  it('J: codec round trips JSON, NUL/backslash and inert prototype keys in real JSONB', async () => {
    const db = database();
    const logical: unknown = JSON.parse(
      '{"__proto__":"literal","nullByte":"a\\u0000b","escape":"\\\\0"}',
    );
    const row = await db.inspect<{ value: unknown }>(
      'SELECT $1::jsonb AS value',
      [JSON.stringify(mapPayloadJson(logical))],
    );
    expect(mapPayloadJson(row.rows[0].value, true)).toEqual(logical);
    const scalar = await db.inspect<{ value: string }>(
      'SELECT $1::text AS value',
      [encodePayloadText('\0\\0')],
    );
    expect(decodePayloadText(scalar.rows[0].value)).toBe('\0\\0');
  });
  it('K: thrown work rolls back SQL and returns a sanitized error', async () => {
    const db = database(),
      tx = new ApplicationTransactions(db);
    await expect(
      tx.run(async (h) => {
        await seed(tx, h);
        throw Error('synthetic-sensitive-callback');
      }),
    ).rejects.toMatchObject({ category: 'DATABASE' });
    expect(
      (
        await db.inspect<{ n: number }>(
          'SELECT count(*)::int AS n FROM lc_app.users',
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('K: swallowed SQL error still aborts; invalid/completed/foreign handles and nested/global work refuse', async () => {
    const db = database(),
      tx = new ApplicationTransactions(db);
    let saved: FoundationTx;
    await expect(
      tx.run(async (h) => {
        saved = h;
        await seed(tx, h);
        await tx.query(h, 'SELECT 1/0').catch(() => undefined);
      }),
    ).rejects.toMatchObject({ category: 'ABORTED' });
    await expect(tx.query(saved!, 'SELECT 1')).rejects.toMatchObject({
      category: 'TRANSACTION_USAGE',
    });
    await tx.run(async (h) => {
      await expect(db.inspect('SELECT 1')).rejects.toMatchObject({
        category: 'TRANSACTION_USAGE',
      });
      await expect(tx.run(() => Promise.resolve(1))).rejects.toMatchObject({
        category: 'TRANSACTION_USAGE',
      });
      await expect(
        new ApplicationTransactions(db).query(h, 'SELECT 1'),
      ).rejects.toMatchObject({ category: 'TRANSACTION_USAGE' });
    });
  });
  it('L: real row locks serialize two sessions; READ COMMITTED waiter sees committed state', async () => {
    const c = await admin();
    await c.query(
      `INSERT INTO lc_app.users(id,name,email,password_hash) VALUES($1,'LockFixture','lock@example.invalid','synthetic')`,
      [U],
    );
    const db = database(),
      tx = new ApplicationTransactions(db);
    let unlock!: () => void;
    let firstLocked!: () => void;
    const ready = new Promise<void>((r) => {
      firstLocked = r;
    });
    const gate = new Promise<void>((r) => {
      unlock = r;
    });
    const first = tx.run(async (h) => {
      await tx.query(h, 'UPDATE lc_app.users SET total_xp=1 WHERE id=$1', [U]);
      firstLocked();
      await gate;
    });
    await ready;
    const second = tx.run(async (h) => {
      await tx.query(
        h,
        'UPDATE lc_app.users SET total_xp=total_xp+1 WHERE id=$1',
        [U],
      );
    });
    await waitFor(
      async () =>
        (
          await c.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='language-coach-app-foundation' AND wait_event_type='Lock'`,
          )
        ).rows[0].n === 1,
    );
    unlock();
    await Promise.all([first, second]);
    expect(
      (await db.inspect('SELECT total_xp FROM lc_app.users WHERE id=$1', [U]))
        .rows[0].total_xp,
    ).toBe('2');
    await c.query('DELETE FROM lc_app.users WHERE id=$1', [U]);
  });
  it('M: pool exhaustion is bounded and released connections remain usable', async () => {
    const events: PgDiagnostic[] = [];
    const db = database(
      'lc_app_m3a',
      { APPLICATION_PG_POOL_MAX: '1', APPLICATION_PG_ACQUIRE_MS: '60' },
      events,
    );
    let release!: () => void;
    let held!: () => void;
    const holding = new Promise<void>((r) => {
      held = r;
    });
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const first = db.withClient(async () => {
      held();
      await gate;
    });
    await holding;
    const start = Date.now();
    await expect(
      db.withClient(() => Promise.resolve(1)),
    ).rejects.toBeInstanceOf(ApplicationPgError);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(events.some((e) => e.event === 'acquire_failure')).toBe(true);
    release();
    await first;
    expect(await db.health()).toBe(true);
  });
  it('N: unavailable endpoint fails boundedly without logging/fallback', async () => {
    const cfg = config();
    const url = new URL(cfg.connectionString!);
    url.port = '1';
    const db = new ApplicationDatabase({
      ...cfg,
      connectionString: url.toString(),
      acquireMs: 100,
    });
    resources.push(db);
    expect(await db.health()).toBe(false);
    await expect(db.inspect('SELECT 1')).rejects.toMatchObject({
      category: 'CONNECTION',
    });
    expect(db.metrics().ready).toBe(false);
  });
  it('O: graceful shutdown drains and rejects new admissions', async () => {
    const db = database();
    expect(await db.health()).toBe(true);
    await db.close();
    await db.close();
    expect(db.metrics().leased).toBe(0);
    await expect(db.inspect('SELECT 1')).rejects.toMatchObject({
      category: 'SHUTDOWN',
    });
  });
  it('P: real constraint and timeout SQLSTATEs are sanitized', async () => {
    const db = database('lc_app_m3a', { APPLICATION_PG_STATEMENT_MS: '40' }),
      tx = new ApplicationTransactions(db);
    await expect(
      tx.run(async (h) => {
        await tx.query(h, 'SELECT pg_sleep(1)');
      }),
    ).rejects.toMatchObject({ category: 'TIMEOUT', sqlState: '57014' });
    expect(pgError({ code: '40P01', detail: 'synthetic-secret' }).message).toBe(
      'APPLICATION_PG_DEADLOCK',
    );
  });
  it('P: transaction deadline interrupts provider wait and invalidates captured handle', async () => {
    const db = database(),
      tx = new ApplicationTransactions(db);
    let captured: FoundationTx;
    await expect(
      tx.run(
        async (h) => {
          captured = h;
          await new Promise((r) => setTimeout(r, 200));
        },
        { timeoutMs: 80 },
      ),
    ).rejects.toMatchObject({ category: 'TIMEOUT' });
    await expect(tx.query(captured!, 'SELECT 1')).rejects.toMatchObject({
      category: 'TRANSACTION_USAGE',
    });
    expect(await db.health()).toBe(true);
  });
  it('Q: construction and health on empty provisioned DB do not apply schema', async () => {
    const name = await fresh(),
      db = database(name);
    expect(await db.health()).toBe(false);
    const c = await admin(name);
    expect(
      (
        await c.query<{ schema: string | null }>(
          `SELECT to_regnamespace('lc_app') AS schema`,
        )
      ).rows[0].schema,
    ).toBeNull();
  });
  it('R: wrong identity, authority namespace, wrong role and unrelated objects refuse before DDL', async () => {
    const original = config('lc_app_m3a', 'migrator');
    await expect(
      migrateApplication(
        {
          ...original,
          connectionString: original.connectionString,
          identity: { ...fixture, storageIdentity: 'synthetic-wrong' },
        },
        plan,
      ),
    ).rejects.toMatchObject({ category: 'IDENTITY' });
    await expect(migrateApplication(config(), plan)).rejects.toMatchObject({
      category: 'CONFIGURATION',
    });
    const name = await fresh(),
      c = await admin(name);
    await c.query('CREATE SCHEMA timeline_authority');
    await expect(
      migrateApplication(config(name, 'migrator'), plan),
    ).rejects.toMatchObject({ category: 'IDENTITY' });
    const other = await fresh(),
      d = await admin(other);
    await d.query('CREATE TABLE public.unexpected(id int)');
    await expect(
      migrateApplication(config(other, 'migrator'), plan),
    ).rejects.toMatchObject({ category: 'SCHEMA_MISMATCH' });
  });
  it('S: interrupted transactional DDL leaves no history/object; exact prefix resumes', async () => {
    const name = await fresh(),
      c = await admin(name);
    const loaded = loadApplicationManifest();
    await c.query('SET ROLE lc_app_owner');
    await c.query('BEGIN');
    await c.query(
      readFileSync(resolve(loaded.directory, '0001_foundation.sql'), 'utf8'),
    );
    await c.query(
      `INSERT INTO lc_meta.database_identity VALUES(true,$1,$2,$3,clock_timestamp())`,
      [
        fixture.environment,
        fixture.storageIdentity,
        fixture.databaseInstanceId,
      ],
    );
    await c.query(
      `INSERT INTO lc_meta.schema_migrations VALUES($1,1,$2,$3,clock_timestamp(),'lc_app_migrator','m3-a-foundation')`,
      [
        loaded.manifest.entries[0].id,
        loaded.manifest.entries[0].sha256,
        loaded.digest,
      ],
    );
    await c.query('COMMIT');
    const interrupted = await admin(name);
    await interrupted.query('SET ROLE lc_app_owner');
    await interrupted.query('BEGIN');
    await interrupted.query(
      readFileSync(resolve(loaded.directory, '0002_users_lessons.sql'), 'utf8'),
    );
    const pid = (
      await interrupted.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
    ).rows[0].pid;
    const killer = await admin();
    await killer.query('SELECT pg_terminate_backend($1)', [pid]);
    await waitFor(
      async () =>
        !(
          await killer.query('SELECT 1 FROM pg_stat_activity WHERE pid=$1', [
            pid,
          ])
        ).rowCount,
    );
    expect(
      await migrateApplication(config(name, 'migrator'), plan),
    ).toHaveLength(5);
    const finished = await admin(name);
    expect(await applicationCatalogDigest(finished)).toBe(
      loaded.manifest.entries[5].catalogSha256,
    );
  });
  it('S: catalog drift is rejected without automatic repair', async () => {
    const name = await fresh();
    await migrateApplication(config(name, 'migrator'), plan);
    const c = await admin(name);
    await c.query('ALTER TABLE lc_app.users ADD COLUMN unexpected text');
    await expect(
      migrateApplication(config(name, 'migrator'), plan),
    ).rejects.toMatchObject({ category: 'SCHEMA_MISMATCH' });
    const db = database(name);
    expect(await db.health()).toBe(false);
  });
  it('L/P: PostgreSQL detects a real two-session deadlock and manager rolls back the victim', async () => {
    const name = await fresh();
    await migrateApplication(config(name, 'migrator'), plan);
    const root = await admin(name);
    await root.query(
      `INSERT INTO lc_app.users(id,name,email,password_hash) VALUES($1,'Fixture','one@example.invalid','synthetic'),($2,'Fixture','two@example.invalid','synthetic')`,
      [U, U2],
    );
    const db = database(name, { APPLICATION_PG_LOCK_MS: '3000' }),
      tx = new ApplicationTransactions(db);
    let release!: () => void,
      arrivals = 0;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const work = (first: string, second: string) =>
      tx.run(async (h) => {
        await tx.query(
          h,
          'UPDATE lc_app.users SET total_xp=total_xp+1 WHERE id=$1',
          [first],
        );
        if (++arrivals === 2) release();
        await gate;
        await tx.query(
          h,
          'UPDATE lc_app.users SET total_xp=total_xp+1 WHERE id=$1',
          [second],
        );
      });
    const results = await Promise.allSettled([work(U, U2), work(U2, U)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({
      category: 'DEADLOCK',
      sqlState: '40P01',
    });
  });
  it('L/P: explicit database-only SERIALIZABLE retry resolves a real write conflict', async () => {
    const name = await fresh();
    await migrateApplication(config(name, 'migrator'), plan);
    const root = await admin(name);
    await root.query(
      `INSERT INTO lc_app.users(id,name,email,password_hash) VALUES($1,'Fixture','serial@example.invalid','synthetic')`,
      [U],
    );
    const events: PgDiagnostic[] = [];
    const db = database(name, {}, events),
      tx = new ApplicationTransactions(db);
    let release!: () => void,
      arrivals = 0;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const operation = () =>
      tx.retryDatabaseOnly(
        async (h) => {
          await tx.query(h, 'SELECT total_xp FROM lc_app.users WHERE id=$1', [
            U,
          ]);
          if (++arrivals === 2) release();
          await gate;
          await tx.query(
            h,
            'UPDATE lc_app.users SET total_xp=total_xp+1 WHERE id=$1',
            [U],
          );
        },
        { sideEffects: 'none', attempts: 3 },
        { isolation: 'SERIALIZABLE' },
      );
    await Promise.all([operation(), operation()]);
    expect(
      (await db.inspect('SELECT total_xp FROM lc_app.users WHERE id=$1', [U]))
        .rows[0].total_xp,
    ).toBe('2');
    expect(
      events.some((e) => e.event === 'retry' && e.category === 'SERIALIZATION'),
    ).toBe(true);
  });
  it('P: disconnect during real COMMIT is UNKNOWN and never automatically retried', async () => {
    const name = await fresh();
    await migrateApplication(config(name, 'migrator'), plan);
    const fault = await admin(name),
      killer = await admin(name);
    const db = database(name),
      tx = new ApplicationTransactions(db);
    let pid = 0,
      notify!: () => void;
    const ready = new Promise<void>((r) => {
      notify = r;
    });
    const outcome = tx
      .run(async (h) => {
        pid = (
          await tx.query<{ pid: number }>(h, 'SELECT pg_backend_pid() AS pid')
        ).rows[0].pid;
        // Privileged fault injection AFTER preflight, only in this fresh test DB.
        await fault.query(
          `CREATE FUNCTION public.m3a_pause_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(5); RETURN NULL; END $$`,
        );
        await fault.query(
          `CREATE CONSTRAINT TRIGGER m3a_commit_fault AFTER INSERT ON lc_app.users DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.m3a_pause_commit()`,
        );
        await seed(tx, h);
        notify();
      })
      .then(
        () => null,
        (error: unknown) => pgError(error),
      );
    await ready;
    await waitFor(async () =>
      Boolean(
        (
          await killer.query(
            `SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND query='COMMIT' AND wait_event='PgSleep'`,
            [pid],
          )
        ).rowCount,
      ),
    );
    await killer.query('SELECT pg_terminate_backend($1)', [pid]);
    expect(await outcome).toMatchObject({ category: 'UNKNOWN_COMMIT' });
    expect(
      (
        await fault.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM lc_app.users',
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('O: shutdown waits for checked-out work and watchdog failure is not a successful drain', async () => {
    const db = database();
    let started!: () => void;
    const ready = new Promise<void>((r) => {
      started = r;
    });
    let completed = false;
    const work = db.withClient(async (c) => {
      started();
      await c.query('SELECT pg_sleep(0.05)');
      completed = true;
    });
    await ready;
    await db.close();
    await work;
    expect(completed).toBe(true);
    const stalled = database('lc_app_m3a', {
      APPLICATION_PG_SHUTDOWN_MS: '30',
    });
    let release!: () => void, held!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const holding = new Promise<void>((r) => {
      held = r;
    });
    const blocked = stalled.withClient(async () => {
      held();
      await gate;
    });
    await holding;
    await expect(stalled.close()).rejects.toMatchObject({
      category: 'SHUTDOWN',
    });
    release();
    await blocked;
    expect(stalled.metrics().leased).toBe(0);
  });
  it('P: explicit abort cancels a live transaction and prevents later queries', async () => {
    const db = database(),
      tx = new ApplicationTransactions(db),
      abort = new AbortController();
    let notify!: () => void;
    const ready = new Promise<void>((r) => {
      notify = r;
    });
    const result = tx
      .run(
        async (h) => {
          notify();
          await tx.query(h, 'SELECT pg_sleep(2)');
        },
        { signal: abort.signal },
      )
      .catch((e: unknown) => pgError(e));
    await ready;
    abort.abort();
    expect(await result).toMatchObject({ category: 'TIMEOUT' });
    expect(await db.health()).toBe(true);
  });
  it('R: default privilege and unsupported type drift fail closed', async () => {
    const name = await fresh();
    await migrateApplication(config(name, 'migrator'), plan);
    const root = await admin(name);
    await root.query(
      'ALTER DEFAULT PRIVILEGES FOR ROLE lc_app_owner GRANT EXECUTE ON FUNCTIONS TO PUBLIC',
    );
    await expect(
      migrateApplication(config(name, 'migrator'), plan),
    ).rejects.toMatchObject({ category: 'IDENTITY' });
    const other = await fresh();
    await migrateApplication(config(other, 'migrator'), plan);
    const c = await admin(other);
    await c.query(`CREATE TYPE lc_app.unexpected_enum AS ENUM ('extra')`);
    await expect(
      migrateApplication(config(other, 'migrator'), plan),
    ).rejects.toMatchObject({ category: 'SCHEMA_MISMATCH' });
  });
});
