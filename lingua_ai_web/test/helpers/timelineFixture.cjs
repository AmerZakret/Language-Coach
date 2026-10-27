// Isolated pre-timeline domain fixtures use confirmed synthetic server metadata.
// timeline.test.cjs exercises the real discovery, locks, storage and HTTP boundary.
const id = '11111111-1111-4111-8111-111111111111';
exports.id = id;
exports.metadata = { dataTimelineId: id, timelineWriteState: 'OPEN', currentProtocolRevision: 2, minimumMutationRevision: 1, policy: 'ALLOW_LEGACY', buildId: 'fixture' };
exports.envelope = payload => JSON.stringify({ schemaVersion: 1, dataTimelineId: id, payload });
exports.isolatedTimeline = { dataTimeline: { capture: () => ({ dataTimelineId: id }), context: () => ({ dataTimelineId: id, revision: 0 }), isContext: () => true, snapshot: () => ({ status: 'CURRENT', lastConfirmed: id, writeState: 'OPEN', revision: 0 }), ensureDiscovered: async () => {}, assertDispatch() {}, assertRead() {}, confirmRead() {}, refresh: async () => exports.metadata, provenance: operation => operation.dataTimelineId ? 'CURRENT' : 'LEGACY_UNVERIFIED', handleFailure() {}, reread() {} }, TimelineRecoveryRequired: class extends Error {}, isDataTimelineId: value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value) };
