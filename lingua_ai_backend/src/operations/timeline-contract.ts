// Public, opaque equality tokens. Never derive these from data, builds or time.
export const TIMELINE_ID_PATTERN =
  '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
export function isTimelineId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === 36 &&
    new RegExp(TIMELINE_ID_PATTERN).test(value)
  );
}
export const CONTROL_COLLECTION = 'timelinecontrol';
export const CONTROL_ID = 'global';
export const CONTROL_EVENTS = 'timelinecontrolevents';
export const MAX_CONTROL_VERSION = Number.MAX_SAFE_INTEGER - 1;
export type WriteState = 'OPEN' | 'CLOSED';
export interface TimelineControl {
  _id: string;
  singleton: 'global';
  dataTimelineId: string;
  writeState: WriteState;
  controlVersion: number;
  fenceVersion: number;
  createdAt: Date;
  updatedAt: Date;
  lastEventId: string;
  sourceTimelineId?: string;
}
export const CONTROL_VALIDATOR = {
  $jsonSchema: {
    bsonType: 'object',
    additionalProperties: false,
    required: [
      '_id',
      'singleton',
      'dataTimelineId',
      'writeState',
      'controlVersion',
      'fenceVersion',
      'createdAt',
      'updatedAt',
      'lastEventId',
    ],
    properties: {
      _id: { enum: [CONTROL_ID] },
      singleton: { enum: [CONTROL_ID] },
      dataTimelineId: { bsonType: 'string', pattern: TIMELINE_ID_PATTERN },
      writeState: { enum: ['OPEN', 'CLOSED'] },
      controlVersion: {
        bsonType: ['int', 'long', 'double'],
        minimum: 0,
        maximum: MAX_CONTROL_VERSION,
        multipleOf: 1,
      },
      fenceVersion: {
        bsonType: ['int', 'long', 'double'],
        minimum: 0,
        maximum: MAX_CONTROL_VERSION,
        multipleOf: 1,
      },
      createdAt: { bsonType: 'date' },
      updatedAt: { bsonType: 'date' },
      lastEventId: { bsonType: 'string', pattern: TIMELINE_ID_PATTERN },
      sourceTimelineId: { bsonType: 'string', pattern: TIMELINE_ID_PATTERN },
    },
  },
};
export type TimelineErrorCode =
  | 'TIMELINE_CONTROL_UNAVAILABLE'
  | 'TIMELINE_MISMATCH'
  | 'WRITES_CLOSED'
  | 'FENCE_CONFLICT';
export class TimelineControlError extends Error {
  constructor(readonly code: TimelineErrorCode) {
    super(code); // No Mongo error, URI, supplied value, or cause crosses this boundary.
    this.name = 'TimelineControlError';
  }
}
export function validControl(value: unknown): value is TimelineControl {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const keys = Object.keys(CONTROL_VALIDATOR.$jsonSchema.properties);
  return (
    Object.keys(row).every((key) => keys.includes(key)) &&
    row._id === CONTROL_ID &&
    row.singleton === CONTROL_ID &&
    isTimelineId(row.dataTimelineId) &&
    isTimelineId(row.lastEventId) &&
    (row.sourceTimelineId === undefined ||
      isTimelineId(row.sourceTimelineId)) &&
    (row.writeState === 'OPEN' || row.writeState === 'CLOSED') &&
    [row.controlVersion, row.fenceVersion].every(
      (version) =>
        typeof version === 'number' &&
        Number.isSafeInteger(version) &&
        version >= 0 &&
        version <= MAX_CONTROL_VERSION,
    ) &&
    [row.createdAt, row.updatedAt].every(
      (date) => date instanceof Date && Number.isFinite(date.getTime()),
    )
  );
}
