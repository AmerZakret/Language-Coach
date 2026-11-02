import { ApplicationPgError } from './pg-errors';

export interface ApplicationIdentity {
  environment: string;
  storageIdentity: string;
  databaseInstanceId: string;
}
export interface ApplicationPgConfig {
  enabled: boolean;
  connectionString?: string;
  identity?: ApplicationIdentity;
  database?: string;
  role?: string;
  max: number;
  maxPending: number;
  acquireMs: number;
  statementMs: number;
  lockMs: number;
  idleTransactionMs: number;
  transactionMs: number;
  shutdownMs: number;
}
export const IDENTITY_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const roles = new Set([
  'lc_app_runtime',
  'lc_app_reference',
  'lc_app_probe',
  'lc_app_migrator',
  'lc_app_audit',
  'lc_app_operator',
]);
export function applicationPgConfig(
  env: NodeJS.ProcessEnv = process.env,
): ApplicationPgConfig {
  const fail = (): never => {
    throw new ApplicationPgError('CONFIGURATION');
  };
  const number = (key: string, fallback: number, maximum: number) => {
    const raw = env[key];
    if (raw !== undefined && !/^[0-9]+$/.test(raw)) return fail();
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
      return fail();
    return value;
  };
  const config: ApplicationPgConfig = {
    enabled: false,
    max: number('APPLICATION_PG_POOL_MAX', 8, 8),
    maxPending: number('APPLICATION_PG_MAX_PENDING', 16, 16),
    acquireMs: number('APPLICATION_PG_ACQUIRE_MS', 1000, 5000),
    statementMs: number('APPLICATION_PG_STATEMENT_MS', 5000, 10000),
    lockMs: number('APPLICATION_PG_LOCK_MS', 1000, 5000),
    idleTransactionMs: number('APPLICATION_PG_IDLE_TX_MS', 65000, 65000),
    transactionMs: number('APPLICATION_PG_TRANSACTION_MS', 75000, 75000),
    shutdownMs: number('APPLICATION_PG_SHUTDOWN_MS', 5000, 10000),
  };
  if (!env.APPLICATION_PG_MODE || env.APPLICATION_PG_MODE === 'disabled')
    return config;
  // M3-A deliberately has NO production/application write mode.
  if (
    env.APPLICATION_PG_MODE !== 'foundation-test' ||
    env.APPLICATION_PG_DISPOSABLE !== 'true'
  )
    return fail();
  let url: URL;
  try {
    url = new URL(env.APPLICATION_DATABASE_URL ?? '');
  } catch {
    return fail();
  }
  let role: string;
  try {
    role = decodeURIComponent(url.username);
  } catch {
    return fail();
  }
  const database = url.pathname.slice(1);
  if (
    url.protocol !== 'postgresql:' ||
    !['app-postgres', 'localhost', '127.0.0.1', '[::1]'].includes(
      url.hostname,
    ) ||
    !/^lc_app_[a-z0-9_]{1,48}$/.test(database) ||
    !roles.has(role) ||
    !url.password ||
    url.search ||
    url.hash ||
    !/^synthetic-[a-z0-9-]{1,48}$/.test(env.APPLICATION_PG_ENVIRONMENT ?? '') ||
    !/^synthetic-[a-z0-9-]{1,64}$/.test(
      env.APPLICATION_PG_STORAGE_IDENTITY ?? '',
    ) ||
    !IDENTITY_V4.test(env.APPLICATION_PG_INSTANCE_ID ?? '')
  )
    return fail();
  const result: ApplicationPgConfig = {
    ...config,
    enabled: true,
    max: Math.min(
      config.max,
      role === 'lc_app_reference' ? 2 : role === 'lc_app_probe' ? 1 : 8,
    ),
    acquireMs: Math.min(
      config.acquireMs,
      role === 'lc_app_reference' ? 500 : 5000,
    ),
    statementMs: Math.min(
      config.statementMs,
      role === 'lc_app_reference' ? 1000 : 10000,
    ),
    database,
    role,
    identity: {
      environment: env.APPLICATION_PG_ENVIRONMENT!,
      storageIdentity: env.APPLICATION_PG_STORAGE_IDENTITY!,
      databaseInstanceId: env.APPLICATION_PG_INSTANCE_ID!,
    },
  };
  Object.defineProperty(result, 'connectionString', {
    value: url.toString(),
    enumerable: false,
    writable: false,
  });
  Object.freeze(result.identity);
  return Object.freeze(result);
}

// Revalidate at infrastructure boundaries too: a missing URI must never cause
// pg to fall back to inherited PGHOST/PGUSER or a different database.
export function checkedApplicationPgConfig(
  input: ApplicationPgConfig,
): ApplicationPgConfig {
  if (!input.enabled) return applicationPgConfig({});
  const result = applicationPgConfig({
    APPLICATION_PG_MODE: 'foundation-test',
    APPLICATION_PG_DISPOSABLE: 'true',
    APPLICATION_DATABASE_URL: input.connectionString,
    APPLICATION_PG_ENVIRONMENT: input.identity?.environment,
    APPLICATION_PG_STORAGE_IDENTITY: input.identity?.storageIdentity,
    APPLICATION_PG_INSTANCE_ID: input.identity?.databaseInstanceId,
    APPLICATION_PG_POOL_MAX: String(input.max),
    APPLICATION_PG_MAX_PENDING: String(input.maxPending),
    APPLICATION_PG_ACQUIRE_MS: String(input.acquireMs),
    APPLICATION_PG_STATEMENT_MS: String(input.statementMs),
    APPLICATION_PG_LOCK_MS: String(input.lockMs),
    APPLICATION_PG_IDLE_TX_MS: String(input.idleTransactionMs),
    APPLICATION_PG_TRANSACTION_MS: String(input.transactionMs),
    APPLICATION_PG_SHUTDOWN_MS: String(input.shutdownMs),
  });
  if (result.role !== input.role || result.database !== input.database)
    throw new ApplicationPgError('CONFIGURATION');
  return result;
}
