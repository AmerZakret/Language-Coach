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
function harness(saved = storage()) {
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
    let pending = Promise.resolve({ ...config, method, url, data, headers: {} });
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
    userKey: 'utils/userKey.ts', queueSession: 'utils/queueSession.ts',
    apiClient: 'api/apiClient.ts', offlineQueue: 'utils/offlineQueue.ts',
    auth: 'context/AuthContext.tsx',
    authApi: 'api/authApi.ts', progressApi: 'api/progressApi.ts',
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
      module, exports: module.exports, localStorage: saved,
      console: { log() {}, error() {} },
      fetch: (...args) => control.fetchGuest(...args),
      require: name => {
        if (name === 'react') return react;
        if (name === 'axios') return { create: () => transport };
        if (name === '../api/authApi') return { fetchMe: () => control.fetchMe() };
        if (name.endsWith('/userKey')) return load('userKey');
        if (name.endsWith('/queueSession')) return load('queueSession');
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
  return { saved, requests, control, queue, session, auth, mount, enqueue,
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
    const savedA = h.saved.getItem(key(`registered_${A}`));
    const started = deferred();
    const release = deferred();
    h.control.dispatch = async () => { started.resolve(); return release.promise; };
    const drain = h.queue.processOfflineQueue(A);
    await started.promise;
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
    const savedA = h.saved.getItem(key(`registered_${A}`));
    const drain = h.queue.processOfflineQueue(A);
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
  assert.equal(h.requests.find(r => r.url === '/flashcards').data.userId, A);
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
  raw[0].ownerNamespace = `registered_${B}`;
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
