const { test } = require('node:test');
const assert = require('node:assert/strict');
const { origin, A, B, user, deferred } = require('./helpers/browserContexts.cjs');
const owner = `registered_${A}`;
const journalKey = `linguaai_online_intents_${owner}`;
const send = { message: 'hello', language: 'en', targetLanguage: 'en' };
const error = status => ({ response: { status, data: { code: status === 426 ? 'CLIENT_PROTOCOL_UNSUPPORTED' : 'IDEMPOTENCY_CONFLICT' } } });
function ready(o) { const tab = o.tab(); return tab.install().then(() => tab); }
function advance(o) { o.now = Date.now() + 300001; }

const post = id => ({ _id: id, learningLanguage: 'en', text: 'post' });
const reply = id => ({ reply: 'reply', userMessage: { _id: `user-${id}`, role: 'user', message: 'hello' },
  assistantMessage: { _id: `assistant-${id}`, role: 'assistant', message: 'reply' } });

for (const kind of ['community-create', 'ai-send', 'ai-clear']) test(`9D ${kind}: commit/lost ack/reload replays original persisted ID and payload once`, async () => {
  const o = origin(), tab = await ready(o), receipts = new Map();
  let mutations = 0, providerCalls = 0;
  const server = async req => {
    const stored = JSON.parse(o.values.get(journalKey)).intents[0];
    assert.equal(stored.id, req.headers['X-Idempotency-Key']);
    assert.equal(stored.protocol, 1); assert.equal(stored.ownerNamespace, owner);
    assert.equal(req.headers['X-Client-Protocol'], '1');
    assert.ok(!JSON.stringify(stored).includes(`token-${A}`));
    if (!receipts.has(stored.id)) {
      mutations++; if (kind === 'ai-send') providerCalls++;
      receipts.set(stored.id, kind === 'community-create' ? post('one-post') : kind === 'ai-send' ? reply('one-pair') : { success: true });
    }
    throw error(503);
  };
  tab.dispatch = server;
  const recovery = tab.load('api/intentRecovery.ts');
  const payload = kind === 'community-create' ? { learningLanguage: 'en', text: 'post' } : kind === 'ai-send' ? send : { targetLanguage: 'en' };
  await assert.rejects(recovery.durableMutation(kind, 'en', payload));
  const before = JSON.parse(o.values.get(journalKey)).intents[0];
  assert.equal(tab.requests.length, 2); tab.close(); advance(o);
  const reopened = o.tab(); reopened.session.observeRenderedSession(reopened.authStorage.readStoredSession());
  reopened.dispatch = async req => {
    assert.equal(req.headers['X-Idempotency-Key'], before.id);
    return { data: receipts.get(before.id) };
  };
  await reopened.load('api/intentRecovery.ts').recoverOnlineIntents(kind.startsWith('ai-') ? 'ai' : 'community', 'en');
  assert.equal(mutations, 1); assert.equal(providerCalls, kind === 'ai-send' ? 1 : 0);
  assert.equal(JSON.parse(o.values.get(journalKey)).intents.length, 0);
  reopened.close();
});

test('9D owner replacement cannot dispatch or acknowledge another owner; switching back resumes same ID', async () => {
  const o = origin(), tab = await ready(o), started = deferred(), response = deferred();
  tab.dispatch = () => { started.resolve(); return response.promise; };
  const pending = tab.load('api/intentRecovery.ts').durableMutation('ai-send', 'en', send);
  const assertion = assert.rejects(pending);
  await started.promise; const id = JSON.parse(o.values.get(journalKey)).intents[0].id;
  await tab.install(user(B)); response.resolve({ data: reply(id) }); await assertion;
  await tab.load('api/intentRecovery.ts').recoverOnlineIntents('ai', 'en');
  assert.equal(tab.requests.length, 1); assert.equal(JSON.parse(o.values.get(journalKey)).intents[0].id, id);
  await tab.install(user(A)); tab.dispatch = async req => ({ data: reply(req.headers['X-Idempotency-Key']) });
  await tab.load('api/intentRecovery.ts').recoverOnlineIntents('ai', 'en');
  assert.equal(tab.requests[1].headers.Authorization, `Bearer token-${A}`); tab.close();
});

