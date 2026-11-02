import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { isTimelineId, TimelineControlError } from './timeline-contract';

export interface AuthorityState {
  environment: string;
  storage_identity: string;
  timeline_id: string;
  generation: number;
  revision: number;
  mode: 'CLOSED' | 'MAINTENANCE' | 'OPEN';
  last_event: string;
}
export interface DurableEffectContext {
  client: Client;
  effectId: string;
}
/** A remote mutation may still complete after a lost acknowledgement. */
export class UncertainDurableEffect extends Error {
  constructor() {
    super('UNSETTLED_REMOTE_EFFECT');
  }
}
export const authorityIdentity = (
  value: unknown,
  maximum = 64,
): value is string =>
  typeof value === 'string' &&
  value.length <= maximum &&
  /^[a-z][a-z0-9._-]*$/.test(value);
interface AuthorityReadRow extends Omit<
  AuthorityState,
  'generation' | 'revision'
> {
  generation: string;
  revision: string;
  is_primary: boolean;
  ledger_valid: boolean;
  audit_valid: boolean;
  issued_count: string;
  audit_count: string;
  effect_fencing_version: number;
  pending_effect_count: string;
  orphan_effect_count: string;
}

function checkedState(
  rows: AuthorityReadRow[],
  environment: string,
  storage: string,
  operatorInspection = false,
): AuthorityState {
  if (rows.length !== 1) throw new Error('absent');
  const r = rows[0];
  const generation = Number(r.generation),
    revision = Number(r.revision);
  const pending = Number(r.pending_effect_count),
    orphans = Number(r.orphan_effect_count);
  if (
    !r.is_primary ||
    r.environment !== environment ||
    r.storage_identity !== storage ||
    !isTimelineId(r.timeline_id) ||
    !isTimelineId(r.last_event) ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    !Number.isSafeInteger(revision) ||
    revision < generation ||
    !['CLOSED', 'MAINTENANCE', 'OPEN'].includes(r.mode) ||
    !r.ledger_valid ||
    !r.audit_valid ||
    Number(r.issued_count) !== generation ||
    Number(r.audit_count) !== revision ||
    r.effect_fencing_version !== 1 ||
    !Number.isSafeInteger(pending) ||
    pending < 0 ||
    !Number.isSafeInteger(orphans) ||
    orphans < 0 ||
    orphans > pending ||
    (!operatorInspection && (orphans > 0 || (r.mode !== 'OPEN' && pending > 0)))
  )
    throw new Error('invalid');
  return {
    environment,
    storage_identity: storage,
    timeline_id: r.timeline_id,
    generation,
    revision,
    mode: r.mode,
    last_event: r.last_event,
  };
}

/** One bounded primary statement per check. No caches, bootstrap, mutation or automatic retry. */
export async function readAuthority(
  uri: string,
  environment: string,
  storage: string,
  timeout: number,
  signal?: AbortSignal,
  operatorInspection = false,
): Promise<AuthorityState> {
  const client = new Client({
    connectionString: uri,
    connectionTimeoutMillis: timeout,
    statement_timeout: timeout,
    query_timeout: timeout,
    application_name: 'language-coach-authority-reader',
  });
  const abort = () => {
    void client.end().catch(() => undefined);
  };
  client.on('error', () => undefined); // Never log raw connection errors/credentials.
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw new Error('cancelled');
    await client.connect();
    const { rows } = await client.query<AuthorityReadRow>(
      'SELECT * FROM timeline_authority.current_state',
    );
    if (signal?.aborted) throw new Error('cancelled');
    return checkedState(rows, environment, storage, operatorInspection);
  } catch {
    throw new TimelineControlError('TIMELINE_CONTROL_UNAVAILABLE');
  } finally {
    signal?.removeEventListener('abort', abort);
    await client.end().catch(() => undefined);
  }
}

