const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const A = '507f1f77bcf86cd799439011';
const B = '507f1f77bcf86cd799439012';
const GLOBAL = 'linguaai_offline_queue';
const QUARANTINE = `${GLOBAL}_legacy_unowned`;
const key = owner => `${GLOBAL}_${encodeURIComponent(owner)}`;
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const user = id => ({ id, name: 'Test', email: `${id}@example.com`, isGuest: false });
const guest = id => ({ access_token: `test-${id}`, user: {
  id, name: 'Guest User', email: `guest-${id}@guest.lingua.local`, isGuest: true,
} });
const payload = { lessonId: 'lesson', score: 4, cardId: 'card', targetWord: 'word',
  turkishTranslation: 'translation', targetLanguage: 'English' };

function storage() {
  const values = new Map();
  return {
    getItem: name => values.get(name) ?? null,
    setItem: (name, value) => values.set(name, String(value)),
    removeItem: name => values.delete(name),
  };
}

// Execute the real queue, AuthProvider, namespace policy, and Axios interceptor.
// Only hooks, browser storage, and the transport are replaced; no live backend.
function harness(saved = storage(), fakeTimers = false) {
  const clock = { now: Date.now() };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
  const jobs = new Map(); let timerId = 0;
  const schedule = (fn, delay = 0, interval = 0) => { const id = ++timerId; jobs.set(id, { fn, at: clock.now + delay, interval }); return id; };
  const timeout = fakeTimers ? (fn, delay) => schedule(fn, delay) : setTimeout;
  const cancel = fakeTimers ? id => jobs.delete(id) : clearTimeout;
  const interval = fakeTimers ? (fn, delay) => schedule(fn, delay, delay) : setInterval;
  const cancelInterval = fakeTimers ? cancel : clearInterval;
  async function advanceTimers(ms) {
    const end = clock.now + ms;
    for (let count = 0; ; count++) {
      await tick(); await tick();
      const next = [...jobs.entries()].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      if (count > 500) throw new Error('Timer retry tight loop');
      const [id, job] = next; clock.now = job.at; jobs.delete(id);
      if (job.interval) jobs.set(id, { ...job, at: clock.now + job.interval });
      job.fn();
    }
    clock.now = end; await tick(); await tick();
  }
  const requests = [];
  const modules = new Map();
  const state = [];
  const effects = [];
  let cursor = 0;
  const control = {
    fetchGuest: async () => { throw new Error('Offline'); },
    fetchMe: async () => { throw new Error('Offline'); },
    dispatch: async () => ({ data: { _id: 'server-card' } }),
  };
  const react = {
    createContext: () => ({ Provider: Symbol('provider') }),
    useContext: () => {},
    useRef: initial => {
      const index = cursor++;
      if (!(index in state)) state[index] = { current: initial };
      return state[index];
    },
    useState: initial => {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], value => { state[index] = value; }];
    },
    useEffect: callback => effects.push(callback),
    createElement: (type, props) => ({ type, props }),
  };
  const requestInterceptors = [];
  const transport = {
    interceptors: {
      request: { use: handler => requestInterceptors.push(handler) },
      response: { use: () => {} },
    },
  };
  function request(method, url, data, config = {}) {
    let pending = Promise.resolve({ ...config, method, url, data, headers: { ...config.headers } });
    // Match Axios's asynchronous interceptor boundary before actual dispatch.
    for (const interceptor of requestInterceptors) pending = pending.then(interceptor);
    return pending.then(prepared => {
      requests.push(prepared);
      return control.dispatch(prepared);
    });
  }
  transport.post = (url, data, config) => request('post', url, data, config);
  transport.get = (url, config) => request('get', url, undefined, config);
  transport.patch = (url, data, config) => request('patch', url, data, config);
  transport.put = (url, data, config) => request('put', url, data, config);
  transport.delete = (url, config) => request('delete', url, undefined, config);

  const sources = {
    reachability: 'utils/backendReachability.ts', coordinator: 'utils/syncCoordinator.ts',
    policy: 'utils/syncRetryPolicy.ts', storage: 'utils/progressStorage.ts', types: 'types/progress.ts',
    userKey: 'utils/userKey.ts', queueSession: 'utils/queueSession.ts',
    apiClient: 'api/apiClient.ts', offlineQueue: 'utils/offlineQueue.ts',
    auth: 'context/AuthContext.tsx',
    authApi: 'api/authApi.ts', progressApi: 'api/progressApi.ts', language: 'utils/targetLanguage.ts', mutation: 'utils/flashcardMutation.ts',
  };
  function load(name) {
    if (modules.has(name)) return modules.get(name).exports;
    const module = { exports: {} };
    modules.set(name, module);
    const source = readFileSync(join(__dirname, '../src', sources[name]), 'utf8')
      .replaceAll('import.meta.env.VITE_API_URL', 'undefined');
    const compiled = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
      esModuleInterop: true, target: ts.ScriptTarget.ES2020,
    } }).outputText;
    vm.runInNewContext(compiled, {
      module, exports: module.exports, localStorage: saved, Date: ClockDate, AbortController,
      setTimeout: timeout, clearTimeout: cancel, setInterval: interval, clearInterval: cancelInterval,
      navigator: { onLine: true }, window: { addEventListener() {}, removeEventListener() {} },
      console: { log() {}, error() {} },
      fetch: (...args) => control.fetchGuest(...args),
      require: name => {
        if (name === 'react') return react;
        if (name === 'axios') return { create: () => transport };
        if (name === '../api/authApi') return { fetchMe: () => control.fetchMe() };
        if (name.endsWith('/backendReachability')) return load('reachability');
        if (name.endsWith('/offlineQueue')) return load('offlineQueue');
        if (name.endsWith('/syncRetryPolicy')) return load('policy');
        if (name.endsWith('/progressStorage')) return load('storage');
        if (name.endsWith('/types/progress')) return load('types');
        if (name.endsWith('/userKey')) return load('userKey');
        if (name.endsWith('/queueSession')) return load('queueSession');
        if (name.endsWith('/targetLanguage')) return load('language');
        if (name.endsWith('/flashcardMutation')) return load('mutation');
        if (name.endsWith('/apiClient')) return load('apiClient');
        throw new Error(`Unexpected import: ${name}`);
      },
    });
    return module.exports;
  }
  const queue = load('offlineQueue');
  const session = load('queueSession');
  const provider = load('auth');
  const auth = () => {
    cursor = 0;
    return provider.AuthProvider({ children: null }).props.value;
  };
  async function mount() {
    auth();
    for (const effect of [...effects]) effect();
    await tick();
  }
  const enqueue = (type = 'complete-lesson', data = payload) => {
    queue.pushToOfflineQueue(type, data, session.getOfflineQueueSession().ownerNamespace);
  };
  return { advanceTimers, advance: ms => { clock.now += ms; }, load, saved, requests, control, queue, session, auth, mount, enqueue,
    authApi: load('authApi'), progressApi: load('progressApi'), client: load('apiClient').default };
}