for (const status of [401, 426, 429, 503, 409, 400]) test(`9D HTTP ${status} preserves identity with explicit pause/backoff/failed classification`, async () => {
  const o = origin(), tab = await ready(o);
  tab.dispatch = async () => { throw error(status); };
  await assert.rejects(tab.load('api/intentRecovery.ts').durableMutation('ai-clear', 'en', { targetLanguage: 'en' }));
  const intent = JSON.parse(o.values.get(journalKey)).intents[0];
  assert.equal(intent.state, [409, 400].includes(status) ? 'failed' : 'pending');
  if ([429, 503].includes(status)) assert.ok(intent.nextAttemptAt > Date.now());
  if (status === 426) {
    assert.equal(tab.load('utils/releaseCompatibility.ts').releaseCompatibility.snapshot().updateRequired, true);
    const before = o.values.get(journalKey);
    await tab.load('api/intentRecovery.ts').recoverOnlineIntents('ai', 'en');
    assert.equal(o.values.get(journalKey), before);
  }
  assert.equal(intent.protocol, 1); assert.equal(typeof intent.id, 'string');
  assert.ok(!o.values.get(journalKey).includes(`token-${A}`)); tab.close();
});

test('9D storage failure, corrupt schema and unsupported Web Locks all fail before first request; evidence survives', async () => {
  for (const scenario of ['quota', 'corrupt', 'locks']) {
    const o = origin(), tab = o.tab(scenario !== 'locks');
    if (scenario === 'locks') {
      const seed = o.tab(); await seed.install(); seed.close(); tab.session.observeRenderedSession(tab.authStorage.readStoredSession());
    } else await tab.install();
    if (scenario === 'corrupt') o.values.set(journalKey, '{corrupt evidence');
    if (scenario === 'quota') {
      const original = tab.localStorage.setItem;
      tab.localStorage.setItem = (key, value) => { if (key === journalKey) throw new Error('quota'); original(key, value); };
    }
    await assert.rejects(tab.load('api/intentRecovery.ts').durableMutation('ai-send', 'en', send));
    assert.equal(tab.requests.length, 0);
    if (scenario === 'corrupt') assert.equal(o.values.get(journalKey), '{corrupt evidence'); tab.close();
  }
});

test('9D a different draft never replaces ambiguous work; capacity does not evict; acknowledgement failure retains identity', async () => {
  const o = origin(), tab = await ready(o), store = tab.load('utils/onlineIntents.ts');
  const first = await store.prepareOnlineIntent('ai-send', 'en', send);
  await assert.rejects(store.prepareOnlineIntent('ai-send', 'en', { ...send, message: 'different' }));
  assert.equal((await store.listOnlineIntents())[0].id, first.id);
  await assert.rejects(store.runOnlineIntent(first.id, async () => reply(first.id), () => { throw new Error('local acceptance failed'); }));
  assert.equal((await store.listOnlineIntents())[0].state, 'acknowledged');
  let network = 0;
  await store.runOnlineIntent(first.id, async () => { network++; }, result => { assert.equal(result.reply, 'reply'); });
  assert.equal(network, 0); assert.equal((await store.listOnlineIntents()).length, 0);
  for (const language of ['en', 'de', 'es', 'fr', 'ar']) await store.prepareOnlineIntent('community-create', language, { learningLanguage: language, text: 'post' });
  for (const language of ['en', 'de', 'es']) await store.prepareOnlineIntent('ai-clear', language, { targetLanguage: language });
  const before = o.values.get(journalKey);
  await assert.rejects(store.prepareOnlineIntent('ai-clear', 'fr', { targetLanguage: 'fr' }));
  assert.equal(o.values.get(journalKey), before); tab.close();
});