@Injectable()
export class DurableTimelineAuthority implements OnModuleDestroy {
  private readonly shutdown = new AbortController();
  private active = 0;
  private readonly effects = new Set<Client>();
  constructor(private readonly config: ConfigService) {}
  required() {
    return this.config.get('TIMELINE_AUTHORITY_MODE') === 'DURABLE_REQUIRED';
  }
  async assertOpen(timeline: string): Promise<void> {
    if (!this.required()) return; // Explicit legacy/local compatibility, never a durable fallback.
    if (this.active >= 8)
      throw new TimelineControlError('TIMELINE_CONTROL_UNAVAILABLE');
    this.active++;
    try {
      const state = await readAuthority(
        this.config.getOrThrow('TIMELINE_AUTHORITY_URL'),
        this.config.getOrThrow('TIMELINE_AUTHORITY_ENVIRONMENT'),
        this.config.getOrThrow('TIMELINE_AUTHORITY_STORAGE_ID'),
        this.config.get<number>('READINESS_TIMEOUT_MS') ?? 5000,
        this.shutdown.signal,
      );
      if (
        state.mode !== 'OPEN' ||
        state.timeline_id !== timeline ||
        state.generation !==
          Number(this.config.get('TIMELINE_AUTHORITY_GENERATION'))
      )
        throw new TimelineControlError('WRITES_CLOSED');
    } finally {
      this.active--;
    }
  }
  /** A durable permit outlives connection/process loss; no timer reaps it. */
  async fileEffect<T>(
    timeline: string,
    kind: 'upload-store' | 'upload-remove' | 'readiness-probe',
    work: (
      check: () => Promise<void>,
      context?: DurableEffectContext,
    ) => Promise<T>,
  ): Promise<T> {
    if (!this.required()) return work(() => Promise.resolve());
    if (this.effects.size >= 8 || this.shutdown.signal.aborted)
      throw new TimelineControlError('TIMELINE_CONTROL_UNAVAILABLE');
    const timeout = this.config.get<number>('READINESS_TIMEOUT_MS') ?? 5000;
    const environment = this.config.getOrThrow<string>(
      'TIMELINE_AUTHORITY_ENVIRONMENT',
    );
    const storage = this.config.getOrThrow<string>(
      'TIMELINE_AUTHORITY_STORAGE_ID',
    );
    const generation = Number(this.config.get('TIMELINE_AUTHORITY_GENERATION'));
    const client = new Client({
      connectionString: this.config.getOrThrow('TIMELINE_AUTHORITY_URL'),
      connectionTimeoutMillis: timeout,
      statement_timeout: timeout,
      query_timeout: timeout,
      application_name: 'language-coach-file-effect',
    });
    const id = randomUUID();
    let admitted = false,
      lost = false;
    client.on('error', () => {
      lost = true;
    });
    const abort = () => {
      lost = true;
      void client.end().catch(() => undefined);
    };
    this.effects.add(client);
    this.shutdown.signal.addEventListener('abort', abort, { once: true });
    const check = async () => {
      if (lost || this.shutdown.signal.aborted) throw new Error('cancelled');
      const { rows } = await client.query<AuthorityReadRow>(
        'SELECT * FROM timeline_authority.current_state',
      );
      const state = checkedState(rows, environment, storage);
      if (
        state.mode !== 'OPEN' ||
        state.timeline_id !== timeline ||
        state.generation !== generation
      )
        throw new Error('closed');
    };
    let result!: T;
    let failure: TimelineControlError | undefined;
    try {
      await client.connect();
      await client.query(
        'SELECT timeline_authority.begin_file_effect($1,$2,$3::uuid,$4::bigint,$5::uuid,$6)',
        [environment, storage, timeline, generation, id, kind],
      );
      admitted = true;
      await check();
      result = await work(check, { client, effectId: id }); // Never release while a native operation is pending.
      await check();
    } catch (error) {
      if (error instanceof UncertainDurableEffect) lost = true;
      failure = new TimelineControlError('TIMELINE_CONTROL_UNAVAILABLE');
    } finally {
      try {
        if (admitted && !lost && !this.shutdown.signal.aborted)
          await client.query(
            'SELECT timeline_authority.finish_file_effect($1::uuid)',
            [id],
          );
      } catch {
        // Unknown release stays durably pending; neither retry nor new session may reap it.
        failure = new TimelineControlError('TIMELINE_CONTROL_UNAVAILABLE');
      } finally {
        this.shutdown.signal.removeEventListener('abort', abort);
        this.effects.delete(client);
        await client.end().catch(() => undefined);
      }
    }
    if (failure) throw failure;
    return result;
  }
  onModuleDestroy() {
    this.shutdown.abort();
  }
}
