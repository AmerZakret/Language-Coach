const { test } = require('node:test');
const assert = require('node:assert/strict');
const { origin, A: userId, B: otherId, user, ownerKey, deferred, tick } = require('./helpers/browserContexts.cjs');
const { metadata, id: A, envelope } = require('./helpers/timelineFixture.cjs');
const B = '22222222-2222-4222-8222-222222222222';
const owner = `registered_${userId}`;
const journalKey = `linguaai_online_intents_${owner}`;
const payload = { message: 'saved prompt', language: 'en', targetLanguage: 'en' };
const feed = { items: [], page: 1, limit: 50, total: 0, hasMore: false };
async function discover(tab, id) {
  tab.fetchCompatibility = async () => ({ ok: true, json: async () => ({ ...metadata, dataTimelineId: id }) });
  await tab.timeline.refresh();
}
async function ready() {
  const o = origin({ confirmed: false }), tab = o.tab();
  await tab.install(); await discover(tab, A);
  return { o, tab };
}
async function currentB(tab) {
  await discover(tab, B);
  tab.timeline.resumeAfterRefresh();
}

test('10C bootstrap discovers and persists canonical B with no-store; reads have no mutation header', async () => {
  const o = origin({ confirmed: false }), tab = o.tab(); await tab.install();
  assert.equal(tab.timeline.snapshot().status, 'UNKNOWN');
  tab.fetchCompatibility = async (url, config) => {
    assert.equal(url, 'http://localhost:3000/compatibility');
    assert.equal(config.cache, 'no-store'); assert.equal(config.credentials, 'omit');
    return { ok: true, json: async () => ({ ...metadata, dataTimelineId: B }) };
  };
  await tab.timeline.refresh();
  assert.equal(tab.timeline.snapshot().status, 'CURRENT');
  assert.equal(tab.timeline.snapshot().lastConfirmed, B);
  assert.equal(JSON.parse(o.values.get(tab.timeline.storageKey)).dataTimelineId, B);
  await tab.client.get('/community/posts');
  assert.equal(tab.requests[0].headers['X-Client-Protocol'], '2');
  assert.equal(tab.requests[0].headers['X-Data-Timeline'], undefined);
  assert.ok(!o.values.get(tab.timeline.storageKey).includes('token'));
  tab.close();
});
for (const invalid of [undefined, null, 'bad', A.toUpperCase(), '11111111-1111-1111-8111-111111111111']) {
  // This fixture contains letters so upper-case is independently invalid.
  const value = invalid === A.toUpperCase() ? 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' : invalid;
  test(`10C missing/malformed discovery fails closed: ${value}`, async () => {
    const o = origin({ confirmed: false }), tab = o.tab(); await tab.install();
    await discover(tab, value);
    assert.equal(tab.timeline.snapshot().status, 'UNAVAILABLE');
    await assert.rejects(tab.queue.pushToOfflineQueue('review-flashcard', { cardId: 'card', score: 4 }, owner));
    assert.equal(tab.requests.length, 0); tab.close();
  });
}
test('10C known offline timeline is usable; never-known offline timeline cannot create replayable work', async () => {
  const { o, tab } = await ready(); tab.close();
  const reopened = o.tab(); reopened.navigator.onLine = false;
  await reopened.queue.pushToOfflineQueue('review-flashcard', { cardId: 'card', score: 4 }, owner);
  assert.equal(reopened.queue.getOfflineQueue()[0].dataTimelineId, A);
  const unknown = origin({ confirmed: false }).tab(); await unknown.install(); unknown.navigator.onLine = false;
  await assert.rejects(unknown.queue.pushToOfflineQueue('review-flashcard', { cardId: 'card', score: 4 }, owner));
  assert.equal(unknown.queue.getOfflineQueue().length, 0); reopened.close(); unknown.close();
});
test('10C first confirmation never stamps or dispatches legacy queue and intent evidence', async () => {
  const o = origin({ confirmed: false }), tab = o.tab(); await tab.install();
  const legacy = { id: 'legacy-review', schemaVersion: 1, ownerNamespace: owner, type: 'review-flashcard', payload: { cardId: 'card', score: 4 }, createdAt: new Date().toISOString(), clientProtocolRevision: 1 };
  const intent = { schemaVersion: 1, id: 'legacy-clear', ownerNamespace: owner, protocol: 1, kind: 'ai-clear', language: 'en', payload: { targetLanguage: 'en' }, state: 'pending', attempts: 0, nextAttemptAt: 0 };
  o.values.set(ownerKey(owner), JSON.stringify({ schemaVersion: 2, ownerNamespace: owner, actions: [legacy], tempIds: {}, startedCreates: [] }));
  o.values.set(journalKey, JSON.stringify({ schemaVersion: 1, ownerNamespace: owner, intents: [intent] }));
  await discover(tab, B);
  await tab.queue.processOfflineQueue(userId, true);
  await assert.rejects(tab.load('api/intentRecovery.ts').replayOnlineIntent(intent.id));
  assert.deepEqual(JSON.parse(JSON.stringify(tab.queue.getOfflineQueue()[0])), legacy);
  assert.deepEqual(JSON.parse(o.values.get(journalKey)).intents[0], intent);
  assert.equal(tab.timeline.provenance(legacy), 'LEGACY_UNVERIFIED');
  assert.equal(tab.requests.length, 0); tab.close();
});
for (const type of ['complete-lesson', 'reset-progress', 'review-flashcard', 'delete-flashcard']) test(`10C A to B blocks ${type} even with identical progress epochs; fresh B gets new ID`, async () => {
  const { o, tab } = await ready();
  const operationPayload = { lessonId: 'lesson', score: 4, progressEpoch: 0, expectedEpoch: 0, cardId: 'card' };
  await tab.queue.pushToOfflineQueue(type, operationPayload, owner);
  const original = tab.queue.getOfflineQueue()[0];
  const storage = tab.load('utils/progressStorage.ts'); storage.acknowledgeProgressEpoch(owner, 0);
  await discover(tab, B);
  assert.equal(tab.timeline.snapshot().status, 'CHANGED');
  assert.equal(await tab.queue.processOfflineQueue(userId, true), false);
  assert.equal(tab.requests.length, 0);
  assert.equal(tab.queue.getOfflineQueue()[0].dataTimelineId, A);
  assert.equal(JSON.stringify(tab.queue.getOfflineQueue()[0].payload), JSON.stringify(original.payload));
  tab.timeline.resumeAfterRefresh();
  await tab.client.get(type.includes('flashcard') ? '/flashcards/all' : `/progress/${userId}`);
  storage.acknowledgeProgressEpoch(owner, 0);
  await tab.queue.pushToOfflineQueue(type, operationPayload, owner);
  const fresh = tab.queue.getOfflineQueue().find(item => item.dataTimelineId === B);
  assert.notEqual(fresh.id, original.id);
  await tab.queue.processOfflineQueue(userId, true);
  const writes = tab.requests.filter(req => req.method !== 'get');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].headers['X-Data-Timeline'], B);
  assert.equal(tab.queue.getOfflineQueue().find(item => item.id === original.id).dataTimelineId, A);
  assert.ok(o.values.get(tab.timeline.advertisementKey)); tab.close();
});
for (const kind of ['community-create', 'ai-send', 'ai-clear']) test(`10C ${kind}: A preserved, retry cannot relabel; explicit B re-entry uses new ID`, async () => {
  const { o, tab } = await ready(); const intents = tab.load('utils/onlineIntents.ts');
  const body = kind === 'community-create' ? { learningLanguage: 'en', text: 'post' } : kind === 'ai-send' ? payload : { targetLanguage: 'en' };
  const original = await intents.prepareOnlineIntent(kind, 'en', body);
  await currentB(tab);
  await assert.rejects(tab.load('api/intentRecovery.ts').replayOnlineIntent(original.id));
  assert.equal(tab.requests.length, 0);
  assert.equal(JSON.parse(o.values.get(journalKey)).intents[0].dataTimelineId, A);
  await assert.rejects(intents.prepareOnlineIntent(kind, 'en', body, original.id));
  const fresh = await intents.prepareOnlineIntent(kind, 'en', body);
  assert.notEqual(fresh.id, original.id); assert.equal(fresh.dataTimelineId, B);
  // Discard is selected, owner scoped, and local only, especially for old AI clear.
  const before = tab.requests.length;
  await intents.discardOnlineIntent(original.id);
  assert.equal(tab.requests.length, before);
  assert.equal(JSON.parse(o.values.get(journalKey)).intents.length, 1);
  assert.equal(JSON.parse(o.values.get(journalKey)).intents[0].id, fresh.id); tab.close();
});
test('10C stale/legacy read caches rejected; local guest and immutable static content survive', async () => {
  const { o, tab } = await ready(), cache = tab.load('utils/communityFeedCache.ts');
  const query = cache.communityQuery(owner);
  cache.writeCommunityFeed(query, feed);
  const saved = o.values.get(cache.communityCacheKey(query));
  o.values.set('flashcards_all_guest_English', '["local work"]');
  o.values.set('immutable_reference_fixture', 'static');
  await tab.queue.pushToOfflineQueue('delete-flashcard', { cardId: 'card' }, owner);
  const journal = o.values.get(ownerKey(owner));
  await currentB(tab);
  o.values.set(cache.communityCacheKey(query), saved);
  assert.equal(cache.readCommunityFeed(query), undefined);
  o.values.set(cache.communityCacheKey(query), JSON.stringify({ schemaVersion: 2, ...query, payload: feed }));
  assert.equal(cache.readCommunityFeed(query), undefined);
  assert.equal(o.values.get('flashcards_all_guest_English'), '["local work"]');
  assert.equal(o.values.get('immutable_reference_fixture'), 'static');
  assert.equal(o.values.get(ownerKey(owner)), journal);
  tab.close();
});
for (const path of ['/community/posts', '/ai-coach/history', `/progress/${userId}`, '/flashcards/all']) test(`10C central response fence ignores late A response: ${path}`, async () => {
  const { o, tab } = await ready(), started = deferred(), pending = deferred();
  tab.dispatch = () => { started.resolve(); return pending.promise; };
  const work = tab.client.get(path); const rejected = assert.rejects(work);
  await started.promise; await currentB(tab);
  const cache = tab.load('utils/communityFeedCache.ts'), query = cache.communityQuery(owner);
  cache.writeCommunityFeed(query, feed);
  const before = o.values.get(cache.communityCacheKey(query));
  pending.resolve({ data: { stale: 'A' } }); await rejected;
  assert.equal(o.values.get(cache.communityCacheKey(query)), before); tab.close();
});
test('10C AI send response after B cannot acknowledge A or inject a duplicate conversation item', async () => {
  const { o, tab } = await ready(), started = deferred(), pending = deferred();
  tab.dispatch = () => { started.resolve(); return pending.promise; };
  const api = tab.load('api/aiCoachApi.ts'), work = api.sendMessage(payload), rejected = assert.rejects(work);
  await started.promise; const old = JSON.parse(o.values.get(journalKey)).intents[0];
  await currentB(tab);
  pending.resolve({ data: { reply: 'old reply' } }); await rejected;
  const retained = JSON.parse(o.values.get(journalKey)).intents[0];
  assert.equal(retained.id, old.id); assert.equal(retained.dataTimelineId, A);
  assert.equal(retained.state, 'pending'); assert.equal(retained.result, undefined);
  tab.close();
});
test('10C cross-tab B advertisement reread after owner lock blocks A drain without touching auth or owners', async () => {
  const { o, tab } = await ready(), other = o.tab(); await discover(other, A);
  await tab.queue.pushToOfflineQueue('review-flashcard', { cardId: 'card', score: 4 }, owner);
  const journal = o.values.get(ownerKey(owner)), auth = o.values.get('linguaai_session_v1');
  o.values.set(ownerKey(`registered_${otherId}`), 'other owner evidence');
  const acquired = deferred(), release = deferred();
  const held = other.navigator.locks.request(`linguaai:queue:drain:${owner}`, async () => { acquired.resolve(); await release.promise; });
  await acquired.promise;
  const drain = tab.queue.processOfflineQueue(userId, true); await tick();
  await discover(other, B);
  release.resolve(); await held; assert.equal(await drain, false);
  assert.equal(tab.timeline.snapshot().status, 'CHANGED'); assert.equal(tab.requests.length, 0);
  assert.equal(o.values.get(ownerKey(owner)), journal);
  assert.equal(o.values.get('linguaai_session_v1'), auth);
  assert.equal(o.values.get(ownerKey(`registered_${otherId}`)), 'other owner evidence');
  tab.close(); other.close();
});
test('10C stale compatibility A response cannot undo a B advertisement', async () => {
  const { o, tab } = await ready(), pending = deferred(), started = deferred();
  tab.fetchCompatibility = async () => { started.resolve(); return pending.promise; };
  const refresh = tab.timeline.refresh(); await started.promise;
  o.values.set(tab.timeline.advertisementKey, JSON.stringify({ schemaVersion: 1, dataTimelineId: B, notice: 'newer-tab' }));
  pending.resolve({ ok: true, json: async () => metadata }); await refresh;
  assert.equal(tab.timeline.snapshot().status, 'CHANGED');
  assert.throws(() => tab.timeline.capture()); tab.close();
});
for (const [status, code, category] of [[409, 'SERVER_TIMELINE_CHANGED', 'timeline'], [428, 'SERVER_TIMELINE_REQUIRED', 'provenance'], [426, 'CLIENT_PROTOCOL_UNSUPPORTED', 'compatibility'], [503, 'BACKEND_NOT_READY', 'maintenance'], [401, undefined, 'authentication']]) {
  test(`10C error ${status} preserves operation and separates ${category}`, async () => {
    const { o, tab } = await ready();
    await tab.queue.pushToOfflineQueue('review-flashcard', { cardId: 'card', score: 4 }, owner);
    const original = tab.queue.getOfflineQueue()[0], auth = o.values.get('linguaai_session_v1');
    tab.dispatch = async () => { throw { response: { status, data: { code } } }; };
    assert.equal(await tab.queue.processOfflineQueue(userId, true), false);
    const stored = JSON.parse(o.values.get(ownerKey(owner))).actions[0];
    assert.equal(stored.id, original.id); assert.equal(stored.dataTimelineId, A);
    assert.equal(tab.load('utils/syncRetryPolicy.ts').classifySyncFailure({ response: { status, data: { code } } }).category, category);
    if (status !== 401) assert.equal(o.values.get('linguaai_session_v1'), auth);
    tab.close();
  });
}
for (const id of [A, B]) test(`10C reconnect compatibility precedes drain: ${id === A ? 'same' : 'changed'}`, async () => {
  const { tab } = await ready(), events = [];
  await tab.queue.pushToOfflineQueue('review-flashcard', { cardId: 'card', score: 4 }, owner);
  tab.fetchCompatibility = async () => { events.push('compatibility'); return { ok: true, json: async () => ({ ...metadata, dataTimelineId: id }) }; };
  tab.dispatch = async () => { events.push('mutation'); return { data: {} }; };
  await tab.queue.processOfflineQueue(userId, true);
  assert.equal(events[0], 'compatibility');
  assert.equal(events.includes('mutation'), id === A); tab.close();
});
test('10C central mutation inventory refuses missing provenance for every durable route; reads remain header-free', async () => {
  const { tab } = await ready();
  tab.dispatch = async () => ({ data: {} });
  const routes = [['post', '/auth/register'], ['post', '/auth/guest'], ['patch', '/users/profile'], ['post', `/progress/${userId}/complete-lesson`], ['delete', `/progress/${userId}`], ['post', '/flashcards'], ['put', '/flashcards/card'], ['delete', '/flashcards/card'], ['put', '/flashcards/card/review'], ['post', '/community/posts'], ['put', '/community/posts/post'], ['delete', '/community/posts/post'], ['post', '/community/posts/post/like'], ['post', '/ai-coach/chat'], ['delete', '/ai-coach/clear']];
  // Source-execute the server inventory, so adding a durable route requires client coverage.
  const fs = require('node:fs'), path = require('node:path'), ts = require('typescript'), vm = require('node:vm');
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../../lingua_ai_backend/src/compatibility/protocol-contract.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports });
  const expected = Array.from(module.exports.PUBLIC_WRITER_INVENTORY).filter(row => row[2] === 'FENCED').map(row => row.slice(0, 2).join(' ')).sort();
  const actual = routes.map(([method, route]) => method.toUpperCase() + ' ' + route.replace(userId, ':userId').replace('/flashcards/card', '/flashcards/:id').replace('/community/posts/post', '/community/posts/:id')).sort();
  assert.deepEqual(actual, expected);
  for (const [method, path] of routes) {
    const send = config => ['post', 'put', 'patch'].includes(method) ? tab.client[method](path, {}, config) : tab.client[method](path, config);
    await assert.rejects(send({}));
    await send(tab.timeline.capture());
    const request = tab.requests.at(-1);
    assert.equal(request.headers['X-Data-Timeline'], A);
    assert.equal(request.headers['X-Client-Protocol'], '2');
  }
  assert.equal(tab.requests.length, routes.length); tab.close();
});

