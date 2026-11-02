import { Client } from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import { ApplicationPgError, pgError } from './pg-errors';
import {
  checkedApplicationPgConfig,
  type ApplicationPgConfig,
} from './pg-config';
import {
  loadApplicationManifest,
  verifyApplicationTarget,
  applicationCatalogDigest,
  verifyApplicationSchema,
  verifyApplicationCatalogScope,
} from './pg-schema';

export interface MigrationPlan {
  action: 'apply-isolated-application-schema';
  reference: string;
  emptyTargetApproved: boolean;
  closedAndIsolated: true;
  lockWaitMs?: number;
  directory?: string;
}
/** Explicit operator invocation only. No caller in AppModule/startup exists. */
export async function migrateApplication(
  input: ApplicationPgConfig,
  plan: MigrationPlan,
): Promise<string[]> {
  const config = checkedApplicationPgConfig(input);
  if (
    !config.enabled ||
    config.role !== 'lc_app_migrator' ||
    plan.action !== 'apply-isolated-application-schema' ||
    plan.closedAndIsolated !== true ||
    !/^[A-Za-z0-9._:/-]{1,96}$/.test(plan.reference) ||
    !Number.isInteger(plan.lockWaitMs ?? 5000) ||
    (plan.lockWaitMs ?? 5000) < 1 ||
    (plan.lockWaitMs ?? 5000) > 10000
  )
    throw new ApplicationPgError('CONFIGURATION');
  const loaded = loadApplicationManifest(plan.directory);
  const client = new Client({
    connectionString: config.connectionString,
    connectionTimeoutMillis: config.acquireMs,
    query_timeout: 10000,
    statement_timeout: 5000,
    idle_in_transaction_session_timeout: 5000,
    options: '-c search_path=pg_catalog -c timezone=UTC',
    application_name: 'lc-app-migrator',
  });
  let committing = false;
  let disconnected = false;
  client.on('error', () => {
    disconnected = true;
  });
  try {
    await client.connect();
    await verifyApplicationTarget(client, config);
    const until = Date.now() + (plan.lockWaitMs ?? 5000);
    while (
      !(
        await client.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock(110014,1) AS locked',
        )
      ).rows[0].locked
    ) {
      if (Date.now() >= until) throw new ApplicationPgError('TIMEOUT');
      await delay(20);
    }
    // Recheck under this store-local lock. Never query authority or objects.
    await verifyApplicationTarget(client, config);
    if (loadApplicationManifest(plan.directory).digest !== loaded.digest)
      throw new ApplicationPgError('SCHEMA_MISMATCH');
    // NOINHERIT migrator activates the explicitly provisioned owner capability;
    // session_user remains the authenticated migrator for every audit row.
    await client.query('SET ROLE lc_app_owner');
    await verifyApplicationCatalogScope(client);
    const active = await client.query<{
      count: string;
    }>(`SELECT count(*) FROM pg_stat_activity
      WHERE datname=current_database() AND usename IN ('lc_app_runtime','lc_app_reference','lc_app_probe','lc_app_operator','lc_app_audit')`);
    if (active.rows[0].count !== '0') throw new ApplicationPgError('IDENTITY');
    const schemas = await client.query<{ count: string }>(
      `SELECT count(*) FROM pg_namespace WHERE nspname IN ('lc_app','lc_meta')`,
    );
    let applied: {
      migration_id: string;
      ordinal: number;
      file_sha256: string;
      manifest_sha256: string;
    }[] = [];
    if (schemas.rows[0].count === '0') {
      if (!plan.emptyTargetApproved) throw new ApplicationPgError('IDENTITY');
    } else {
      if (schemas.rows[0].count !== '2')
        throw new ApplicationPgError('SCHEMA_MISMATCH');
      const seal = await applicationCatalogDigest(client);
      const prefix = loaded.manifest.entries.find(
        (entry) => entry.catalogSha256 === seal,
      );
      if (!prefix) throw new ApplicationPgError('SCHEMA_MISMATCH');
      applied = (
        await client.query<(typeof applied)[number]>(
          'SELECT migration_id,ordinal,file_sha256,manifest_sha256 FROM lc_meta.schema_migrations ORDER BY ordinal',
        )
      ).rows;
      if (
        applied.length !== prefix.ordinal ||
        applied.length > loaded.manifest.entries.length ||
        applied.some((row, index) => {
          const expected = loaded.manifest.entries[index];
          return (
            row.migration_id !== expected.id ||
            row.ordinal !== expected.ordinal ||
            row.file_sha256 !== expected.sha256 ||
            row.manifest_sha256 !== loaded.digest
          );
        })
      )
        throw new ApplicationPgError('SCHEMA_MISMATCH');
      const identity = await client.query<{
        environment: string;
        storage_identity: string;
        database_instance_id: string;
      }>(
        'SELECT environment,storage_identity,database_instance_id FROM lc_meta.database_identity WHERE singleton',
      );
      if (
        identity.rowCount !== 1 ||
        identity.rows[0].environment !== config.identity!.environment ||
        identity.rows[0].storage_identity !==
          config.identity!.storageIdentity ||
        identity.rows[0].database_instance_id !==
          config.identity!.databaseInstanceId
      )
        throw new ApplicationPgError('IDENTITY');
    }
    await client.query('SET ROLE lc_app_owner');
    const executed: string[] = [];
    for (const entry of loaded.manifest.entries.slice(applied.length)) {
      await client.query('BEGIN');
      try {
        await client.query(`SELECT set_config('lock_timeout','1s',true),set_config('statement_timeout','5s',true),
          set_config('transaction_timeout','10s',true),set_config('synchronous_commit','on',true)`);
        await client.query(loaded.statements[entry.id]);
        if (entry.ordinal === 1) {
          // Separate, explicit plan-bound provisioning insert; never template SQL.
          await client.query(
            `INSERT INTO lc_meta.database_identity(singleton,environment,storage_identity,database_instance_id,created_at)
            VALUES(true,$1,$2,$3,clock_timestamp())`,
            [
              config.identity!.environment,
              config.identity!.storageIdentity,
              config.identity!.databaseInstanceId,
            ],
          );
        }
        if ((await applicationCatalogDigest(client)) !== entry.catalogSha256)
          throw new ApplicationPgError('SCHEMA_MISMATCH');
        await client.query(
          `INSERT INTO lc_meta.schema_migrations(migration_id,ordinal,file_sha256,manifest_sha256,applied_at,applied_by,runner_version)
          VALUES($1,$2,$3,$4,clock_timestamp(),session_user,'m3-a-foundation')`,
          [entry.id, entry.ordinal, entry.sha256, loaded.digest],
        );
        committing = true;
        const committed = await client.query('COMMIT');
        committing = false;
        if (committed.command !== 'COMMIT')
          throw new ApplicationPgError('ABORTED');
        executed.push(entry.id);
      } catch (error) {
        const safe = pgError(error);
        if (
          committing &&
          (disconnected ||
            !safe.sqlState ||
            ['CONNECTION', 'TIMEOUT', 'DATABASE'].includes(safe.category))
        )
          throw new ApplicationPgError('UNKNOWN_COMMIT');
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    }
    await verifyApplicationSchema(client, config, loaded.directory);
    return executed;
  } catch (error) {
    throw pgError(error);
  } finally {
    // Ending the dedicated session releases its advisory lock even on failures.
    await client.end().catch(() => undefined);
  }
}