test('registered A logout, B isolation, and A recovery preserve owner queues', async () => {
  const h = harness();
  await h.mount();
  h.auth().login(user(A), `test-${A}`);
  h.enqueue();
  const savedA = h.saved.getItem(key(`registered_${A}`));
  h.auth().logout();
  h.auth().login(user(B), `test-${B}`);
  assert.equal(h.queue.getOfflineQueue().length, 0);
  assert.equal(await h.queue.processOfflineQueue(A), false);
  h.enqueue();
  assert.equal(await h.queue.processOfflineQueue(B), true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].headers.Authorization, `Bearer test-${B}`);
  assert.equal(h.saved.getItem(key(`registered_${A}`)), savedA);
  h.auth().logout();
  h.auth().login(user(A), `test-${A}`);
  assert.equal(h.queue.getOfflineQueue().length, 1);
  assert.equal(await h.queue.processOfflineQueue(A), true);
  assert.equal(h.requests[1].headers.Authorization, `Bearer test-${A}`);
});

test('backend guests A/B, registered same ID, and local guest queues stay separate across refresh', async () => {
  const h = harness();
  await h.mount();
  await h.auth().loginAsGuest();
  h.enqueue();
  const local = h.saved.getItem(key('local_guest'));
  assert.equal(await h.queue.processOfflineQueue('guest'), false);
  h.control.fetchGuest = async () => ({ ok: true, json: async () => guest(A) });
  await h.auth().loginAsGuest();
  h.enqueue();
  const savedA = h.saved.getItem(key(`guest_${A}`));
  const refreshed = harness(h.saved);
  await refreshed.mount();
  assert.equal(refreshed.queue.getOfflineQueue()[0].ownerNamespace, `guest_${A}`);
  assert.equal(refreshed.saved.getItem(key(`guest_${A}`)), savedA);
  refreshed.auth().logout();
  refreshed.control.fetchGuest = async () => ({ ok: true, json: async () => guest(B) });
  await refreshed.auth().loginAsGuest();
  assert.equal(refreshed.queue.getOfflineQueue().length, 0);
  refreshed.enqueue();
  assert.equal(await refreshed.queue.processOfflineQueue(B), true);
  assert.equal(refreshed.saved.getItem(key(`guest_${A}`)), savedA);
  refreshed.auth().login(user(A), `test-${A}`);
  assert.equal(refreshed.queue.getOfflineQueue().length, 0);
  assert.equal(refreshed.saved.getItem(key('local_guest')), local);
  refreshed.control.fetchGuest = async () => ({ ok: true, json: async () => guest(A) });
  await refreshed.auth().loginAsGuest();
  assert.equal(await refreshed.queue.processOfflineQueue(A), true);
});

for (const sameAccount of [false, true]) {
  test(`account switch during drain retains all unacknowledged actions (same account: ${sameAccount})`, async () => {
    const h = harness();
    await h.mount();
    h.auth().login(user(A), `test-${A}`);
    h.enqueue();
    h.enqueue();
    const started = deferred();
    const release = deferred();
    h.control.dispatch = async () => { started.resolve(); return release.promise; };
    const drain = h.queue.processOfflineQueue(A);
    await started.promise;
    const savedA = h.saved.getItem(key(`registered_${A}`));
    h.auth().logout();
    h.auth().login(user(sameAccount ? A : B), `test-${sameAccount ? A : B}`);
    if (!sameAccount) h.enqueue();
    const savedB = h.saved.getItem(key(`registered_${B}`));
    release.resolve({ data: {} });
    assert.equal(await drain, false);
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].headers.Authorization, `Bearer test-${A}`);
    assert.equal(h.saved.getItem(key(`registered_${A}`)), savedA);
    assert.equal(h.saved.getItem(key(`registered_${B}`)), savedB);
    h.auth().login(user(A), `test-${A}`);
    h.advance(300_001);
  h.control.dispatch = async () => ({ data: {} });
    assert.equal(await h.queue.processOfflineQueue(A), true);
    assert.equal(h.requests.length, 3);
  });
}