test('10C same timeline refresh is idempotent for caches, operation IDs and payloads', async () => {
  const { o, tab } = await ready(), cache = tab.load('utils/communityFeedCache.ts'), query = cache.communityQuery(owner);
  cache.writeCommunityFeed(query, feed);
  await tab.queue.pushToOfflineQueue('review-flashcard', { cardId: 'card', score: 4 }, owner);
  const snapshot = o.values.get(cache.communityCacheKey(query)), journal = o.values.get(ownerKey(owner)), revision = tab.timeline.snapshot().revision;
  await tab.timeline.refresh(); await tab.timeline.refresh();
  assert.equal(tab.timeline.snapshot().revision, revision);
  assert.equal(o.values.get(cache.communityCacheKey(query)), snapshot);
  assert.equal(o.values.get(ownerKey(owner)), journal); tab.close();
});
test('10C stored retry context cannot adopt B when the same live mutation ID is retried', async () => {
  const { tab } = await ready(), started = deferred(), pending = deferred();
  tab.dispatch = () => { started.resolve(); return pending.promise; };
  const api = tab.load('api/communityApi.ts');
  const work = api.deleteCommunityPost('post', 0, 'old-delete'), rejected = assert.rejects(work);
  await started.promise;
  assert.equal(tab.requests[0].headers['X-Data-Timeline'], A);
  await currentB(tab); pending.reject({ response: { status: 503 } }); await rejected;
  await assert.rejects(api.deleteCommunityPost('post', 0, 'old-delete'));
  assert.equal(tab.requests.length, 1); tab.close();
});
test('10C corrupt timeline-bearing queues/intents retain exact raw evidence and never autofill', async () => {
  for (const journal of [false, true]) {
    const { o, tab } = await ready();
    if (journal) await tab.load('utils/onlineIntents.ts').prepareOnlineIntent('ai-clear', 'en', { targetLanguage: 'en' });
    else await tab.queue.pushToOfflineQueue('review-flashcard', { cardId: 'card', score: 4 }, owner);
    const key = journal ? journalKey : ownerKey(owner), state = JSON.parse(o.values.get(key));
    delete (journal ? state.intents[0] : state.actions[0]).dataTimelineId;
    const corrupt = JSON.stringify(state); o.values.set(key, corrupt);
    if (journal) await assert.rejects(tab.load('api/intentRecovery.ts').replayOnlineIntent(state.intents[0].id));
    else await assert.rejects(tab.queue.processOfflineQueue(userId, true));
    assert.equal(o.values.get(key), corrupt); assert.equal(tab.requests.length, 0); tab.close();
  }
});
test('10C fresh B clear dispatches a new B ID while selected A discard leaves another owner intact', async () => {
  const { o, tab } = await ready(), intents = tab.load('utils/onlineIntents.ts');
  const old = await intents.prepareOnlineIntent('ai-clear', 'en', { targetLanguage: 'en' });
  const otherKey = `linguaai_online_intents_registered_${otherId}`;
  o.values.set(otherKey, 'other owner evidence');
  await currentB(tab);
  tab.dispatch = async req => ({ data: req.method === 'get' ? [] : { success: true } });
  await tab.client.get('/ai-coach/history');
  await tab.load('api/aiCoachApi.ts').clearChatHistory('en');
  const request = tab.requests.find(req => req.method === 'delete');
  assert.notEqual(request.headers['X-Idempotency-Key'], old.id);
  assert.equal(request.headers['X-Data-Timeline'], B);
  assert.equal(JSON.parse(o.values.get(journalKey)).intents[0].id, old.id);
  const count = tab.requests.length; await intents.discardOnlineIntent(old.id);
  assert.equal(tab.requests.length, count); assert.equal(o.values.get(otherKey), 'other owner evidence'); tab.close();
});

