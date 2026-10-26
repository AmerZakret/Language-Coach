const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { origin, A, B, user, ownerKey } = require('./helpers/browserContexts.cjs');
const { releaseIdentity } = require('../../scripts/check-release-contract.cjs');
const owner = `registered_${A}`;
const metadata = overrides => ({ currentProtocolRevision: 1, minimumMutationRevision: 1, policy: 'ENFORCE_MUTATIONS', buildId: 'backend-build', ...overrides });
const body = () => ({ response: { status: 426, data: { code: 'CLIENT_PROTOCOL_UNSUPPORTED' } } });

test('10B server-v2 legacy discovery keeps the current v1 client transitional without adding a timeline', async () => {
  const o = origin(), tab = o.tab(); await tab.install();
  tab.load('utils/releaseCompatibility.ts').releaseCompatibility.observeMetadata(metadata({
    currentProtocolRevision: 2, minimumMutationRevision: 1, policy: 'ALLOW_LEGACY',
    timelineAwareProtocolRevision: 2, dataTimelineId: '11111111-1111-4111-8111-111111111111', timelineWriteState: 'OPEN',
  }));
  await tab.client.post('/ai-coach/chat', { message: 'fixture' });
  assert.equal(tab.requests[0].headers['X-Client-Protocol'], '1');
  assert.equal(tab.requests[0].headers['X-Data-Timeline'], undefined);
  tab.close();
});