test('9D two tabs recover one operation once and a disposed document cannot erase it', async () => {
  const o = origin(), tab = await ready(o), store = tab.load('utils/onlineIntents.ts');
  const intent = await store.prepareOnlineIntent('ai-send', 'en', send);
  const started = deferred(), response = deferred();
  tab.dispatch = () => { started.resolve(); return response.promise; };
  const inFlight = tab.load('api/intentRecovery.ts').replayOnlineIntent(intent.id);
  const stopped = assert.rejects(inFlight); await started.promise;
  tab.close(); response.resolve({ data: reply(intent.id) }); await stopped;
  const one = o.tab(), two = o.tab();
  let calls = 0;
  for (const active of [one, two]) {
    active.session.observeRenderedSession(active.authStorage.readStoredSession());
    active.dispatch = async () => { calls++; return { data: reply(intent.id) }; };
  }
  await Promise.allSettled([one.load('api/intentRecovery.ts').recoverOnlineIntents('ai', 'en'), two.load('api/intentRecovery.ts').recoverOnlineIntents('ai', 'en')]);
  assert.equal(calls, 1); assert.equal(JSON.parse(o.values.get(journalKey)).intents.length, 0);
  one.close(); two.close();
});

test('9D clear is retained; later send waits for reconciliation and old clear receipt replay preserves later messages', async () => {
  const o = origin(), tab = await ready(o), api = tab.load('api/intentRecovery.ts'), receipts = new Map();
  let history = ['old'], clears = 0;
  tab.dispatch = async req => {
    const id = req.headers['X-Idempotency-Key'];
    if (receipts.has(id)) throw error(503);
    history = []; clears++; receipts.set(id, { success: true }); throw error(503);
  };
  await assert.rejects(api.durableMutation('ai-clear', 'en', { targetLanguage: 'en' }));
  const clearId = JSON.parse(o.values.get(journalKey)).intents[0].id;
  await assert.rejects(api.durableMutation('ai-send', 'en', send));
  assert.equal(tab.requests.length, 2); advance(o);
  tab.dispatch = async req => ({ data: receipts.get(req.headers['X-Idempotency-Key']) });
  await api.recoverOnlineIntents('ai', 'en');
  history.push('later');
  // Same ID reaches the existing receipt, never another destructive clear.
  await api.durableMutation('ai-clear', 'en', { targetLanguage: 'en' }, clearId);
  assert.deepEqual(history, ['later']); assert.equal(clears, 1); tab.close();
});

test('9D image bytes are persisted and recovered after reload; changed bytes cannot replace an unresolved post', async () => {
  const o = origin(), tab = await ready(o), { File } = require('node:buffer');
  const form = new FormData(); form.set('learningLanguage', 'en'); form.set('text', 'post');
  form.set('image', new File(['original bytes'], 'image.png', { type: 'image/png' }));
  tab.dispatch = async () => { throw error(503); };
  await assert.rejects(tab.load('api/communityApi.ts').createCommunityPost(form));
  const intent = JSON.parse(o.values.get(journalKey)).intents[0];
  assert.equal(Buffer.from(intent.payload.image.base64, 'base64').toString(), 'original bytes');
  form.set('image', new File(['different bytes'], 'image.png', { type: 'image/png' }));
  await assert.rejects(tab.load('api/communityApi.ts').createCommunityPost(form));
  assert.equal(tab.requests.length, 2); tab.close(); advance(o);
  const next = o.tab(); next.session.observeRenderedSession(next.authStorage.readStoredSession());
  next.dispatch = async req => {
    assert.equal(req.headers['X-Idempotency-Key'], intent.id);
    assert.equal(await req.data.get('image').text(), 'original bytes');
    return { data: post('one-image-post') };
  };
  await next.load('api/intentRecovery.ts').recoverOnlineIntents('community'); next.close();
});