test('10C profile installation rereads timeline inside the auth lock and cannot stamp an A result B', async () => {
  const { o, tab } = await ready(), acquired = deferred(), release = deferred();
  const before = o.values.get('linguaai_session_v1'), record = tab.authStorage.readStoredSession();
  const held = tab.navigator.locks.request('linguaai:auth:session', async () => { acquired.resolve(); await release.promise; });
  await acquired.promise;
  const installation = tab.authStorage.replaceStoredSession({ ...user(), name: 'late A profile' }, record.token, record.revision);
  await tick(); await currentB(tab); release.resolve(); await held;
  assert.equal(await installation, false);
  assert.equal(o.values.get('linguaai_session_v1'), before); tab.close();
});

test('10C provenance failure pauses the selected record without a retry loop, latest-timeline fill or permanent failure', async () => {
  const { tab } = await ready();
  await tab.queue.pushToOfflineQueue('review-flashcard', { cardId: 'card', score: 4 }, owner);
  const original = tab.queue.getOfflineQueue()[0];
  tab.dispatch = async () => { throw { response: { status: 409, data: { code: 'RECEIPT_TIMELINE_UNVERIFIED' } } }; };
  assert.equal(await tab.queue.processOfflineQueue(userId, true), false);
  assert.equal(await tab.queue.processOfflineQueue(userId, true), false);
  assert.equal(tab.requests.length, 1);
  const saved = tab.queue.getOfflineQueue()[0];
  assert.equal(saved.id, original.id); assert.equal(saved.dataTimelineId, A);
  assert.equal(saved.lastErrorCategory, 'timeline'); assert.equal(saved.failedAt, undefined);
  await tab.queue.discardOfflineAction(saved.id);
  assert.equal(tab.requests.length, 1); tab.close();
});

