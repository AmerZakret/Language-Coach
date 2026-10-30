// OPERATOR_TOOL. Never imported by application modules or public endpoints.
import { Client } from 'pg';
import type { Connection } from 'mongoose';
import { createHash } from 'node:crypto';
import {
  readAuthority,
  AuthorityState,
  authorityIdentity,
} from '../operations/durable-authority';
import {
  readTimelineControl,
  verifyTimelineSchema,
} from '../operations/timeline-gate';
import {
  verifyIndexes,
  verifyTransactions,
  verifyUploadRoot,
} from '../operations/readiness-probes';
import { applyControlRequest } from './timeline-control';
import { isTimelineId } from '../operations/timeline-contract';

export interface AuthorityRequest {
  action:
    | 'initialize'
    | 'close'
    | 'maintenance'
    | 'allocate'
    | 'seal-mongo'
    | 'install'
    | 'reconcile'
    | 'open'
    | 'resolve-effect';
  environment: string;
  storageIdentity: string;
  timelineId: string;
  eventId: string;
  expectedRevision: number;
  operatorReference: string;
  isolationReference?: string;
  uploadRecoveryReference?: string;
  mongoClosedVersion?: number;
  effectId?: string;
  effectRecoveryReference?: string;
  historyContinuityReference?: string;
  isolationReceiptId?: string;
}
export function validateAuthorityRequest(r: AuthorityRequest) {
  const reference = (v: unknown) =>
    typeof v === 'string' && /^[A-Za-z0-9._:/-]{1,96}$/.test(v);
  const allowed = [
    'action',
    'environment',
    'storageIdentity',
    'timelineId',
    'eventId',
    'expectedRevision',
    'operatorReference',
    'isolationReference',
    'uploadRecoveryReference',
    'mongoClosedVersion',
    'effectId',
    'effectRecoveryReference',
    'historyContinuityReference',
    'isolationReceiptId',
  ];
  if (
    !r ||
    typeof r !== 'object' ||
    Object.keys(r).some((k) => !allowed.includes(k)) ||
    !authorityIdentity(r.environment) ||
    !authorityIdentity(r.storageIdentity, 96) ||
    !isTimelineId(r.timelineId) ||
    !isTimelineId(r.eventId) ||
    !Number.isSafeInteger(r.expectedRevision) ||
    r.expectedRevision < 0 ||
    !reference(r.operatorReference) ||
    (r.isolationReceiptId !== undefined &&
      !isTimelineId(r.isolationReceiptId)) ||
    (r.action === 'resolve-effect' && !isTimelineId(r.isolationReceiptId)) ||
    (r.historyContinuityReference !== undefined &&
      !reference(r.historyContinuityReference)) ||
    (['reconcile', 'open'].includes(r.action) &&
      !reference(r.historyContinuityReference)) ||
    (r.effectId !== undefined && !isTimelineId(r.effectId)) ||
    (r.effectRecoveryReference !== undefined &&
      !reference(r.effectRecoveryReference)) ||
    (r.action === 'resolve-effect' &&
      (!isTimelineId(r.effectId) || !reference(r.effectRecoveryReference))) ||
    (r.isolationReference !== undefined && !reference(r.isolationReference)) ||
    (r.uploadRecoveryReference !== undefined &&
      !reference(r.uploadRecoveryReference)) ||
    (r.mongoClosedVersion !== undefined &&
      (!Number.isSafeInteger(r.mongoClosedVersion) ||
        r.mongoClosedVersion < 0)) ||
    ([
      'maintenance',
      'allocate',
      'seal-mongo',
      'install',
      'reconcile',
      'open',
      'resolve-effect',
    ].includes(r.action) &&
      !reference(r.isolationReference)) ||
    ([
      'maintenance',
      'allocate',
      'install',
      'reconcile',
      'resolve-effect',
    ].includes(r.action) &&
      r.mongoClosedVersion === undefined) ||
    (['reconcile', 'open'].includes(r.action) &&
      !reference(r.uploadRecoveryReference)) ||
    ![
      'initialize',
      'close',
      'maintenance',
      'allocate',
      'seal-mongo',
      'install',
      'reconcile',
      'open',
      'resolve-effect',
    ].includes(r.action)
  )
    throw new Error('INVALID_AUTHORITY_REQUEST');
}
export function mongoEvent(event: string, action: string) {
  const bytes = createHash('sha256')
    .update(`${event}:${action}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export class AuthorityOperator {
  readonly client: Client;
  constructor(
    readonly uri: string,
    readonly timeout = 5000,
  ) {
    this.client = new Client({
      connectionString: uri,
      connectionTimeoutMillis: timeout,
      statement_timeout: timeout,
      query_timeout: timeout,
      application_name: 'language-coach-authority-operator',
    });
    this.client.on('error', () => undefined);
  }
  async connect() {
    await this.client.connect();
  }
  async close() {
    await this.client.end().catch(() => undefined);
  }
  async transition(r: AuthorityRequest): Promise<AuthorityState> {
    validateAuthorityRequest(r);
    const { rows } = await this.client.query<{ state: AuthorityState }>(
      'SELECT timeline_authority.transition($1::jsonb) AS state',
      [JSON.stringify(r)],
    );
    const s = rows[0].state;
    return {
      ...s,
      generation: Number(s.generation),
      revision: Number(s.revision),
    };
  }
  async exclusive<T>(work: () => Promise<T>): Promise<T> {
    await this.client.query('SELECT pg_advisory_lock(110013,1)');
    try {
      return await work();
    } finally {
      await this.client
        .query('SELECT pg_advisory_unlock(110013,1)')
        .catch(() => undefined);
    }
  }
}
export async function assertNoFileEffects(op: AuthorityOperator) {
  const result = await op.client.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM timeline_authority.file_effects WHERE status='ACTIVE'",
  );
  if (result.rows[0]?.count !== '0') throw new Error('UNSETTLED_FILE_EFFECTS');
}
export interface CoordinationOptions {
  environment: string;
  storageIdentity: string;
  newEnvironment?: boolean;
  uploadRoot: string;
  deploymentTimeline: string;
  deploymentGeneration: number;
  writeMode: 'OPEN' | 'CLOSED';
  protocolPolicy: string;
}
export async function boundedCoreReadiness(
  mongo: Connection,
  root: string,
  timeout: number,
  readOnlyUploads = false,
  fence: () => Promise<void> = () => Promise.resolve(),
) {
  const abort = new AbortController();
  let timer: NodeJS.Timeout;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new Error('CORE_CHECK_TIMEOUT'));
    }, timeout);
  });
  try {
    await Promise.race([
      deadline,
      (async () => {
        await verifyTimelineSchema(mongo, timeout);
        if (
          (await verifyTransactions(mongo, abort.signal, timeout)) !== 'ok' ||
          (await verifyIndexes(mongo, abort.signal, timeout)).length
        )
          throw new Error('CORE_READINESS_REQUIRED');
        await verifyUploadRoot(
          root,
          false,
          abort.signal,
          undefined,
          readOnlyUploads,
          fence,
        );
      })(),
    ]);
  } finally {
    clearTimeout(timer!);
    abort.abort();
  }
}
/** Cross-store operations intentionally commit separately. Any partial step remains CLOSED/MAINTENANCE. */
export async function coordinateAuthority(
  op: AuthorityOperator,
  mongo: Connection,
  r: AuthorityRequest,
  o: CoordinationOptions,
) {
  validateAuthorityRequest(r);
  if (
    r.environment !== o.environment ||
    r.storageIdentity !== o.storageIdentity ||
    o.protocolPolicy !== 'ENFORCE_MUTATIONS' ||
    o.writeMode !== (r.action === 'open' ? 'OPEN' : 'CLOSED')
  )
    throw new Error('EXPLICIT_DEPLOYMENT_AUTHORIZATION_REQUIRED');
  return op.exclusive(async () => {
    let before: AuthorityState | undefined;
    if (r.action === 'initialize') {
      if (!o.newEnvironment)
        throw new Error('NEW_ENVIRONMENT_CONFIRMATION_REQUIRED');
      const existingMongo = await mongo
        .db!.collection('timelinecontrol')
        .findOne({}, { timeoutMS: op.timeout });
      if (existingMongo) {
        // A matching Mongo event is insufficient when the independent history is missing.
        // Only an intact, already committed independent initialization can resume this step.
        const initialized = await readAuthority(
          op.uri,
          o.environment,
          o.storageIdentity,
          op.timeout,
          undefined,
          true,
        );
        if (
          initialized.last_event !== r.eventId ||
          initialized.timeline_id !== r.timelineId ||
          initialized.generation !== 1 ||
          initialized.revision !== 1 ||
          initialized.mode !== 'CLOSED'
        )
          throw new Error('EXISTING_DEPLOYMENT_REQUIRES_INTACT_AUTHORITY');
      }
      // Retrying our exact initialization may find the matching Mongo control; never adopt existing user data.
      const collections = await mongo
        .db!.listCollections({}, { nameOnly: true, timeoutMS: op.timeout })
        .toArray();
      for (const { name } of collections) {
        if (
          name.startsWith('system.') ||
          (existingMongo &&
            ['timelinecontrol', 'timelinecontrolevents'].includes(name))
        )
          continue;
        if (
          await mongo
            .db!.collection(name)
            .findOne({}, { timeoutMS: op.timeout })
        )
          throw new Error('NEW_EMPTY_ENVIRONMENT_REQUIRED');
      }
    } else {
      before = await readAuthority(
        op.uri,
        o.environment,
        o.storageIdentity,
        op.timeout,
        undefined,
        true,
      );
      if (
        before.last_event !== r.eventId &&
        before.revision !== r.expectedRevision
      )
        throw new Error('AUTHORITY_CAS_CONFLICT');
    }
    let control =
      r.action === 'initialize'
        ? undefined
        : await readTimelineControl(mongo, op.timeout);
    const apply = async (
      action: 'initialize' | 'close' | 'install-timeline' | 'open',
      target: string,
    ) => {
      control = await applyControlRequest(
        mongo,
        {
          action,
          eventId: mongoEvent(r.eventId, action),
          targetTimelineId: target,
          operatorReference: r.operatorReference,
          ...(control
            ? {
                expectedTimelineId: control.dataTimelineId,
                expectedState: control.writeState,
                expectedVersion: control.controlVersion,
              }
            : {}),
          ...(action === 'install-timeline'
            ? { sourceTimelineId: control!.dataTimelineId }
            : {}),
        },
        {
          expectedTimelineId: target,
          writeMode: action === 'open' ? 'OPEN' : 'CLOSED',
        },
        op.timeout,
      );
    };
    if (r.action === 'close') {
      const state = await op.transition(r); // Deny new admissions first; an in-flight writer may still be draining.
      if (control!.dataTimelineId !== state.timeline_id)
        throw new Error('MONGO_AUTHORITY_DISAGREEMENT');
      if (control!.writeState === 'OPEN')
        await apply('close', state.timeline_id);
      await assertNoFileEffects(op);
      return state; // Only returns successfully after Mongo's conflicting-write close barrier commits.
    }
    if (r.action === 'seal-mongo') {
      if (!r.isolationReference) throw new Error('HARD_ISOLATION_REQUIRED');
      const state = await op.transition(r); // Durable MAINTENANCE intent, never grants admission.
      if (control!.writeState === 'OPEN')
        await apply('close', control!.dataTimelineId);
      return state;
    }
    if (
      [
        'maintenance',
        'allocate',
        'install',
        'reconcile',
        'resolve-effect',
      ].includes(r.action)
    ) {
      if (!r.isolationReference || control!.writeState !== 'CLOSED')
        throw new Error('MONGO_CLOSED_ISOLATION_REQUIRED');
      if (
        before!.last_event !== r.eventId &&
        control!.controlVersion !== r.mongoClosedVersion
      )
        throw new Error('MONGO_BARRIER_VERSION_MISMATCH');
      if (
        ['maintenance', 'reconcile'].includes(r.action) &&
        control!.dataTimelineId !== before!.timeline_id
      )
        throw new Error('MONGO_AUTHORITY_DISAGREEMENT');
    }
    if (r.action === 'reconcile' || r.action === 'open') {
      await assertNoFileEffects(op);
      if (
        !r.uploadRecoveryReference ||
        r.timelineId !== before!.timeline_id ||
        control!.dataTimelineId !== before!.timeline_id ||
        o.deploymentTimeline !== before!.timeline_id ||
        o.deploymentGeneration !== before!.generation
      )
        throw new Error('RECOVERY_CONFIRMATION_REQUIRED');
      if (r.action === 'open' && before!.mode !== 'CLOSED') {
        // A completed OPEN can be retried only without modifying Mongo. The SQL
        // function verifies the exact original request, not just the event UUID.
        if (
          before!.mode === 'OPEN' &&
          before!.last_event === r.eventId &&
          control!.writeState === 'OPEN'
        )
          return op.transition(r);
        // Never repair a CLOSED Mongo beneath an already OPEN authority: doing
        // so would grant admission even if the later SQL transition rejects.
        throw new Error('OPEN_REQUIRES_CLOSED_AUTHORITY');
      }
      await boundedCoreReadiness(mongo, o.uploadRoot, op.timeout);
    }
    if (r.action === 'open') {
      if (control!.writeState === 'CLOSED')
        await apply('open', before!.timeline_id);
      // Crash before this SQL commit leaves authority CLOSED even though Mongo OPEN. Safe exact retry.
      return op.transition(r);
    }
    const state = await op.transition(r);
    if (r.action === 'initialize') {
      // Provisioning is explicit and CLOSED. Existing unrelated control is never adopted.
      const exists = await mongo
        .db!.collection('timelinecontrol')
        .findOne({}, { timeoutMS: op.timeout });
      if (exists) {
        const row = await readTimelineControl(mongo, op.timeout);
        if (
          row.dataTimelineId !== r.timelineId ||
          row.writeState !== 'CLOSED' ||
          row.lastEventId !== mongoEvent(r.eventId, 'initialize')
        )
          throw new Error('EXISTING_MONGO_CONTROL_REJECTED');
      } else await apply('initialize', r.timelineId);
    }
    if (r.action === 'install') {
      if (control!.dataTimelineId !== state.timeline_id)
        await apply('install-timeline', state.timeline_id);
      else if (
        control!.lastEventId !== mongoEvent(r.eventId, 'install-timeline')
      )
        throw new Error('RESTORED_TARGET_TIMELINE_REJECTED');
    }
    return state;
  });
}
