import type { Connection } from 'mongoose';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { join, relative, isAbsolute, sep } from 'node:path';
import {
  CRITICAL_INDEXES,
  inspectIndexes,
  IndexFailure,
} from './index-inventory';
import { verifyTimelineSchema } from './timeline-gate';
import type { TimelineWriteGate } from './timeline-gate';
import { TimelineControlError } from './timeline-contract';

export type Check = 'ok' | 'failed' | 'pending';
export type ReadinessChecks = {
  database: Check;
  transactions: Check;
  indexes: Check;
  uploads: Check;
  timeline: Check;
};
export type ProbeResult = {
  checks: ReadinessChecks;
  diagnostics: Array<{ code: string; collection?: string; index?: string }>;
};
export function pendingChecks(): ReadinessChecks {
  return {
    database: 'pending',
    transactions: 'pending',
    indexes: 'pending',
    uploads: 'pending',
    timeline: 'pending',
  };
}

export async function verifyTransactions(
  connection: Connection,
  signal: AbortSignal,
  timeoutMS: number,
): Promise<'ok' | 'UNSUPPORTED_TOPOLOGY' | 'TRANSACTION_CHECK_FAILED'> {
  const db = connection.db!;
  const hello = await db.admin().command({ hello: 1 }, { signal, timeoutMS });
  const sharded = hello.msg === 'isdbgrid';
  if (
    (!hello.setName && !sharded) ||
    hello.logicalSessionTimeoutMinutes == null ||
    hello.maxWireVersion < (sharded ? 8 : 7)
  )
    return 'UNSUPPORTED_TOPOLOGY';
  const session = connection.getClient().startSession();
  let result: 'ok' | 'TRANSACTION_CHECK_FAILED' = 'TRANSACTION_CHECK_FAILED';
  try {
    session.startTransaction({
      readConcern: { level: 'snapshot' },
      readPreference: 'primary',
    });
    // Empty predicate guarantees no user data is returned; no write/commit occurs.
    await db.collection('users').findOne(
      { _id: { $in: [] } },
      {
        session,
        signal,
        timeoutMS,
        maxTimeMS: timeoutMS,
        projection: { _id: 1 },
      },
    );
    result = 'ok';
  } catch {
    result = 'TRANSACTION_CHECK_FAILED';
  } finally {
    if (session.inTransaction())
      await session.abortTransaction({ timeoutMS }).catch(() => {
        result = 'TRANSACTION_CHECK_FAILED';
      });
    await session.endSession().catch(() => {});
  }
  return result;
}

export async function verifyIndexes(
  connection: Connection,
  signal: AbortSignal,
  timeoutMS: number,
): Promise<IndexFailure[]> {
  const results = await Promise.all(
    CRITICAL_INDEXES.map(async (expected) => {
      try {
        signal.throwIfAborted();
        const indexes = await connection
          .db!.collection(expected.collection)
          .listIndexes({ timeoutMS })
          .toArray();
        return inspectIndexes(expected, indexes);
      } catch {
        return [
          {
            collection: expected.collection,
            index: expected.id,
            code: 'INDEX_CHECK_FAILED',
          } as IndexFailure,
        ];
      }
    }),
  );
  return results.flat();
}

function inside(root: string, path: string): boolean {
  const child = relative(root, path);
  return (
    !!child &&
    child !== '..' &&
    !child.startsWith(`..${sep}`) &&
    !isAbsolute(child)
  );
}
export async function verifyUploadRoot(
  root: string,
  createRoot: boolean,
  signal: AbortSignal,
  expectedRealRoot?: string,
  readOnly = false,
  fence: () => Promise<void> = () => Promise.resolve(),
): Promise<string> {
  signal.throwIfAborted();
  if (createRoot) {
    await fence();
    await fs.mkdir(root, { recursive: true });
  }
  const canonical = await fs.realpath(root);
  if (expectedRealRoot && expectedRealRoot !== canonical)
    throw new Error('UPLOAD_ROOT_CHANGED');
  if (!(await fs.stat(canonical)).isDirectory())
    throw new Error('UPLOAD_ROOT_INVALID');
  // Existing community subdirectory must satisfy the same containment as uploads.
  try {
    const directory = await fs.realpath(join(root, 'community'));
    if (
      !inside(canonical, directory) ||
      !(await fs.stat(directory)).isDirectory()
    )
      throw new Error('UPLOAD_CONTAINMENT_FAILED');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  signal.throwIfAborted();
  if (readOnly) {
    await fs.access(canonical, fs.constants.R_OK | fs.constants.W_OK);
    signal.throwIfAborted();
    return canonical; // Permission/containment evidence only, never a write-probe claim.
  }
  const probe = join(canonical, `.readiness-${randomUUID()}.probe`);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    await fence();
    handle = await fs.open(probe, 'wx', 0o600);
    await fence();
    await handle.writeFile('readiness', { signal });
    await handle.sync();
  } finally {
    if (handle) {
      try {
        await handle.close();
      } finally {
        await fs.unlink(probe);
      }
    }
  }
  if ((await fs.realpath(root)) !== canonical)
    throw new Error('UPLOAD_ROOT_CHANGED');
  signal.throwIfAborted();
  return canonical;
}

export async function runReadinessProbes(
  connection: Connection,
  root: string,
  createRoot: boolean,
  signal: AbortSignal,
  timeoutMS: number,
  expectedRealRoot?: string,
  timelineGate?: TimelineWriteGate,
): Promise<ProbeResult & { realRoot?: string }> {
  const checks = pendingChecks();
  const diagnostics: ProbeResult['diagnostics'] = [];
  let realRoot: string | undefined;
  await Promise.all([
    (async () => {
      try {
        if (!timelineGate)
          throw new TimelineControlError('TIMELINE_CONTROL_UNAVAILABLE');
        await verifyTimelineSchema(connection, timeoutMS);
        await timelineGate.resolveControl();
        checks.timeline = 'ok';
      } catch (error) {
        checks.timeline = 'failed';
        diagnostics.push({
          code:
            error instanceof TimelineControlError
              ? error.code
              : 'TIMELINE_CONTROL_UNAVAILABLE',
        });
      }
    })(),
    (async () => {
      if (connection.readyState !== 1 || !connection.db) {
        checks.database = checks.transactions = checks.indexes = 'failed';
        return;
      }
      try {
        const result = await verifyTransactions(connection, signal, timeoutMS);
        checks.database = 'ok';
        checks.transactions = result === 'ok' ? 'ok' : 'failed';
        if (result !== 'ok') diagnostics.push({ code: result });
      } catch {
        checks.database = checks.transactions = 'failed';
        diagnostics.push({ code: 'DATABASE_CHECK_FAILED' });
      }
      const indexFailures = await verifyIndexes(connection, signal, timeoutMS);
      checks.indexes = indexFailures.length ? 'failed' : 'ok';
      diagnostics.push(...indexFailures);
    })(),
    (async () => {
      try {
        const probe = (fence: () => Promise<void> = () => Promise.resolve()) =>
          verifyUploadRoot(
            root,
            createRoot,
            signal,
            expectedRealRoot,
            false,
            fence,
          );
        if (timelineGate?.durableRequired()) {
          const control = await timelineGate.resolveControl();
          realRoot = await timelineGate.fileEffect(
            control.dataTimelineId,
            'readiness-probe',
            probe,
          );
        } else realRoot = await probe();
        checks.uploads = 'ok';
      } catch {
        checks.uploads = 'failed';
        diagnostics.push({ code: 'UPLOAD_CHECK_FAILED' });
      }
    })(),
  ]);
  return { checks, diagnostics, realRoot };
}
