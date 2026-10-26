import { Global, Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, ClientSession } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { applyControlRequest } from '../src/tooling/timeline-control';
import {
  MutationTimeline,
  MutationAdmission,
  TimelineRuntimeState,
} from '../src/operations/mutation-timeline';

export const TEST_TIMELINE = '11111111-1111-4111-8111-111111111111';
/** Explicit test capability. Never bootstrap a non-disposable/local Mongo target. */
export async function initializeTestTimeline(
  app: Pick<INestApplication, 'get'>,
) {
  const connection = app.get<Connection>(getConnectionToken());
  if (
    !connection
      .getClient()
      .options.hosts.every((host) => host.host === '127.0.0.1' && host.port > 0)
  )
    throw new Error('Timeline fixture requires disposable loopback Mongo');
  const config = app.get(ConfigService);
  config.set('DATA_TIMELINE_ID', TEST_TIMELINE);
  config.set('DATA_WRITE_MODE', 'OPEN');
  config.set('CLIENT_PROTOCOL_POLICY', 'ALLOW_LEGACY');
  const row = await applyControlRequest(
    connection,
    {
      action: 'initialize',
      eventId: randomUUID(),
      targetTimelineId: TEST_TIMELINE,
      operatorReference: 'disposable-test',
    },
    { expectedTimelineId: TEST_TIMELINE, writeMode: 'CLOSED' },
  );
  await applyControlRequest(
    connection,
    {
      action: 'open',
      eventId: randomUUID(),
      targetTimelineId: TEST_TIMELINE,
      expectedTimelineId: TEST_TIMELINE,
      expectedState: 'CLOSED',
      expectedVersion: row.controlVersion,
      operatorReference: 'disposable-test',
    },
    { expectedTimelineId: TEST_TIMELINE, writeMode: 'OPEN' },
  );
  // Isolated domain tests have no ReadinessService. This capability is test-only.
  app.get(TimelineRuntimeState).bind(
    () => false,
    () => true,
  );
}

export const unitTimeline = {
  assertTransaction: () => undefined,
  transaction: async <T>(
    _domain: string,
    work: (session: ClientSession, scope: MutationAdmission) => Promise<T>,
  ) =>
    work({ inTransaction: () => true } as unknown as ClientSession, {
      dataTimelineId: TEST_TIMELINE,
      protocol: 1,
      legacyReceipts: true,
    }),
  fresh: () =>
    Promise.resolve({
      dataTimelineId: TEST_TIMELINE,
      protocol: 1,
      legacyReceipts: true,
    }),
  admit: () =>
    Promise.resolve({
      dataTimelineId: TEST_TIMELINE,
      protocol: 2,
      legacyReceipts: false,
    }),
  run: <T>(_scope: MutationAdmission, work: () => T): T => work(),
} as unknown as MutationTimeline;

@Global()
@Module({
  providers: [{ provide: MutationTimeline, useValue: unitTimeline }],
  exports: [MutationTimeline],
})
export class UnitTimelineModule {}