for (const type of ['complete-lesson', 'create-flashcard', 'update-flashcard', 'delete-flashcard', 'review-flashcard']) {
  test(`Axios prevents pre-dispatch token replacement for ${type}`, async () => {
    const h = harness();
    await h.mount();
    h.auth().login(user(A), `test-${A}`);
    h.enqueue(type);
    const drain = h.queue.processOfflineQueue(A);
    const savedA = h.saved.getItem(key(`registered_${A}`));
    // Switch after processor check, before Axios's asynchronous interceptor.
    h.auth().logout();
    h.auth().login(user(B), `test-${B}`);
    assert.equal(await drain, false);
    assert.equal(h.requests.length, 0);
    assert.equal(h.saved.getItem(key(`registered_${A}`)), savedA);
  });
}

test('all operations pin owner credentials and create ignores a stale payload userId', async () => {
  const h = harness();
  await h.mount();
  h.auth().login(user(A), `test-${A}`);
  for (const type of ['complete-lesson', 'create-flashcard', 'update-flashcard', 'delete-flashcard', 'review-flashcard']) {
    h.enqueue(type, { ...payload, userId: B });
  }
  assert.equal(await h.queue.processOfflineQueue(B), false);
  assert.equal(await h.queue.processOfflineQueue(A), true);
  assert.equal(h.requests.length, 5);
  assert.ok(h.requests.every(r => r.headers.Authorization === `Bearer test-${A}`));
  assert.equal('userId' in h.requests.find(r => r.url === '/flashcards').data, false);
});

test('new action has precisely the versioned ownership envelope without credentials', async () => {
  const h = harness();
  await h.mount();
  h.auth().login(user(A), `test-${A}`);
  h.enqueue();
  const action = h.queue.getOfflineQueue()[0];
  assert.deepEqual(Object.keys(action).sort(), ['createdAt', 'id', 'ownerNamespace', 'payload', 'schemaVersion', 'type']);
  assert.equal(action.ownerNamespace, `registered_${A}`);
  assert.equal(action.schemaVersion, 1);
  assert.ok(Number.isFinite(Date.parse(action.createdAt)));
  assert.ok(action.id);
  assert.ok(!h.saved.getItem(key(`registered_${A}`)).includes(`test-${A}`));
});

test('misfiled action owner fails closed without changing stored data', async () => {
  const h = harness();
  await h.mount();
  h.auth().login(user(A), `test-${A}`);
  h.enqueue();
  const raw = JSON.parse(h.saved.getItem(key(`registered_${A}`)));
  raw.actions[0].ownerNamespace = `registered_${B}`;
  const tampered = JSON.stringify(raw);
  h.saved.setItem(key(`registered_${A}`), tampered);
  assert.equal(await h.queue.processOfflineQueue(A), false);
  assert.equal(h.requests.length, 0);
  assert.equal(h.saved.getItem(key(`registered_${A}`)), tampered);
});

test('ownerless and malformed legacy queues are preserved in quarantine, never assigned', async () => {
  const h = harness();
  await h.mount();
  h.auth().login(user(B), `test-${B}`);
  const raw = JSON.stringify([{ id: 'old', type: 'complete-lesson', payload: { userId: A } }]);
  h.saved.setItem(GLOBAL, raw);
  assert.equal(h.queue.getOfflineQueue().length, 0);
  assert.equal(h.saved.getItem(GLOBAL), null);
  assert.deepEqual(JSON.parse(h.saved.getItem(QUARANTINE)), [raw]);
  h.saved.setItem(GLOBAL, '{invalid-json');
  assert.equal(h.queue.getOfflineQueue().length, 0);
  assert.deepEqual(JSON.parse(h.saved.getItem(QUARANTINE)), [raw, '{invalid-json']);
  assert.equal(await h.queue.processOfflineQueue(B), true);
  assert.equal(h.requests.length, 0);
});

test('quarantine write failure leaves the global legacy data intact', async () => {
  const h = harness();
  await h.mount();
  h.saved.setItem(GLOBAL, '{legacy');
  const originalWrite = h.saved.setItem;
  h.saved.setItem = (name, value) => {
    if (name === QUARANTINE) throw new Error('Storage unavailable');
    originalWrite(name, value);
  };
  assert.throws(() => h.queue.getOfflineQueue(), /Storage unavailable/);
  assert.equal(h.saved.getItem(GLOBAL), '{legacy');
});

test('late auth profile cannot replace B owner with A while retaining B credentials', async () => {
  const saved = storage();
  saved.setItem('linguaai_user', JSON.stringify(user(A)));
  saved.setItem('linguaai_token', `test-${A}`);
  const h = harness(saved);
  const profile = deferred();
  h.control.fetchMe = () => profile.promise;
  await h.mount();
  h.auth().logout();
  h.auth().login(user(B), `test-${B}`);
  profile.resolve(user(A));
  await tick();
  assert.equal(h.session.getOfflineQueueSession().ownerNamespace, `registered_${B}`);
  assert.equal(h.auth().user.id, B);
  h.enqueue();
  assert.equal(await h.queue.processOfflineQueue(B), true);
  assert.equal(h.requests[0].headers.Authorization, `Bearer test-${B}`);
});

