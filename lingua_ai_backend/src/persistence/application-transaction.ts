import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { randomInt } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ApplicationDatabase,
  activeApplicationTransaction,
} from './application-database';
import { ApplicationPgError, pgError } from './pg-errors';
import { verifyApplicationSchema } from './pg-schema';

// This is deliberately NOT M2 WriteTx: no timeline admission/F or M4 claim.
// Only explicit foundation-test mode can construct the underlying database.
export interface FoundationTx {
  readonly foundationTransactionBrand: unique symbol;
}
export type Isolation = 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
export interface FoundationTransactionOptions {
  isolation?: Isolation;
  readOnly?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}
interface State {
  client: PoolClient;
  active: boolean;
  busy: boolean;
  failed: boolean;
  deadline: number;
  readOnly: boolean;
}
export class ApplicationTransactions {
  private readonly states = new WeakMap<FoundationTx, State>();
  constructor(private readonly database: ApplicationDatabase) {}
  async query<R extends QueryResultRow = QueryResultRow>(
    tx: FoundationTx,
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<R>> {
    const state = this.states.get(tx);
    if (
      !state?.active ||
      state.busy ||
      Date.now() >= state.deadline ||
      activeApplicationTransaction.getStore() !== tx ||
      !/^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(text) ||
      /;/.test(text)
    )
      throw new ApplicationPgError('TRANSACTION_USAGE');
    state.busy = true;
    try {
      return await state.client.query<R>(text, values);
    } catch (error) {
      state.failed = true;
      throw pgError(error);
    } finally {
      state.busy = false;
    }
  }
  run<T>(
    work: (tx: FoundationTx) => Promise<T>,
    options: FoundationTransactionOptions = {},
  ): Promise<T> {
    return this.attempt(work, options, Date.now() + this.budget(options));
  }
  private budget(options: FoundationTransactionOptions): number {
    const budget = options.timeoutMs ?? this.database.config.transactionMs;
    if (
      !Number.isSafeInteger(budget) ||
      budget < 1 ||
      budget > this.database.config.transactionMs
    )
      throw new ApplicationPgError('CONFIGURATION');
    return budget;
  }
  // Explicit database-only opt-in; no implicit retry of callbacks/HTTP/provider
  // effects. UNKNOWN_COMMIT, cancellation and lock timeout never retry here.
  async retryDatabaseOnly<T>(
    work: (tx: FoundationTx) => Promise<T>,
    policy: {
      sideEffects: 'none';
      attempts: number;
    },
    options: FoundationTransactionOptions = {},
  ): Promise<T> {
    if (
      policy.sideEffects !== 'none' ||
      !Number.isInteger(policy.attempts) ||
      policy.attempts < 1 ||
      policy.attempts > 12
    )
      throw new ApplicationPgError('CONFIGURATION');
    const deadline = Date.now() + this.budget(options);
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.attempt(work, options, deadline);
      } catch (error) {
        const safe = pgError(error);
        if (
          !['SERIALIZATION', 'DEADLOCK'].includes(safe.category) ||
          attempt >= policy.attempts ||
          Date.now() + 25 >= deadline
        )
          throw safe;
        this.database.emit({ event: 'retry', category: safe.category });
        await delay(randomInt(1, 25), undefined, {
          signal: options.signal,
        }).catch(() => {
          throw new ApplicationPgError('TIMEOUT');
        });
      }
    }
  }
  private async attempt<T>(
    work: (tx: FoundationTx) => Promise<T>,
    options: FoundationTransactionOptions,
    deadline: number,
  ): Promise<T> {
    const isolation = options.isolation ?? 'READ COMMITTED';
    if (
      !['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'].includes(
        isolation,
      ) ||
      activeApplicationTransaction.getStore()
    )
      throw new ApplicationPgError('TRANSACTION_USAGE');
    if (options.signal?.aborted || Date.now() >= deadline)
      throw new ApplicationPgError('TIMEOUT');
    return this.database.withClient(
      async (client) => {
        const tx = Object.freeze({}) as FoundationTx;
        const state: State = {
          client,
          active: false,
          busy: false,
          failed: false,
          deadline,
          readOnly: options.readOnly === true,
        };
        this.states.set(tx, state);
        let committing = false;
        let began = false;
        let cancelled = false;
        let rejectDeadline: (reason: ApplicationPgError) => void = () =>
          undefined;
        const expiry = new Promise<never>((_, reject) => {
          rejectDeadline = reject;
        });
        const cancel = () => {
          cancelled = true;
          state.active = false;
          this.database.discard(client);
          rejectDeadline(
            new ApplicationPgError(committing ? 'UNKNOWN_COMMIT' : 'TIMEOUT'),
          );
        };
        const timer = setTimeout(cancel, Math.max(1, deadline - Date.now()));
        options.signal?.addEventListener('abort', cancel, { once: true });
        if (options.signal?.aborted) cancel();
        const operation = async () => {
          try {
            await verifyApplicationSchema(client, this.database.config);
            if (cancelled || Date.now() >= deadline)
              throw new ApplicationPgError('TIMEOUT');
            // Isolation is a closed enum, never client-supplied SQL.
            await client.query(
              `BEGIN ISOLATION LEVEL ${isolation}${state.readOnly ? ' READ ONLY' : ''}`,
            );
            began = true;
            await client.query(
              `SELECT set_config('lock_timeout',$1,true),
            set_config('statement_timeout',$2,true),set_config('idle_in_transaction_session_timeout',$3,true),
            set_config('transaction_timeout',$4,true),set_config('synchronous_commit','on',true)`,
              [
                `${this.database.config.lockMs}ms`,
                `${this.database.config.statementMs}ms`,
                `${this.database.config.idleTransactionMs}ms`,
                `${Math.max(1, deadline - Date.now())}ms`,
              ],
            );
            state.active = true;
            const result = await activeApplicationTransaction.run(tx, () =>
              work(tx),
            );
            if (state.failed) throw new ApplicationPgError('ABORTED');
            if (state.busy) throw new ApplicationPgError('TRANSACTION_USAGE');
            if (cancelled || Date.now() >= deadline)
              throw new ApplicationPgError('TIMEOUT');
            state.active = false;
            committing = true;
            const commit = await client.query('COMMIT');
            committing = false;
            if (commit.command !== 'COMMIT')
              throw new ApplicationPgError('ABORTED');
            return result;
          } catch (error) {
            state.active = false;
            const safe = pgError(error);
            if (state.busy) this.database.discard(client);
            if (
              committing &&
              (!safe.sqlState ||
                ['CONNECTION', 'TIMEOUT', 'DATABASE'].includes(safe.category))
            ) {
              this.database.discard(client);
              throw new ApplicationPgError('UNKNOWN_COMMIT');
            }
            if (began && !cancelled && !state.busy) {
              try {
                await client.query('ROLLBACK');
              } catch {
                this.database.discard(client);
              }
            }
            throw safe;
          }
        };
        try {
          return await Promise.race([operation(), expiry]);
        } catch (error) {
          const safe = pgError(error);
          this.database.emit({
            event: 'transaction_failure',
            category: safe.category,
          });
          throw safe;
        } finally {
          clearTimeout(timer);
          options.signal?.removeEventListener('abort', cancel);
          state.active = false;
          this.states.delete(tx);
        }
      },
      { deadline, signal: options.signal },
    );
  }
}