test('9D Retry-After is bounded and a retry window does not generate a new operation', async () => {
  const o = origin(), tab = await ready(o); o.now = Date.now();
  tab.dispatch = async () => { throw { response: { status: 503, headers: { 'retry-after': '900' } } }; };
  const api = tab.load('api/intentRecovery.ts');
  await assert.rejects(api.durableMutation('ai-send', 'en', send));
  const intent = JSON.parse(o.values.get(journalKey)).intents[0];
  assert.equal(intent.nextAttemptAt, o.now + 300000); assert.equal(tab.requests.length, 1);
  await assert.rejects(api.durableMutation('ai-send', 'en', send));
  assert.equal(JSON.parse(o.values.get(journalKey)).intents[0].id, intent.id); assert.equal(tab.requests.length, 1); tab.close();
});

test('9D current-owner 401 can resume after same-owner login; another language never drains the pending conversation', async () => {
  const o = origin(), tab = await ready(o), api = tab.load('api/intentRecovery.ts');
  tab.dispatch = async () => { throw error(401); };
  await assert.rejects(api.durableMutation('ai-send', 'en', send));
  const id = JSON.parse(o.values.get(journalKey)).intents[0].id;
  await tab.install(); tab.dispatch = async req => ({ data: reply(req.headers['X-Idempotency-Key']) });
  await api.recoverOnlineIntents('ai', 'de'); assert.equal(tab.requests.length, 1);
  await api.recoverOnlineIntents('ai', 'en'); assert.equal(tab.requests[1].headers['X-Idempotency-Key'], id); tab.close();
});

test('9D update conflict preserves revision; absent delete reconciles and reaction refresh is authoritative', async () => {
  const o = origin(), tab = await ready(o), api = tab.load('api/communityApi.ts');
  const form = new FormData(); form.set('text', 'edit'); form.set('expectedRevision', '4');
  tab.dispatch = async req => {
    if (req.method === 'put') { assert.equal(req.data.get('expectedRevision'), '4'); throw error(409); }
    if (req.method === 'delete') { assert.equal(req.headers['X-Resource-Revision'], 4); throw error(404); }
    if (req.method === 'post') throw error(503);
    return { data: { items: [{ ...post('post'), revision: 5, likesCount: 7, likedByMe: true }], page: 1, limit: 50, total: 1, hasMore: false } };
  };
  await assert.rejects(api.updateCommunityPost('post', form, 'original-update'));
  assert.equal((await api.deleteCommunityPost('post', 4, 'original-delete')).success, true);
  await assert.rejects(api.toggleLikeCommunityPost('post', true, 'original-reaction'));
  const feed = await api.getCommunityPosts({ language: 'en' });
  assert.equal(feed.items[0].revision, 5); assert.equal(feed.items[0].likedByMe, true); assert.equal(feed.items[0].likesCount, 7);
  assert.ok(tab.requests.filter(req => req.method === 'post').every(req => req.headers['X-Idempotency-Key'] === 'original-reaction'));
  assert.equal(tab.requests.filter(req => req.method === 'put').length, 1); tab.close();
});

test('9D acknowledgement notifications refresh only the matching owner locally and across tabs', { timeout: 5000 }, async () => {
  const o = origin(), one = await ready(o), two = o.tab(), external = deferred();
  two.session.observeRenderedSession(two.authStorage.readStoredSession());
  let local = 0, otherOwner = 0;
  const a = one.load('utils/onlineIntents.ts'), b = two.load('utils/onlineIntents.ts');
  const stop = a.subscribeIntentAcknowledgements(owner, () => local++);
  const stopExternal = b.subscribeIntentAcknowledgements(owner, () => external.resolve());
  const stopOther = b.subscribeIntentAcknowledgements(`registered_${B}`, () => otherOwner++);
  const intent = await a.prepareOnlineIntent('ai-clear', 'en', { targetLanguage: 'en' });
  await a.runOnlineIntent(intent.id, async () => ({ success: true }), () => {});
  await external.promise;
  assert.equal(local, 1); assert.equal(otherOwner, 0);
  stop(); stopExternal(); stopOther(); one.close(); two.close();
});