for (const operation of ['profile-fetch', 'profile-update', 'progress-fetch', 'lesson-complete', 'progress-reset', 'card-fetch']) {
  test(`ordinary ${operation} request cannot pick up B token before dispatch`, async () => {
    const h = harness(); await h.mount(); h.auth().login(user(A), `test-${A}`);
    const send = {
      'profile-fetch': () => h.authApi.fetchMe(),
      'profile-update': () => h.authApi.updateProfile({ name: 'A name' }),
      'progress-fetch': () => h.progressApi.fetchProgress(A, 'English'),
      'lesson-complete': () => h.progressApi.saveProgressToBackend(A, 'lesson', 4),
      'progress-reset': () => h.progressApi.resetProgressInBackend(A),
      'card-fetch': () => h.client.get(`/flashcards/all?userId=${A}`, h.session.getSessionRequestConfig()),
    }[operation];
    const pending = send(); h.auth().logout(); h.auth().login(user(B), `test-${B}`);
    if (operation === 'progress-fetch') assert.equal(await pending, null);
    else await assert.rejects(pending, /Session changed before dispatch/);
    assert.equal(h.requests.length, 0);
  });
}

const createPayload = { tempId: 'local_123', targetWord: 'old', turkishTranslation: 'translation', targetLanguage: 'English' };
async function durableHarness(saved) {
  const h = harness(saved); await h.mount();
  if (!saved) h.auth().login(user(A), `test-${A}`);
  return h;
}

for (const type of ['create-flashcard', 'update-flashcard', 'delete-flashcard', 'review-flashcard', 'complete-lesson']) {
  test(`${type} retries send the same durable action ID after page restart`, async () => {
    const h = await durableHarness();
    h.enqueue(type, { ...createPayload, id: 'mongo-real', lessonId: 'lesson-1', score: 4 });
    const operationId = h.queue.getOfflineQueue()[0].id;
    h.control.dispatch = async () => { throw new Error('Response lost after dispatch'); };
    assert.equal(await h.queue.processOfflineQueue(A), false);
    assert.equal(h.requests[0].headers['X-Idempotency-Key'], operationId);
    const restarted = await durableHarness(h.saved);
    assert.equal(restarted.queue.getOfflineQueue()[0].id, operationId);
    restarted.advance(300_001);
    assert.equal(await restarted.queue.processOfflineQueue(A), true);
    assert.equal(restarted.requests[0].headers['X-Idempotency-Key'], operationId);
    assert.equal(restarted.queue.getOfflineQueue().length, 0);
  });
}

test('durable acknowledgement survives interrupted successor and page restart', async () => {
  const h = await durableHarness(); h.enqueue(); h.enqueue('complete-lesson', { lessonId: 'second', score: 73 });
  const second = deferred(); const release = deferred();
  h.control.dispatch = async request => {
    if (request.data.lessonId === 'second') { second.resolve(); return release.promise; }
    return { data: {} };
  };
  const drain = h.queue.processOfflineQueue(A); await second.promise;
  assert.equal(h.queue.getOfflineQueue().length, 1);
  assert.equal(h.queue.getOfflineQueue()[0].payload.lessonId, 'second');
  h.auth().logout(); release.resolve({ data: {} }); assert.equal(await drain, false);
  h.auth().login(user(A), `test-${A}`);
  const restarted = await durableHarness(h.saved);
  restarted.advance(300_001);
  assert.equal(await restarted.queue.processOfflineQueue(A), true);
  assert.equal(restarted.requests.length, 1);
  assert.equal(restarted.requests[0].data.lessonId, 'second');
});

test('Phase 4A actions migrate; failed dependent retries real ID after page restart', async () => {
  const h = await durableHarness(); h.enqueue('create-flashcard', createPayload);
  const create = h.queue.getOfflineQueue()[0];
  const update = { ...create, id: 'legacy-update', type: 'update-flashcard', payload: { id: 'local_123', targetWord: 'new' } };
  // Old owned arrays must preserve their dependency order and action IDs.
  h.saved.setItem(key(`registered_${A}`), JSON.stringify([create, update]));
  h.control.dispatch = async request => {
    if (request.method === 'put') throw new Error('Update unavailable');
    return { data: { _id: 'mongo-real' } };
  };
  assert.equal(await h.queue.processOfflineQueue(A), false);
  const persisted = JSON.parse(h.saved.getItem(key(`registered_${A}`)));
  assert.equal(persisted.schemaVersion, 2); assert.equal(persisted.tempIds.local_123, 'mongo-real');
  assert.equal(persisted.actions[0].id, 'legacy-update'); assert.equal(persisted.actions[0].payload.id, 'mongo-real');
  const restarted = await durableHarness(h.saved);
  restarted.advance(300_001);
  assert.equal(await restarted.queue.processOfflineQueue(A), true);
  assert.equal(restarted.requests.length, 1); assert.equal(restarted.requests[0].url, '/flashcards/mongo-real');
});

test('pending create plus edits sends latest fields in one create', async () => {
  const h = await durableHarness(); h.enqueue('create-flashcard', createPayload);
  h.enqueue('update-flashcard', { id: 'local_123', targetWord: 'new', note: 'latest' });
  h.enqueue('update-flashcard', { cardId: 'local_123', turkishTranslation: 'new translation' });
  assert.equal(h.queue.getOfflineQueue().length, 1);
  assert.equal(await h.queue.processOfflineQueue(A), true);
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].data.targetWord, 'new');
  assert.equal(h.requests[0].data.turkishTranslation, 'new translation'); assert.equal(h.requests[0].data.note, 'latest');
});

