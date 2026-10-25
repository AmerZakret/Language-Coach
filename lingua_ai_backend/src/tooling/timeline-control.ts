// OPERATOR_TOOL. Never import this module from runtime application code.
import type { Connection } from 'mongoose';
import { isDeepStrictEqual } from 'node:util';
import {
  CONTROL_COLLECTION,
  CONTROL_EVENTS,
  CONTROL_ID,
  CONTROL_VALIDATOR,
  isTimelineId,
  MAX_CONTROL_VERSION,
  TimelineControl,
  WriteState,
} from '../operations/timeline-contract';
import {
  readTimelineControl,
  verifyTimelineSchema,
} from '../operations/timeline-gate';
import { verifyTransactions } from '../operations/readiness-probes';

export type ControlAction =
  | 'initialize'
  | 'close'
  | 'install-timeline'
  | 'open';
export interface ControlRequest {
  action: ControlAction;
  eventId: string;
  targetTimelineId: string;
  expectedTimelineId?: string;
  expectedState?: WriteState;
  expectedVersion?: number;
  sourceTimelineId?: string;
  operatorReference: string;
}
interface ControlEvent {
  _id: string;
  request: ControlRequest;
  previousTimelineId: string | null;
  resultVersion: number;
  resultState: WriteState;
  timestamp: Date;
}
export class OperatorControlError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
function refuse(code: string): never {
  throw new OperatorControlError(code);
}

/** Explicit initialization only. Refuse existing unvalidated collections, never repair them. */
async function provisionAbsentControl(
  connection: Connection,
  timeoutMS: number,
) {
  if (
    !(await connection
      .db!.listCollections({ name: CONTROL_COLLECTION }, { timeoutMS })
      .hasNext())
  ) {
    try {
      await connection.db!.createCollection(CONTROL_COLLECTION, {
        validator: CONTROL_VALIDATOR,
        validationLevel: 'strict',
        validationAction: 'error',
        timeoutMS,
      });
    } catch (error) {
      // Concurrent initialization may have created it; verify exact schema below.
      if (!(error instanceof Error && 'code' in error && error.code === 48))
        throw error;
    }
  }
  await verifyTimelineSchema(connection, timeoutMS);
  // Explicit operator provisioning; not an application/readiness side effect.
  await connection
    .db!.collection(CONTROL_COLLECTION)
    .createIndex(
      { singleton: 1 },
      { unique: true, name: 'singleton_1', timeoutMS },
    );
  await connection
    .db!.collection(CONTROL_EVENTS)
    .createIndex({ 'request.targetTimelineId': 1 }, { timeoutMS });
}