test('9C central transport declares protocol for auth, guest, reads and keyed writes without losing headers', async () => {
  const o = origin(), tab = o.tab(); await tab.install();
  tab.fetchGuest = async () => ({ ok: true, json: async () => ({ user: user(), access_token: 'fixture' }) });
  await tab.client.post('/auth/login', {}, { headers: { 'X-Extra': 'preserved' } });
  await tab.client.post('/auth/guest'); await tab.client.get('/flashcards/all');
  await tab.client.put('/flashcards/card/review', { score: 4 }, { headers: { 'X-Idempotency-Key': 'stable-review' } });
  assert.ok(tab.requests.every(request => request.headers['X-Client-Protocol'] === '1'));
  assert.equal(tab.requests[0].headers['X-Extra'], 'preserved');
  assert.equal(tab.requests[3].headers['X-Idempotency-Key'], 'stable-review');
  assert.equal(tab.requests[3].headers.Authorization, `Bearer token-${A}`);
  tab.close();
});
test('9C unsupported metadata blocks writes while read/auth and all owner state survive', async () => {
  const o = origin(), tab = o.tab(); await tab.install();
  await tab.queue.pushToOfflineQueue('review-flashcard', { cardId: 'card', score: 4 }, owner);
  const queue = o.values.get(ownerKey(owner)), auth = o.values.get('linguaai_session_v1');
  tab.load('utils/releaseCompatibility.ts').releaseCompatibility.observeMetadata(metadata({ minimumMutationRevision: 2, currentProtocolRevision: 2 }));
  await assert.rejects(tab.client.put('/flashcards/card/review', { score: 4 }), /Update or reconcile/);
  await assert.rejects(tab.queue.pushToOfflineQueue('review-flashcard', { cardId: 'card', score: 4 }, owner), /Update or reconcile/);
  assert.equal(await tab.queue.processOfflineQueue(A), false);
  assert.equal(tab.requests.length, 0);
  await tab.client.get('/flashcards/all'); await tab.client.post('/auth/login', {});
  assert.equal(o.values.get(ownerKey(owner)), queue); assert.equal(o.values.get('linguaai_session_v1'), auth);
  tab.close();
});
test('9C compatibility rejection pauses replay, retains original ID/protocol/payload and never quarantines or logs out', async () => {
  const o = origin(), tab = o.tab(); await tab.install();
  await tab.queue.pushToOfflineQueue('review-flashcard', { cardId: 'card', score: 5 }, owner);
  const before = tab.queue.getOfflineQueue()[0], auth = o.values.get('linguaai_session_v1');
  tab.dispatch = async () => { throw body(); };
  assert.equal(await tab.queue.processOfflineQueue(A), false);
  const after = tab.queue.getOfflineQueue()[0];
  assert.equal(after.id, before.id); assert.equal(after.clientProtocolRevision, before.clientProtocolRevision);
  assert.equal(JSON.stringify(after.payload), JSON.stringify(before.payload));
  assert.equal(tab.queue.getFailedOfflineActions().length, 0);
  assert.equal(after.nextAttemptAt, undefined); assert.equal(after.failedAt, undefined);
  const stored = o.values.get(ownerKey(owner));
  assert.equal(await tab.queue.processOfflineQueue(A), false);
  assert.equal(o.values.get(ownerKey(owner)), stored); assert.equal(tab.requests.length, 1);
  assert.equal(o.values.get('linguaai_session_v1'), auth);
  tab.close();
});
test('9C cross-tab advertisements are checked before dispatch and never clear another owner or auth', async () => {
  const o = origin(), old = o.tab(), newer = o.tab(); await old.install();
  await old.queue.pushToOfflineQueue('review-flashcard', { cardId: 'card', score: 3 }, owner);
  o.values.set(ownerKey(`registered_${B}`), JSON.stringify({ retained: 'other owner' }));
  const auth = o.values.get('linguaai_session_v1'), queue = o.values.get(ownerKey(owner)), other = o.values.get(ownerKey(`registered_${B}`));
  newer.load('utils/releaseCompatibility.ts').releaseCompatibility.observeMetadata(metadata({ minimumMutationRevision: 2, currentProtocolRevision: 2 }));
  // No flush/storage-event wait: the dispatch boundary rereads compatibility.
  await assert.rejects(old.client.post('/community/posts', {}), /Update or reconcile/);
  assert.equal(await old.queue.processOfflineQueue(A), false);
  assert.equal(old.requests.length, 0);
  assert.equal(o.values.get(ownerKey(owner)), queue); assert.equal(o.values.get(ownerKey(`registered_${B}`)), other);
  assert.equal(o.values.get('linguaai_session_v1'), auth); old.close(); newer.close();
});
for (const recorded of [undefined, 0]) test(`9C replay does not upgrade stored protocol ${recorded}`, async () => {
  const o = origin(), tab = o.tab(); await tab.install();
  await tab.queue.pushToOfflineQueue('review-flashcard', { cardId: 'card', score: 4 }, owner);
  const state = JSON.parse(o.values.get(ownerKey(owner))), id = state.actions[0].id;
  if (recorded === undefined) delete state.actions[0].clientProtocolRevision;
  else state.actions[0].clientProtocolRevision = recorded;
  o.values.set(ownerKey(owner), JSON.stringify(state));
  tab.dispatch = async req => {
    assert.equal(req.headers['X-Client-Protocol'], recorded === undefined ? undefined : String(recorded));
    assert.equal(req.headers['X-Idempotency-Key'], id); throw body();
  };
  assert.equal(await tab.queue.processOfflineQueue(A), false);
  assert.equal(tab.queue.getOfflineQueue()[0].clientProtocolRevision, recorded); tab.close();
});
test('9C a new compatible build prompts reload; an incompatible manifest stops writes without deleting anything', async () => {
  const o = origin(), tab = o.tab(); await tab.install();
  const release = tab.load('utils/releaseCompatibility.ts').releaseCompatibility;
  release.observeRelease({ buildId: 'ci-new-bundle', protocolRevision: 1 });
  assert.equal(release.snapshot().newBuildAvailable, true); assert.equal(release.snapshot().updateRequired, false);
  await tab.client.post('/ai-coach/chat', { message: 'fixture' });
  release.observeRelease({ buildId: 'ci-incompatible', protocolRevision: 2 });
  await assert.rejects(tab.client.delete('/ai-coach/clear'), /Update or reconcile/);
  assert.ok(o.values.get('linguaai_session_v1')); assert.equal(tab.requests.length, 1); tab.close();
});
test('9C source-executed identities remain independent; synthetic build injection needs no file writes', () => {
  const development = releaseIdentity(), ci = releaseIdentity('ci-synthetic.12');
  assert.equal(development.web.buildId, 'development'); assert.equal(ci.web.buildId, 'ci-synthetic.12');
  assert.equal(ci.backend.currentProtocolRevision, 2); assert.equal(ci.backend.minimumMutationRevision, 1); assert.equal(ci.clientsTimelineAware, false); assert.equal(ci.web.protocolRevision, 1);
  assert.notEqual(ci.web.buildId, String(ci.web.protocolRevision));
});
test('9C actual Vite manifest plugin emits only bounded public artifact/protocol identity', () => {
  let env = { VITE_API_URL: 'https://api.example.invalid', VITE_BUILD_ID: 'ci-build.99' };
  function load(file) {
    const module = { exports: {} };
    const output = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    vm.runInNewContext(output, { module, exports: module.exports, process, URL, __dirname: resolve(__dirname, '..'),
      require: name => {
        if (name === 'vite') return { defineConfig: value => value, loadEnv: () => env };
        if (name === '@vitejs/plugin-react' || name === '@tailwindcss/vite') return () => ({});
        if (name === './package.json') return require('../package.json');
        if (name === 'path') return require('node:path');
        return load(resolve(__dirname, '..', name + '.ts'));
      } });
    return module.exports;
  }
  const configuration = load(resolve(__dirname, '../vite.config.ts')).default;
  const config = configuration({ command: 'build', mode: 'production' });
  let emitted; config.plugins.find(plugin => plugin.name === 'public-release-identity').generateBundle.call({ emitFile: value => { emitted = value; } });
  assert.equal(emitted.fileName, 'release.json');
  assert.deepEqual(JSON.parse(emitted.source), { buildId: 'ci-build.99', protocolRevision: 1 });
  env = { ...env, VITE_BUILD_ID: '../private' }; assert.throws(() => configuration({ command: 'build', mode: 'production' }), /VITE_BUILD_ID/);
  env = { VITE_API_URL: 'https://api.example.invalid' };
  assert.equal(configuration({ command: 'build', mode: 'production' }).define.__WEB_BUILD_ID__, '"development"');
});

test('9C compatibility advertisements whitelist metadata and do not persist unexpected server internals', () => {
  const o = origin(), tab = o.tab();
  const store = tab.load('utils/releaseCompatibility.ts').releaseCompatibility;
  store.observeMetadata(metadata({ internalConfiguration: 'DO_NOT_PERSIST_MARKER' }));
  assert.doesNotMatch(o.values.get(store.storageKey), /DO_NOT_PERSIST_MARKER|internalConfiguration/);
  store.observeRelease({ protocolRevision: 1, buildId: 'public-build', rawToken: 'DO_NOT_PERSIST_MARKER' });
  assert.doesNotMatch(o.values.get(store.storageKey), /DO_NOT_PERSIST_MARKER|rawToken/); tab.close();
});