test('compaction preserves earlier migrated edits and review order', async () => {
  const h = await durableHarness(); h.enqueue('create-flashcard', createPayload);
  const create = h.queue.getOfflineQueue()[0];
  const edit = { ...create, id: 'legacy-edit', type: 'update-flashcard', payload: {
    id: 'local_123', turkishTranslation: 'earlier translation', exampleSentence: 'earlier example', note: 'earlier note',
  } };
  const review = { ...create, id: 'legacy-review', type: 'review-flashcard', payload: { id: 'local_123', score: 2 } };
  h.saved.setItem(key(`registered_${A}`), JSON.stringify([create, edit, review]));
  h.enqueue('update-flashcard', { id: 'local_123', targetWord: 'latest', note: null });
  const actions = h.queue.getOfflineQueue();
  assert.deepEqual(Array.from(actions, a => a.id), [create.id, 'legacy-review']);
  const restarted = await durableHarness(h.saved);
  restarted.advance(300_001);
  assert.equal(await restarted.queue.processOfflineQueue(A), true);
  const sent = restarted.requests[0].data;
  assert.equal(sent.targetWord, 'latest'); assert.equal(sent.turkishTranslation, 'earlier translation');
  assert.equal(sent.exampleSentence, 'earlier example'); assert.equal(sent.note, null);
  assert.equal(restarted.requests[1].data.score, 2);
});

test('failed review retains real ID and exact score after restart', async () => {
  const h = await durableHarness(); h.enqueue('create-flashcard', createPayload);
  h.enqueue('review-flashcard', { id: 'local_123', score: 2 });
  h.enqueue('review-flashcard', { cardId: 'local_123', score: 5 });
  h.control.dispatch = async request => {
    if (request.method === 'put') throw new Error('Review unavailable');
    return { data: { _id: 'mongo-real' } };
  };
  assert.equal(await h.queue.processOfflineQueue(A), false);
  const pending = h.queue.getOfflineQueue();
  assert.deepEqual(Array.from(pending, a => a.payload.score), [2, 5]);
  assert.equal(pending[0].payload.id, 'mongo-real'); assert.equal(pending[1].payload.cardId, 'mongo-real');
  const restarted = await durableHarness(h.saved);
  restarted.advance(300_001);
  assert.equal(await restarted.queue.processOfflineQueue(A), true);
  assert.deepEqual(restarted.requests.map(r => r.data.score), [2, 5]);
  assert.ok(restarted.requests.every(r => r.url === '/flashcards/mongo-real/review'));
});

test('overlapping owner drains do not dispatch or acknowledge twice', async () => {
  const h = await durableHarness(); h.enqueue(); const started = deferred(); const release = deferred();
  h.control.dispatch = () => { started.resolve(); return release.promise; };
  const drain = h.queue.processOfflineQueue(A); await started.promise;
  assert.equal(await h.queue.processOfflineQueue(A), false); assert.equal(h.requests.length, 1);
  release.resolve({ data: {} }); assert.equal(await drain, true);
  assert.equal(h.queue.getOfflineQueue().length, 0);
});

test('pending create plus review plus delete cancels all dependents without server creation', async () => {
  const h = await durableHarness(); h.enqueue('create-flashcard', createPayload);
  h.enqueue('review-flashcard', { id: 'local_123', score: 4 });
  h.enqueue('delete-flashcard', { id: 'local_123' });
  const restarted = await durableHarness(h.saved);
  restarted.advance(300_001);
  assert.equal(await restarted.queue.processOfflineQueue(A), true);
  assert.equal(restarted.requests.length, 0); assert.equal(restarted.queue.getOfflineQueue().length, 0);
});

test('pending reviews remain ordered and retain exact scores behind create', async () => {
  const h = await durableHarness(); h.enqueue('create-flashcard', createPayload);
  h.enqueue('review-flashcard', { cardId: 'local_123', score: 2 });
  h.enqueue('review-flashcard', { id: 'local_123', score: 5 });
  assert.equal(await h.queue.processOfflineQueue(A), true);
  assert.deepEqual(h.requests.map(r => r.url), ['/flashcards', '/flashcards/server-card/review', '/flashcards/server-card/review']);
  assert.deepEqual(h.requests.slice(1).map(r => r.data.score), [2, 5]);
});

test('append during drain remains persisted without being overwritten by acknowledgement', async () => {
  const h = await durableHarness(); h.enqueue(); const started = deferred(); const release = deferred();
  h.control.dispatch = () => { started.resolve(); return release.promise; };
  const drain = h.queue.processOfflineQueue(A); await started.promise;
  h.enqueue('complete-lesson', { lessonId: 'new', score: 73 });
  release.resolve({ data: {} }); assert.equal(await drain, true);
  assert.equal(h.requests.length, 1); assert.equal(h.queue.getOfflineQueue()[0].payload.lessonId, 'new');
  const restarted = await durableHarness(h.saved); assert.equal(restarted.queue.getOfflineQueue().length, 1);
});

test('edits and delete during in-flight create become durable real-ID dependents', async () => {
  const h = await durableHarness(); h.enqueue('create-flashcard', createPayload);
  const started = deferred(); const release = deferred();
  h.control.dispatch = () => { started.resolve(); return release.promise; };
  const drain = h.queue.processOfflineQueue(A); await started.promise;
  h.enqueue('update-flashcard', { id: 'local_123', targetWord: 'new' });
  h.enqueue('review-flashcard', { id: 'local_123', score: 4 });
  h.enqueue('delete-flashcard', { id: 'local_123' });
  assert.equal(h.queue.getOfflineQueue().length, 4);
  release.resolve({ data: { _id: 'mongo-real' } }); assert.equal(await drain, true);
  assert.ok(h.queue.getOfflineQueue().every(a => a.payload.id === 'mongo-real'));
  const restarted = await durableHarness(h.saved); assert.equal(await restarted.queue.processOfflineQueue(A), true);
  assert.deepEqual(restarted.requests.map(r => r.method), ['put', 'put', 'delete']);
  assert.equal(restarted.requests[2].url, '/flashcards/mongo-real');
});

