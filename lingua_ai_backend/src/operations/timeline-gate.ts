import type { ConfigService } from '@nestjs/config';
import type { ClientSession, Connection } from 'mongoose';
import { ConnectionStates } from 'mongoose';
import { isDeepStrictEqual } from 'node:util';
import {
  CONTROL_COLLECTION,
  CONTROL_ID,
  CONTROL_VALIDATOR,
  isTimelineId,
  MAX_CONTROL_VERSION,
  TimelineControl,
  TimelineControlError,
  validControl,
} from './timeline-contract';

/** No bootstrap, provisioning, repair, or cached authority. Reads primary only. */
export async function readTimelineControl(
  connection: Connection,
  timeoutMS: number,
  session?: ClientSession,
  signal?: AbortSignal,
): Promise<TimelineControl> {
  try {
    if (connection.readyState !== ConnectionStates.connected || !connection.db)
      throw new TimelineControlError('TIMELINE_CONTROL_UNAVAILABLE');
    const rows = await connection.db
      .collection<TimelineControl>(CONTROL_COLLECTION)
      .find(
        {},
        {
          session,
          signal,
          readPreference: 'primary',
          maxTimeMS: timeoutMS,
          ...(session ? {} : { timeoutMS }),
        },
      )
      .limit(2)
      .toArray();
    if (rows.length !== 1 || !validControl(rows[0]))
      throw new TimelineControlError('TIMELINE_CONTROL_UNAVAILABLE');
    return rows[0];
  } catch {
    throw new TimelineControlError('TIMELINE_CONTROL_UNAVAILABLE');
  }
}

/** Verify-only: production must provision the exact strict DB validator separately. */
export async function verifyTimelineSchema(
  connection: Connection,
  timeoutMS: number,
): Promise<void> {
  try {
    const info = await connection
      .db!.listCollections({ name: CONTROL_COLLECTION }, { timeoutMS })
      .next();
    if (
      !info ||
      !('options' in info) ||
      info.options?.validationLevel !== 'strict' ||
      info.options.validationAction !== 'error' ||
      !isDeepStrictEqual(info.options.validator, CONTROL_VALIDATOR)
    )
      throw new Error('invalid');
  } catch {
    throw new TimelineControlError('TIMELINE_CONTROL_UNAVAILABLE');
  }
}

export class TimelineWriteGate {
  constructor(
    private readonly connection: Connection,
    private readonly config: Pick<ConfigService, 'get'>,
    private readonly draining: () => boolean,
    private readonly infrastructureReady: () => boolean,
  ) {}
  private expectation(expectedTimeline?: string): string {
    const configured = this.config.get<unknown>('DATA_TIMELINE_ID');
    if (!isTimelineId(configured))
      throw new TimelineControlError('TIMELINE_CONTROL_UNAVAILABLE');
    if (
      expectedTimeline !== undefined &&
      (!isTimelineId(expectedTimeline) || expectedTimeline !== configured)
    )
      throw new TimelineControlError('TIMELINE_MISMATCH');
    if (this.draining() || this.config.get('DATA_WRITE_MODE') !== 'OPEN')
      throw new TimelineControlError('WRITES_CLOSED');
    return configured;
  }
  private timeout(): number {
    return this.config.get<number>('READINESS_TIMEOUT_MS') ?? 5000;
  }
  private check(row: TimelineControl, expected: string): TimelineControl {
    if (row.dataTimelineId !== expected)
      throw new TimelineControlError('TIMELINE_MISMATCH');
    if (
      row.writeState !== 'OPEN' ||
      this.draining() ||
      (row.sourceTimelineId !== undefined &&
        this.config.get('CLIENT_PROTOCOL_POLICY') !== 'ENFORCE_MUTATIONS')
    )
      throw new TimelineControlError('WRITES_CLOSED');
    return row;
  }
  async discovery(): Promise<{
    dataTimelineId: string | null;
    timelineWriteState: 'OPEN' | 'CLOSED' | 'UNAVAILABLE';
  }> {
    try {
      const row = await readTimelineControl(this.connection, this.timeout());
      if (row.dataTimelineId !== this.config.get('DATA_TIMELINE_ID'))
        return { dataTimelineId: null, timelineWriteState: 'UNAVAILABLE' };
      return {
        dataTimelineId: row.dataTimelineId,
        timelineWriteState:
          row.writeState === 'OPEN' &&
          (row.sourceTimelineId === undefined ||
            this.config.get('CLIENT_PROTOCOL_POLICY') ===
              'ENFORCE_MUTATIONS') &&
          this.config.get('DATA_WRITE_MODE') === 'OPEN' &&
          !this.draining() &&
          this.infrastructureReady()
            ? 'OPEN'
            : 'CLOSED',
      };
    } catch {
      return { dataTimelineId: null, timelineWriteState: 'UNAVAILABLE' };
    }
  }
  /** Fresh control-only check; readiness composes this with topology/index/storage probes. */
  async resolveControl(): Promise<TimelineControl> {
    this.expectation();
    const row = await readTimelineControl(this.connection, this.timeout());
    return this.check(row, this.expectation());
  }
  async assertWritesPermitted(): Promise<TimelineControl> {
    if (!this.infrastructureReady())
      throw new TimelineControlError('TIMELINE_CONTROL_UNAVAILABLE');
    const row = await this.resolveControl();
    if (!this.infrastructureReady())
      throw new TimelineControlError('TIMELINE_CONTROL_UNAVAILABLE');
    return row;
  }
  /** Caller owns transaction, abort/retry and domain writes. Never retries or commits here. */
  async assertAndTouchWriteFence(
    session: ClientSession,
    expectedTimeline: string,
  ): Promise<void> {
    try {
      const expected = this.expectation(expectedTimeline);
      if (
        !session.inTransaction() ||
        session.hasEnded ||
        !Number.isSafeInteger(session.timeoutMS) ||
        session.timeoutMS! <= 0 ||
        session.timeoutMS! > this.timeout() ||
        !this.infrastructureReady()
      )
        throw new TimelineControlError('TIMELINE_CONTROL_UNAVAILABLE');
      const row = this.check(
        await readTimelineControl(this.connection, this.timeout(), session),
        expected,
      );
      const result = await this.connection
        .db!.collection<TimelineControl>(CONTROL_COLLECTION)
        .updateOne(
          {
            _id: CONTROL_ID,
            singleton: CONTROL_ID,
            dataTimelineId: expected,
            writeState: 'OPEN',
            controlVersion: row.controlVersion,
            fenceVersion: { $lt: MAX_CONTROL_VERSION },
          },
          { $inc: { fenceVersion: 1 } },
          { session, maxTimeMS: this.timeout() },
        );
      if (result.modifiedCount !== 1)
        throw new TimelineControlError('FENCE_CONFLICT');
      this.expectation(expectedTimeline); // Also refuse drain/latch changes during the await.
    } catch (error) {
      // Fail the caller's transaction even if a caller accidentally catches us.
      if (session.inTransaction())
        await session
          .abortTransaction({ timeoutMS: this.timeout() })
          .catch(() => undefined);
      if (error instanceof TimelineControlError) throw error;
      throw new TimelineControlError('FENCE_CONFLICT');
    }
  }
}