for (const [status, code] of [[409, 'SERVER_TIMELINE_CHANGED'], [428, 'SERVER_TIMELINE_REQUIRED'], [503, 'BACKEND_NOT_READY'], [426, 'CLIENT_PROTOCOL_UNSUPPORTED'], [401, undefined]]) {
  test(`10C late A error ${status} cannot alter B cache, maintenance, protocol or auth state`, async () => {
    const { o, tab } = await ready(), started = deferred(), pending = deferred();
    tab.dispatch = () => { started.resolve(); return pending.promise; };
    const work = tab.client.get('/community/posts'), rejected = assert.rejects(work);
    await started.promise; await currentB(tab);
    const cache = tab.load('utils/communityFeedCache.ts'), query = cache.communityQuery(owner);
    cache.writeCommunityFeed(query, feed);
    const state = tab.timeline.snapshot(), snapshot = o.values.get(cache.communityCacheKey(query)), auth = o.values.get('linguaai_session_v1');
    pending.reject({ response: { status, data: { code } } }); await rejected;
    assert.equal(tab.timeline.snapshot(), state);
    assert.equal(o.values.get(cache.communityCacheKey(query)), snapshot);
    assert.equal(o.values.get('linguaai_session_v1'), auth);
    assert.equal(tab.load('utils/releaseCompatibility.ts').releaseCompatibility.snapshot().updateRequired, false); tab.close();
  });
}
test('10C a stale tab learning B preserves read snapshots already refreshed by another tab on B', async () => {
  const { o, tab } = await ready(), stale = o.tab(); await discover(stale, A);
  await currentB(tab);
  const cache = tab.load('utils/communityFeedCache.ts'), query = cache.communityQuery(owner);
  cache.writeCommunityFeed(query, feed);
  const snapshot = o.values.get(cache.communityCacheKey(query));
  stale.timeline.reread();
  assert.equal(stale.timeline.snapshot().status, 'CHANGED');
  assert.equal(o.values.get(cache.communityCacheKey(query)), snapshot);
  await discover(stale, B);
  assert.equal(o.values.get(cache.communityCacheKey(query)), snapshot); tab.close(); stale.close();
});

test('10C direct reset retries retain A provenance; fresh B reset uses a new ID and current context', async () => {
  const { tab } = await ready(), api = tab.load('api/progressApi.ts');
  await api.resetProgressInBackend(userId, 0, 'A-direct-reset');
  assert.equal(tab.requests[0].headers['X-Data-Timeline'], A);
  await currentB(tab); await tab.client.get(`/progress/${userId}`);
  const before = tab.requests.length;
  await assert.rejects(api.resetProgressInBackend(userId, 0, 'A-direct-reset'));
  assert.equal(tab.requests.length, before);
  await api.resetProgressInBackend(userId, 0, 'B-fresh-reset');
  assert.equal(tab.requests.at(-1).headers['X-Data-Timeline'], B);
  assert.equal(tab.requests.at(-1).headers['X-Idempotency-Key'], 'B-fresh-reset'); tab.close();
});