test('owner-scoped mappings never cross registered, guest, or local queues', async () => {
  const h = await durableHarness(); h.enqueue('create-flashcard', createPayload);
  assert.equal(await h.queue.processOfflineQueue(A), true);
  h.auth().login(user(B), `test-${B}`);
  assert.equal(h.queue.isPendingBackendCard('local_123', `registered_${B}`), false);
  h.enqueue('create-flashcard', createPayload); assert.equal(await h.queue.processOfflineQueue(B), true);
  h.control.fetchGuest = async () => ({ ok: true, json: async () => guest(A) }); await h.auth().loginAsGuest();
  assert.equal(h.queue.isPendingBackendCard('local_123', `guest_${A}`), false);
  h.enqueue('create-flashcard', createPayload); assert.equal(await h.queue.processOfflineQueue(A), true);
  assert.equal(h.queue.isPendingBackendCard('local_123', `guest_${B}`), false);
  assert.equal(h.queue.isPendingBackendCard('local_123', 'local_guest'), false);
  h.auth().login(user(A), `test-${A}`);
  h.enqueue('review-flashcard', { id: 'local_123', score: 4 });
  assert.equal(h.queue.getOfflineQueue()[0].payload.id, 'server-card');
});

test('acknowledgement persistence failure retains action and stops successor dispatch', async () => {
  const h = await durableHarness(); h.enqueue(); h.enqueue();
  const original = h.saved.setItem;
  h.control.dispatch = async () => {
    h.saved.setItem = (name, value) => { if (name === key(`registered_${A}`)) throw new Error('Disk full'); original(name, value); };
    return { data: {} };
  };
  await assert.rejects(h.queue.processOfflineQueue(A), /Disk full/);
  assert.equal(h.requests.length, 1); assert.equal(h.queue.getOfflineQueue().length, 2);
});


async function coordinatedHarness() {
  const h = harness(undefined, true); await h.mount(); h.auth().login(user(A), `test-${A}`);
  let reachable = false;
  const health = new (h.load('reachability').BackendReachability)(async () => reachable);
  let changes = 0;
  const coordinator = new (h.load('coordinator').SyncCoordinator)(health, () => { changes++; });
  await health.start(); coordinator.start(); await h.advanceTimers(0);
  return { ...h, health, coordinator, recover: () => { reachable = true; }, changes: () => changes,
    stop: () => { coordinator.stop(); health.stop(); } };
}

test('Phase 4F: network online/backend down cannot drain; health recovery drains without any page', async () => {
  const h = await coordinatedHarness();
  try {
    h.enqueue(); await h.advanceTimers(0);
    assert.equal(h.health.snapshot().networkAvailable, true); assert.equal(h.health.snapshot().backendReachable, false);
    assert.equal(h.requests.length, 0); assert.equal(h.queue.getOfflineQueue().length, 1);
    h.recover(); await h.advanceTimers(30_000);
    assert.equal(h.health.snapshot().backendReachable, true);
    assert.equal(h.requests.length, 1); assert.equal(h.queue.getOfflineQueue().length, 0);
    assert.equal(h.changes(), 1);
    assert.equal(h.requests[0].timeout, 45_000); assert.ok(h.requests[0].signal);
  } finally { h.stop(); }
});

test('Phase 4F: transient failure persists attempt/backoff across restart and reuses ID', async () => {
  const h = await durableHarness(); h.enqueue(); const id = h.queue.getOfflineQueue()[0].id;
  h.control.dispatch = async () => { throw { response: { status: 503, data: 'secret response' } }; };
  assert.equal(await h.queue.processOfflineQueue(A), false);
  const failed = h.queue.getOfflineQueue()[0];
  assert.equal(failed.attemptCount, 1); assert.equal(failed.lastErrorCategory, 'backend');
  assert.equal(Date.parse(failed.nextAttemptAt) - Date.parse(failed.lastAttemptAt), 5000);
  assert.ok(!h.saved.getItem(key(`registered_${A}`)).includes('secret response'));
  assert.equal(await h.queue.processOfflineQueue(A), false); assert.equal(h.requests.length, 1);
  const restarted = await durableHarness(h.saved);
  assert.equal(await restarted.queue.processOfflineQueue(A), false); assert.equal(restarted.requests.length, 0);
  restarted.advance(5001); assert.equal(await restarted.queue.processOfflineQueue(A), true);
  assert.equal(restarted.requests[0].headers['X-Idempotency-Key'], id);
  assert.equal(restarted.queue.getOfflineQueue().length, 0);
});

test('Phase 4F: bounded exponential backoff and FIFO prevent tight/unsafe retries', async () => {
  const h = await durableHarness(); h.enqueue(); h.enqueue('review-flashcard', { cardId: 'real', score: 4 });
  h.control.dispatch = async () => { throw { response: { status: 429 } }; };
  const expected = [5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000];
  for (const delay of expected) {
    assert.equal(await h.queue.processOfflineQueue(A), false);
    const action = h.queue.getOfflineQueue()[0]; assert.equal(Date.parse(action.nextAttemptAt) - Date.parse(action.lastAttemptAt), delay);
    const count = h.requests.length; assert.equal(await h.queue.processOfflineQueue(A), false); assert.equal(h.requests.length, count);
    h.advance(delay);
  }
  assert.ok(h.requests.every(request => request.method === 'post')); assert.equal(h.queue.getOfflineQueue().length, 2);
});

