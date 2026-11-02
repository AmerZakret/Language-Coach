import { AsyncLocalStorage } from 'node:async_hooks';
import { inspect } from 'node:util';
import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from 'pg';
import type { OnApplicationShutdown } from '@nestjs/common';
import {
  applicationPgConfig,
  checkedApplicationPgConfig,
  type ApplicationPgConfig,
} from './pg-config';
import { ApplicationPgError, pgError, type PgFailure } from './pg-errors';
import { verifyApplicationSchema, verifyApplicationTarget } from './pg-schema';

export const activeApplicationTransaction = new AsyncLocalStorage<object>();
export type PgDiagnostic = {
  event: 'acquire_failure' | 'pool_error' | 'transaction_failure' | 'retry';
  category: PgFailure;
};
export type DiagnosticSink = (event: PgDiagnostic) => void;
export class ApplicationDatabase implements OnApplicationShutdown {
  readonly config: ApplicationPgConfig;
  private readonly pool?: Pool;
  private pending = 0;
  private closing = false;
  private ready = false;
  private version: string | null = null;
  private readonly leased = new Set<PoolClient>();
  private probe?: Promise<boolean>;
  private ended?: Promise<void>;
  private readonly failures: Partial<Record<PgFailure, number>> = {};
  constructor(
    config = applicationPgConfig(),
    private readonly diagnostic: DiagnosticSink = () => undefined,
  ) {
    config = checkedApplicationPgConfig(config);
    this.config = config;
    if (!config.enabled) return;
    if (config.role === 'lc_app_migrator')
      throw new ApplicationPgError('CONFIGURATION');
    this.pool = new Pool({
      connectionString: config.connectionString,
      max: config.max,
      connectionTimeoutMillis: config.acquireMs,
      idleTimeoutMillis: 10000,
      statement_timeout: config.statementMs,
      query_timeout: config.statementMs + 500,
      idle_in_transaction_session_timeout: config.idleTransactionMs,
      application_name: 'language-coach-app-foundation',
      options: '-c search_path=pg_catalog -c timezone=UTC',
    });
    this.pool.on('error', () => {
      this.ready = false;
      this.emit({ event: 'pool_error', category: 'CONNECTION' });
    });
  }
  emit(event: PgDiagnostic) {
    this.failures[event.category] = (this.failures[event.category] ?? 0) + 1;
    // Diagnostics are optional and must not change commit/error semantics.
    try {
      this.diagnostic(Object.freeze(event));
    } catch {
      /* no user data */
    }
  }
  toJSON() {
    return this.metrics();
  }
  [inspect.custom]() {
    return this.metrics();
  }
  metrics() {
    return Object.freeze({
      enabled: this.config.enabled,
      ready: this.ready,
      version: this.version,
      total: this.pool?.totalCount ?? 0,
      idle: this.pool?.idleCount ?? 0,
      waiting: this.pool?.waitingCount ?? 0,
      leased: this.leased.size,
      closing: this.closing,
      failures: Object.freeze({ ...this.failures }),
    });
  }
  /** @internal Infrastructure only; business repositories receive FoundationTx. */
  async withClient<T>(
    work: (client: PoolClient) => Promise<T>,
    setup: { deadline?: number; signal?: AbortSignal } = {},
  ): Promise<T> {
    if (activeApplicationTransaction.getStore())
      throw new ApplicationPgError('TRANSACTION_USAGE');
    if (!this.pool) throw new ApplicationPgError('DISABLED');
    if (this.closing) throw new ApplicationPgError('SHUTDOWN');
    if (
      setup.signal?.aborted ||
      (setup.deadline !== undefined && Date.now() >= setup.deadline)
    )
      throw new ApplicationPgError('TIMEOUT');
    if (this.pending >= this.config.maxPending) {
      this.emit({ event: 'acquire_failure', category: 'TIMEOUT' });
      throw new ApplicationPgError('TIMEOUT');
    }
    let expired = false,
      client: PoolClient | undefined;
    let rejectSetup: (error: ApplicationPgError) => void = () => undefined;
    const expiration = new Promise<never>((_, reject) => {
      rejectSetup = reject;
    });
    const cancel = () => {
      expired = true;
      if (client) this.discard(client);
      rejectSetup(new ApplicationPgError('TIMEOUT'));
    };
    const deadline =
      setup.deadline ??
      Date.now() + this.config.acquireMs + this.config.statementMs + 500;
    const timer = setTimeout(cancel, Math.max(1, deadline - Date.now()));
    setup.signal?.addEventListener('abort', cancel, { once: true });
    const clear = () => {
      clearTimeout(timer);
      setup.signal?.removeEventListener('abort', cancel);
    };
    if (setup.signal?.aborted) cancel();
    this.pending++;
    const acquisition = this.pool
      .connect()
      .then((c) => {
        if (expired) {
          c.release(true);
          throw new ApplicationPgError('TIMEOUT');
        }
        return c;
      })
      .finally(() => {
        this.pending--;
      });
    try {
      client = await Promise.race([acquisition, expiration]);
    } catch (error) {
      clear();
      this.ready = false;
      const safe = pgError(error);
      const category = safe.category === 'TIMEOUT' ? 'TIMEOUT' : 'CONNECTION';
      this.emit({ event: 'acquire_failure', category });
      throw new ApplicationPgError(category);
    }
    if (this.closing) {
      clear();
      client.release(true);
      throw new ApplicationPgError('SHUTDOWN');
    }
    const lease = client;
    this.leased.add(lease);
    let broken = false;
    const onError = () => {
      broken = true;
      this.ready = false;
    };
    lease.on('error', onError);
    try {
      await Promise.race([
        verifyApplicationTarget(lease, this.config),
        expiration,
      ]);
      clear();
      if (expired || setup.signal?.aborted || Date.now() >= deadline)
        throw new ApplicationPgError('TIMEOUT');
      return await work(lease);
    } catch (error) {
      const safe = pgError(error);
      if (
        [
          'CONNECTION',
          'UNKNOWN_COMMIT',
          'TIMEOUT',
          'DATABASE',
          'IDENTITY',
          'SCHEMA_MISMATCH',
        ].includes(safe.category)
      ) {
        broken = true;
        this.ready = false;
      }
      throw safe;
    } finally {
      clear();
      // Raw infrastructure callers must not leak a transaction, SET ROLE or
      // session settings into another checkout. Never turn an acknowledged
      // COMMIT into a retriable error if cleanup fails: discard and diagnose.
      if (!broken && this.leased.has(lease)) {
        let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            lease.query('ROLLBACK; RESET ROLE; RESET ALL'),
            new Promise<never>((_, reject) => {
              cleanupTimer = setTimeout(
                () => {
                  this.discard(lease);
                  reject(new ApplicationPgError('TIMEOUT'));
                },
                Math.min(1000, this.config.statementMs + 500),
              );
            }),
          ]);
        } catch (error) {
          broken = true;
          this.ready = false;
          this.emit({ event: 'pool_error', category: pgError(error).category });
        } finally {
          clearTimeout(cleanupTimer);
        }
      }
      lease.removeListener('error', onError);
      if (this.leased.delete(lease)) lease.release(broken);
    }
  }
  /** @internal Only deadline/shutdown handling may destroy a leased client. */
  discard(client: PoolClient) {
    this.ready = false;
    if (this.leased.delete(client)) client.release(true);
  }
  // No global pool.query is exposed. Future repositories must use their branded
  // transaction handle; even this explicit foundation inspection cannot nest.
  async inspect<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<R>> {
    if (
      activeApplicationTransaction.getStore() ||
      !/^\s*SELECT\b/i.test(text) ||
      /;/.test(text)
    )
      throw new ApplicationPgError('TRANSACTION_USAGE');
    return this.withClient(async (client) => {
      await verifyApplicationSchema(client, this.config);
      await client.query('BEGIN READ ONLY');
      try {
        const result = await client.query<R>(text, values);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw pgError(error);
      }
    });
  }
  health(): Promise<boolean> {
    if (!this.pool || this.closing) return Promise.resolve(false);
    if (!this.probe) {
      this.probe = this.withClient(async (client) => {
        this.version = await verifyApplicationSchema(client, this.config);
        this.ready = true;
        return true;
      })
        .catch(() => {
          this.ready = false;
          return false;
        })
        .finally(() => {
          this.probe = undefined;
        });
    }
    return this.probe;
  }
  onApplicationShutdown(): Promise<void> {
    return this.close();
  }
  close(): Promise<void> {
    if (this.ended) return this.ended;
    this.closing = true;
    this.ready = false;
    if (!this.pool) return Promise.resolve();
    const pool = this.pool;
    this.ended = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        for (const client of this.leased) this.discard(client);
        reject(new ApplicationPgError('SHUTDOWN'));
      }, this.config.shutdownMs);
      pool.end().then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        () => {
          clearTimeout(timer);
          reject(new ApplicationPgError('SHUTDOWN'));
        },
      );
    });
    return this.ended;
  }
}