export async function applyControlRequest(
  connection: Connection,
  request: ControlRequest,
  deployment: { expectedTimelineId: string; writeMode: WriteState },
  timeoutMS = 5000,
): Promise<TimelineControl> {
  if (
    !isTimelineId(request.eventId) ||
    !isTimelineId(request.targetTimelineId) ||
    !isTimelineId(deployment.expectedTimelineId) ||
    !/^[A-Za-z0-9._:/-]{1,96}$/.test(request.operatorReference) ||
    !['initialize', 'close', 'install-timeline', 'open'].includes(
      request.action,
    ) ||
    !['CLOSED', 'OPEN'].includes(deployment.writeMode)
  )
    refuse('INVALID_OPERATOR_REQUEST');
  if (
    request.action !== 'initialize' &&
    (!isTimelineId(request.expectedTimelineId) ||
      !['OPEN', 'CLOSED'].includes(request.expectedState ?? '') ||
      !Number.isSafeInteger(request.expectedVersion) ||
      request.expectedVersion! < 0 ||
      request.expectedVersion! >= MAX_CONTROL_VERSION)
  )
    refuse('EXPECTED_CURRENT_STATE_REQUIRED');
  if (
    request.action === 'install-timeline' &&
    (!isTimelineId(request.sourceTimelineId) ||
      request.targetTimelineId === request.expectedTimelineId ||
      request.targetTimelineId === request.sourceTimelineId)
  )
    refuse('FRESH_TIMELINE_REQUIRED');
  if (
    request.action !== 'install-timeline' &&
    request.sourceTimelineId !== undefined
  )
    refuse('INVALID_OPERATOR_REQUEST');
  if (
    request.action !== 'initialize' &&
    request.action !== 'install-timeline' &&
    request.targetTimelineId !== request.expectedTimelineId
  )
    refuse('TARGET_MUST_EQUAL_CURRENT');
  if (
    request.action === 'initialize' &&
    (request.expectedTimelineId !== undefined ||
      request.expectedState !== undefined ||
      request.expectedVersion !== undefined)
  )
    refuse('INVALID_OPERATOR_REQUEST');
  if (request.action !== 'open' && deployment.writeMode !== 'CLOSED')
    refuse('OPERATOR_LATCH_MUST_BE_CLOSED');
  if (request.action === 'open' && deployment.writeMode !== 'OPEN')
    refuse('OPERATOR_LATCH_MUST_BE_OPEN');
  if (
    request.action !== 'close' &&
    deployment.expectedTimelineId !== request.targetTimelineId
  )
    refuse('DEPLOYMENT_TIMELINE_MISMATCH');
  try {
    if (
      (await verifyTransactions(
        connection,
        new AbortController().signal,
        timeoutMS,
      )) !== 'ok'
    )
      refuse('TRANSACTIONS_REQUIRED');
    if (request.action === 'initialize')
      await provisionAbsentControl(connection, timeoutMS);
    else await verifyTimelineSchema(connection, timeoutMS);
    const session = await connection.startSession({
      defaultTimeoutMS: timeoutMS,
    });
    try {
      session.startTransaction({
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary',
        maxCommitTimeMS: timeoutMS,
      });
      const events = connection.db!.collection<ControlEvent>(CONTROL_EVENTS);
      const controls =
        connection.db!.collection<TimelineControl>(CONTROL_COLLECTION);
      const previousEvent = await events.findOne(
        { _id: request.eventId },
        { session, maxTimeMS: timeoutMS },
      );
      if (previousEvent) {
        const row = await readTimelineControl(connection, timeoutMS, session);
        if (
          !isDeepStrictEqual(previousEvent.request, request) ||
          row.lastEventId !== request.eventId ||
          row.controlVersion !== previousEvent.resultVersion ||
          row.dataTimelineId !== request.targetTimelineId ||
          row.writeState !== previousEvent.resultState
        )
          refuse('EVENT_RETRY_CONFLICT');
        await session.abortTransaction();
        return row;
      }
      const now = new Date();
      let row: TimelineControl;
      let previousTimelineId: string | null = null;
      if (request.action === 'initialize') {
        if (await controls.findOne({}, { session, maxTimeMS: timeoutMS }))
          refuse('ALREADY_INITIALIZED');
        if (
          await events.findOne(
            {
              'request.action': { $in: ['initialize', 'install-timeline'] },
              'request.targetTimelineId': request.targetTimelineId,
            },
            { session, maxTimeMS: timeoutMS },
          )
        )
          refuse('TIMELINE_ALREADY_USED');
        row = {
          _id: CONTROL_ID,
          singleton: CONTROL_ID,
          dataTimelineId: request.targetTimelineId,
          writeState: 'CLOSED',
          controlVersion: 0,
          fenceVersion: 0,
          createdAt: now,
          updatedAt: now,
          lastEventId: request.eventId,
        };
        await controls.insertOne(row, { session });
      } else {
        row = await readTimelineControl(connection, timeoutMS, session);
        previousTimelineId = row.dataTimelineId;
        if (
          row.dataTimelineId !== request.expectedTimelineId ||
          row.writeState !== request.expectedState ||
          row.controlVersion !== request.expectedVersion
        )
          refuse('CONTROL_CAS_CONFLICT');
        if (
          (request.action === 'install-timeline' ||
            request.action === 'open') &&
          row.writeState !== 'CLOSED'
        )
          refuse('CONTROL_MUST_BE_CLOSED');
        if (request.action === 'close' && row.writeState !== 'OPEN')
          refuse('CONTROL_MUST_BE_OPEN');
        if (
          request.action === 'install-timeline' &&
          (await events.findOne(
            {
              'request.action': { $in: ['initialize', 'install-timeline'] },
              'request.targetTimelineId': request.targetTimelineId,
            },
            { session, maxTimeMS: timeoutMS },
          ))
        )
          refuse('TIMELINE_ALREADY_USED');
        const next: TimelineControl = {
          ...row,
          dataTimelineId: request.targetTimelineId,
          writeState: request.action === 'open' ? 'OPEN' : 'CLOSED',
          controlVersion: row.controlVersion + 1,
          updatedAt: now,
          lastEventId: request.eventId,
          ...(request.action === 'install-timeline'
            ? { sourceTimelineId: request.sourceTimelineId }
            : {}),
        };
        const result = await controls.replaceOne(
          {
            _id: CONTROL_ID,
            dataTimelineId: request.expectedTimelineId,
            writeState: request.expectedState,
            controlVersion: request.expectedVersion,
          },
          next,
          { session, maxTimeMS: timeoutMS },
        );
        if (result.modifiedCount !== 1) refuse('CONTROL_CAS_CONFLICT');
        row = next;
      }
      await events.insertOne(
        {
          _id: request.eventId,
          request,
          previousTimelineId,
          resultVersion: row.controlVersion,
          resultState: row.writeState,
          timestamp: now,
        },
        { session },
      );
      await session.commitTransaction();
      return row;
    } finally {
      if (session.inTransaction())
        await session.abortTransaction().catch(() => undefined);
      await session.endSession();
    }
  } catch (error) {
    if (error instanceof OperatorControlError) throw error;
    refuse('CONTROL_OPERATION_FAILED'); // Retry with the same event/request after inspection.
  }
}