for (const status of [400, 403, 404, 409, 422]) {
  test(`Phase 4F: terminal ${status} is durable/owner-scoped, preserves dependencies, permits independent work`, async () => {
    const h = await durableHarness(); h.enqueue('create-flashcard', createPayload);
    h.enqueue('review-flashcard', { cardId: 'local_123', score: 4 });
    h.enqueue('complete-lesson', { lessonId: 'independent', score: 73 });
    h.control.dispatch = async request => {
      if (request.url === '/flashcards') throw { response: { status } };
      return { data: {} };
    };
    assert.equal(await h.queue.processOfflineQueue(A), false);
    assert.equal(h.queue.getOfflineQueue().length, 0); assert.equal(h.queue.getFailedOfflineActions().length, 2);
    assert.equal(h.queue.getFailedOfflineActions()[1].lastErrorCategory, 'dependency');
    assert.equal(h.requests.length, 2); assert.equal(h.requests[1].data.lessonId, 'independent');
    const restarted = await durableHarness(h.saved); assert.equal(restarted.queue.getFailedOfflineActions().length, 2);
    assert.equal(await restarted.queue.processOfflineQueue(A), true); assert.equal(restarted.requests.length, 0);
    restarted.auth().logout(); restarted.auth().login(user(B), `test-${B}`);
    assert.equal(restarted.queue.getFailedOfflineActions().length, 0);
  });
}

test('Phase 4F: failed reset quarantines successor/future completions until an explicit new reset', async () => {
  const h = await durableHarness(); h.enqueue('reset-progress', {}); h.enqueue('complete-lesson', { lessonId: 'later', score: 73 });
  h.control.dispatch = async () => { throw { response: { status: 403 } }; };
  assert.equal(await h.queue.processOfflineQueue(A), false); assert.equal(h.requests.length, 1);
  assert.equal(h.queue.getFailedOfflineActions().length, 2);
  h.enqueue('complete-lesson', { lessonId: 'future', score: 73 });
  assert.equal(await h.queue.processOfflineQueue(A), false); assert.equal(h.requests.length, 1);
  h.enqueue('reset-progress', {}); assert.equal(h.queue.getFailedOfflineActions().length, 0);
  h.control.dispatch = async () => ({ data: {} }); assert.equal(await h.queue.processOfflineQueue(A), true);
});

test('Phase 4F: recovery and overlapping coordinator triggers send exactly once for a backend guest', async () => {
  const h = await coordinatedHarness();
  try {
    h.control.fetchGuest = async () => ({ ok: true, json: async () => guest(B) });
    await h.auth().loginAsGuest(); h.enqueue();
    const started = deferred(), release = deferred();
    h.control.dispatch = async () => { started.resolve(); return release.promise; };
    h.recover(); await h.advanceTimers(30_000); await started.promise;
    h.coordinator.wake(); h.coordinator.wake(); await h.health.refresh(); await h.advanceTimers(0);
    assert.equal(h.requests.length, 1); assert.equal(h.requests[0].headers.Authorization, `Bearer test-${B}`);
    release.resolve({ data: {} }); await h.advanceTimers(0);
    assert.equal(h.queue.getOfflineQueue().length, 0); assert.equal(h.requests.length, 1);
  } finally { h.stop(); }
});

test('Phase 4F: local guest is blocked even with healthy backend and automatic coordinator', async () => {
  const h = await coordinatedHarness();
  try {
    h.auth().logout(); h.control.fetchGuest = async () => { throw new Error('Offline'); };
    await h.auth().loginAsGuest(); h.enqueue(); h.recover(); await h.advanceTimers(30_000);
    h.coordinator.wake(); await h.advanceTimers(0);
    assert.equal(h.session.getOfflineQueueSession().ownerNamespace, 'local_guest');
    assert.equal(h.requests.length, 0); assert.equal(h.queue.getOfflineQueue().length, 1);
  } finally { h.stop(); }
});

test('Phase 4F: timeout aborts transport and retains its stable operation', async () => {
  const h = harness(undefined, true); await h.mount(); h.auth().login(user(A), `test-${A}`); h.enqueue();
  let aborted = false;
  h.control.dispatch = request => { request.signal.addEventListener('abort', () => { aborted = true; }); return new Promise(() => {}); };
  const operation = h.queue.processOfflineQueue(A); await h.advanceTimers(45_000);
  assert.equal(await operation, false); assert.equal(aborted, true);
  assert.equal(h.queue.getOfflineQueue()[0].lastErrorCategory, 'timeout');
  assert.equal(h.queue.getOfflineQueue()[0].attemptCount, 1);
});

test('Phase 4F: public health probe accepts only health success and has no credentials', async () => {
  const h = harness(undefined, true); let status = 503; const probes = [];
  h.control.fetchGuest = async (url, config) => { probes.push({ url, config }); return { ok: status === 200, json: async () => ({ status: 'ok' }) }; };
  const health = h.load('reachability').backendReachability;
  await health.refresh(); assert.equal(health.snapshot().networkAvailable, true); assert.equal(health.snapshot().backendReachable, false);
  status = 200; await health.refresh(); assert.equal(health.snapshot().backendReachable, true);
  assert.equal(probes[0].url, 'http://localhost:3000/health'); assert.equal(probes[0].config.credentials, 'omit');
  assert.equal(probes[0].config.headers, undefined);
});

