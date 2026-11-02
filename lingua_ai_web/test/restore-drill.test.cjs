const { test } = require('node:test');
const assert = require('node:assert/strict');
const { origin, A: userId, ownerKey, deferred } = require('./helpers/browserContexts.cjs');
const { metadata, id: A } = require('./helpers/timelineFixture.cjs');
const B = '22222222-2222-4222-8222-222222222222';
const owner = `registered_${userId}`, key = `linguaai_online_intents_${owner}`;
async function discover(tab, id) {
  tab.fetchCompatibility = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ...metadata, dataTimelineId: id }) });
  await tab.timeline.refresh();
}
async function ready() {
  const o = origin({ confirmed: false }), tab = o.tab(); await tab.install(); await discover(tab, A); return { o, tab };
}
const payload = kind => kind === 'ai-clear' ? { targetLanguage: 'en' } : { learningLanguage: 'en', text: 'synthetic draft' };
for (const kind of ['ai-clear', 'community-create']) {
  test(`10E browser restart + restored B preserves ${kind} A identity/cache isolation; explicit B new ID`, async () => {
    const { o, tab } = await ready(), intents = tab.load('utils/onlineIntents.ts');
    const old = await intents.prepareOnlineIntent(kind, 'en', payload(kind));
    const saved = JSON.stringify(JSON.parse(o.values.get(key)).intents[0]);
    const cache = tab.load('utils/communityFeedCache.ts'), query = cache.communityQuery(owner);
    cache.writeCommunityFeed(query, { items: [], page: 1, limit: 50, total: 0, hasMore: false });
    tab.close();
    const restarted = o.tab(); await restarted.install(); await discover(restarted, B);
    assert.equal(restarted.timeline.snapshot().status, 'CHANGED');
    assert.equal(restarted.load('utils/communityFeedCache.ts').readCommunityFeed(query), undefined);
    await assert.rejects(restarted.load('api/intentRecovery.ts').replayOnlineIntent(old.id));
    assert.equal(restarted.requests.length, 0);
    assert.equal(JSON.stringify(JSON.parse(o.values.get(key)).intents[0]), saved);
    restarted.timeline.resumeAfterRefresh();
    const fresh = await restarted.load('utils/onlineIntents.ts').prepareOnlineIntent(kind, 'en', payload(kind));
    assert.notEqual(fresh.id, old.id); assert.equal(fresh.dataTimelineId, B);
    assert.equal(JSON.stringify(JSON.parse(o.values.get(key)).intents[0]), saved);
    restarted.close();
  });
  for (const error of [false, true]) test(`10E in-flight ${kind} A ${error ? 'error' : 'success'} after B cannot acknowledge/relabel`, async () => {
    const { o, tab } = await ready(), started = deferred(), response = deferred();
    const old = await tab.load('utils/onlineIntents.ts').prepareOnlineIntent(kind, 'en', payload(kind));
    tab.dispatch = () => { started.resolve(); return response.promise; };
    const pending = tab.load('api/intentRecovery.ts').replayOnlineIntent(old.id), rejected = assert.rejects(pending);
    await started.promise; await discover(tab, B);
    const auth = o.values.get('linguaai_session_v1');
    if (error) response.reject({ response: { status: 401, data: {} } });
    else response.resolve({ data: kind === 'ai-clear' ? { success: true } : { _id: 'late-A-post' } });
    await rejected;
    const stored = JSON.parse(o.values.get(key)).intents.find(item => item.id === old.id);
    assert.equal(stored.dataTimelineId, A); assert.equal(stored.state, 'pending');
    assert.equal(o.values.get('linguaai_session_v1'), auth);
    assert.equal(tab.timeline.snapshot().status, 'CHANGED'); tab.close();
  });
}
test('10E browser legacy evidence survives first B confirmation without stamping or dispatch', async () => {
  const o = origin({ confirmed: false }), tab = o.tab(); await tab.install();
  const legacy = { schemaVersion: 1, id: 'legacy-clear-10e', ownerNamespace: owner, protocol: 1, kind: 'ai-clear', language: 'en', payload: payload('ai-clear'), state: 'pending', attempts: 0, nextAttemptAt: 0 };
  o.values.set(key, JSON.stringify({ schemaVersion: 1, ownerNamespace: owner, intents: [legacy] }));
  const action = { schemaVersion: 1, id: 'legacy-progress-10e', ownerNamespace: owner, clientProtocolRevision: 1, type: 'complete-lesson', payload: { lessonId: 'one', score: 80, progressEpoch: 5 }, createdAt: new Date().toISOString() };
  o.values.set(ownerKey(owner), JSON.stringify({ schemaVersion: 2, ownerNamespace: owner, actions: [action], tempIds: {}, startedCreates: [] }));
  await discover(tab, B); await tab.queue.processOfflineQueue(userId, true);
  await assert.rejects(tab.load('api/intentRecovery.ts').replayOnlineIntent(legacy.id));
  assert.equal(tab.requests.length, 0); assert.deepEqual(JSON.parse(o.values.get(key)).intents[0], legacy);
  assert.equal(tab.timeline.provenance(tab.queue.getOfflineQueue()[0]), 'LEGACY_UNVERIFIED'); tab.close();
});
