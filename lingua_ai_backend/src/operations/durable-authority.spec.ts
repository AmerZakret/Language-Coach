import { ConfigService } from '@nestjs/config';
import {
  DurableTimelineAuthority,
  authorityIdentity,
  readAuthority,
} from './durable-authority';
import { TimelineWriteGate } from './timeline-gate';
import {
  validateAuthorityRequest,
  mongoEvent,
} from '../tooling/durable-control';
import { validateEnvironment } from '../config/runtime-config';
import {
  developmentSchemaChangesAllowed,
  initializeDevelopmentIndexes,
} from './schema-startup';

const A = '11111111-1111-4111-8111-111111111111';
test('legacy mode is explicitly local and never masquerades as durable control', async () => {
  const authority = new DurableTimelineAuthority(
    new ConfigService({ TIMELINE_AUTHORITY_MODE: 'LEGACY_LOCAL' }),
  );
  expect(authority.required()).toBe(false);
  await authority.assertOpen(A);
  authority.onModuleDestroy();
});
test('required mode without an injected independent reader cannot authorize writes', async () => {
  const config = new ConfigService({
    DATA_TIMELINE_ID: A,
    DATA_WRITE_MODE: 'OPEN',
    TIMELINE_AUTHORITY_MODE: 'DURABLE_REQUIRED',
  });
  const gate = new TimelineWriteGate(
    {} as never,
    config,
    () => false,
    () => true,
  );
  await expect(
    gate.assertAndTouchWriteFence({ inTransaction: () => false } as never, A),
  ).rejects.toThrow();
});
test.each(['', 'UPPER', 'a/b', 'a b', 'a'.repeat(65)])(
  'reject malformed authority identity %s',
  (v) => {
    expect(authorityIdentity(v)).toBe(false);
  },
);
test('operator requests reject secrets, malformed timelines and missing authorization references', () => {
  const r = {
    action: 'initialize' as const,
    environment: 'synthetic',
    storageIdentity: 'synthetic-authority',
    timelineId: A,
    eventId: A,
    expectedRevision: 0,
    operatorReference: 'test-ticket',
  };
  expect(() => validateAuthorityRequest(r)).not.toThrow();
  expect(() =>
    validateAuthorityRequest({ ...r, password: 'bad' } as never),
  ).toThrow();
  expect(() => validateAuthorityRequest({ ...r, timelineId: 'bad' })).toThrow();
  expect(() =>
    validateAuthorityRequest({ ...r, operatorReference: '' }),
  ).toThrow();
  expect(mongoEvent(A, 'close')).not.toBe(mongoEvent(A, 'open'));
  expect(mongoEvent(A, 'close')).toBe(mongoEvent(A, 'close'));
});
test('strict deployment profile cannot silently select legacy authority', () => {
  expect(() =>
    validateEnvironment({
      DEPLOYMENT_PROFILE: 'DURABLE_REQUIRED',
      TIMELINE_AUTHORITY_MODE: 'LEGACY_LOCAL',
    }),
  ).toThrow();
});

test.each([
  { isolationReference: '' },
  { isolationReference: 123 },
  { uploadRecoveryReference: 'invalid reference' },
  { mongoClosedVersion: -1 },
  { mongoClosedVersion: '0' },
  { action: 'open', isolationReference: undefined },
  { action: 'open', uploadRecoveryReference: undefined },
  { action: 'allocate', mongoClosedVersion: undefined },
])(
  'operator rejects malformed/missing evidence before cross-store work: %j',
  (change) => {
    expect(() =>
      validateAuthorityRequest({
        action: 'initialize',
        environment: 'synthetic',
        storageIdentity: 'synthetic-authority',
        timelineId: A,
        eventId: A,
        expectedRevision: 0,
        operatorReference: 'test-ticket',
        isolationReference: 'stopped-writers',
        uploadRecoveryReference: 'synthetic-recovery',
        historyContinuityReference: 'synthetic-independent-history',
        mongoClosedVersion: 0,
        ...change,
      } as never),
    ).toThrow('INVALID_AUTHORITY_REQUEST');
  },
);
test('cancelled authority reads fail closed without waiting for a connection', async () => {
  const c = new AbortController();
  c.abort();
  await expect(
    readAuthority(
      'postgresql://invalid.invalid/test',
      'test',
      'test-storage',
      100,
      c.signal,
    ),
  ).rejects.toThrow('TIMELINE_CONTROL_UNAVAILABLE');
});

test.each(['TIMELINE_AUTHORITY_MODE', 'DEPLOYMENT_PROFILE'])(
  'required mode prohibits development index writes through %s',
  async (key) => {
    const replacement = jest.replaceProperty(process, 'env', {
      ...process.env,
      NODE_ENV: 'development',
      [key]: 'DURABLE_REQUIRED',
    });
    try {
      const createIndexes = jest.fn();
      expect(developmentSchemaChangesAllowed()).toBe(false);
      await initializeDevelopmentIndexes({ createIndexes } as never);
      expect(createIndexes).not.toHaveBeenCalled();
    } finally {
      replacement.restore();
    }
  },
);