test('Phase 4F: 401 is retained for authentication recovery, not silently quarantined', async () => {
  const h = await durableHarness(); h.enqueue(); h.control.dispatch = async () => { throw { response: { status: 401 } }; };
  await h.queue.processOfflineQueue(A); assert.equal(h.queue.getOfflineQueue()[0].lastErrorCategory, 'authentication');
  assert.equal(h.queue.getFailedOfflineActions().length, 0);
});


test('Phase 4F: coordinator timer retries a healthy-backend transient failure with no additional page/session event', async () => {
  const h = await coordinatedHarness();
  try {
    h.recover(); await h.health.refresh(); h.enqueue();
    h.control.dispatch = async request => {
      if (h.requests.length === 1) throw { response: { status: 503 } };
      return { data: {} };
    };
    await h.advanceTimers(0); assert.equal(h.requests.length, 1);
    await h.advanceTimers(4999); assert.equal(h.requests.length, 1);
    await h.advanceTimers(1); assert.equal(h.requests.length, 2); assert.equal(h.queue.getOfflineQueue().length, 0);
  } finally { h.stop(); }
});

test('Phase 4F: coordinator waits for an existing service drain without repeated probes', async () => {
  const h = await coordinatedHarness();
  try {
    h.enqueue();
    const started = deferred(), release = deferred();
    h.control.dispatch = async () => { started.resolve(); return release.promise; };
    const externalDrain = h.queue.processOfflineQueue(A); await started.promise;
    h.recover(); await h.health.refresh();
    let probes = 0;
    const refresh = h.health.refresh;
    h.health.refresh = () => { probes++; return refresh(); };
    await h.advanceTimers(1000);
    assert.equal(h.requests.length, 1); assert.equal(probes, 0);
    release.resolve({ data: {} }); assert.equal(await externalDrain, true);
    await h.advanceTimers(0);
    assert.equal(h.queue.getOfflineQueue().length, 0); assert.equal(h.requests.length, 1);
  } finally { h.stop(); }
});

test('Phase 4F: account switch during a drain automatically resumes only the new owner', async () => {
  const h = await coordinatedHarness();
  try {
    const started = deferred(), release = deferred();
    h.control.dispatch = async () => {
      if (h.requests.length === 1) { started.resolve(); return release.promise; }
      return { data: {} };
    };
    h.enqueue(); h.recover(); await h.health.refresh(); await h.advanceTimers(0); await started.promise;
    const oldQueue = h.saved.getItem(key(`registered_${A}`));
    h.auth().logout(); h.auth().login(user(B), `test-${B}`); h.enqueue(); h.coordinator.wake();
    release.resolve({ data: {} }); await h.advanceTimers(1);
    assert.equal(h.requests.length, 2); assert.equal(h.requests[1].headers.Authorization, `Bearer test-${B}`);
    assert.equal(h.queue.getOfflineQueue().length, 0);
    assert.equal(h.saved.getItem(key(`registered_${A}`)), oldQueue);
  } finally { h.stop(); }
});

test('Phase 5C: partial update omits untouched fields, keeps clears and native fields across retry', async () => {
  const h = harness(); await h.mount(); h.auth().login(user(A), `test-${A}`);
  h.enqueue('update-flashcard', { cardId: 'card', nativeLanguage: 'tr', nativeTranslation: 'native', note: '', exampleSentence: '' });
  h.control.dispatch = async () => { if (h.requests.length === 1) throw new Error('lost response'); return { data: {} }; };
  assert.equal(await h.queue.processOfflineQueue(A), false);
  h.advance(6 * 60 * 1000);
  assert.equal(await h.queue.processOfflineQueue(A), true);
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].data)), {
    nativeLanguage: 'tr', nativeTranslation: 'native', note: '', exampleSentence: '',
  });
  assert.deepEqual(h.requests[0].data, h.requests[1].data);
  assert.equal(h.requests[0].headers['X-Idempotency-Key'], h.requests[1].headers['X-Idempotency-Key']);
});

test('Phase 5C: previously attempted legacy web updates retain their receipt payload', async () => {
  const h = harness(); await h.mount(); h.auth().login(user(A), `test-${A}`);
  h.enqueue('update-flashcard', { cardId: 'card', targetWord: 'word', turkishTranslation: 'translation',
    nativeLanguage: 'tr', nativeTranslation: 'native', note: '', exampleSentence: '' });
  const state = JSON.parse(h.saved.getItem(key(`registered_${A}`)));
  state.actions[0].attemptCount = 1;
  h.saved.setItem(key(`registered_${A}`), JSON.stringify(state));
  assert.equal(await h.queue.processOfflineQueue(A), true);
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].data)), {
    targetWord: 'word', turkishTranslation: 'translation', note: '', exampleSentence: '',
  });
});

for (const type of ['create-flashcard', 'update-flashcard']) {
  test(`Phase 5D: ${type} normalizes new aliases and preserves previously attempted receipt language`, async () => {
    for (const attempted of [false, true]) {
      const h = harness(); await h.mount(); h.auth().login(user(A), `test-${A}`);
      h.enqueue(type, { cardId: 'card', targetWord: 'word', turkishTranslation: 'translation', targetLanguage: 'German' });
      const state = JSON.parse(h.saved.getItem(key(`registered_${A}`)));
      state.actions[0].attemptCount = attempted ? 1 : 0;
      h.saved.setItem(key(`registered_${A}`), JSON.stringify(state));
      assert.equal(await h.queue.processOfflineQueue(A), true);
      assert.equal(h.requests[0].data.targetLanguage, attempted ? 'German' : 'de');
      assert.equal(h.requests[0].headers['X-Idempotency-Key'], state.actions[0].id);
    }
  });
}
