const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const A = '507f1f77bcf86cd799439011';
const B = '507f1f77bcf86cd799439012';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const user = id => ({ id, name: id === A ? 'A' : 'B', email: `${id}@example.com`, targetLanguage: 'English' });
const progress = (xp = 20) => ({ totalXp: xp, streak: 2, completedLessonIds: [], weeklyActivity: [] });
const card = id => ({ _id: `card-${id}`, userId: id, targetWord: id,
  turkishTranslation: 'translation', interval: 0, easinessFactor: 2.5,
  nextReviewDate: new Date().toISOString(), reviewCount: 0 });
const copy = value => JSON.parse(JSON.stringify(value));

function harness(initial = {}) {
  const values = new Map(Object.entries(initial));
  const localStorage = { getItem: k => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) };
  let activeRunner;
  const modules = new Map();
  const calls = [];
  const timers = [];
  const h = { deferredState: [], snapshot: () => Object.fromEntries(values), localStorage, calls, timers, language: 'English', isOffline: true };
  const api = {
    fetchMe: async () => user(A), updateProfile: async () => user(A),
    login: async () => ({ user: user(A), access_token: `test-${A}` }),
    register: async () => ({ user: user(A), access_token: `test-${A}` }),
  };
  h.api = api;
  h.fetchGuest = async () => ({ ok: true, json: async () => ({ user: {
    ...user(A), email: 'guest-a@guest.lingua.local', isGuest: true }, access_token: `test-${A}` }) });
  h.fetchProgress = async (id, lang) => progress(lang === 'German' ? 30 : id === A ? 10 : 20);
  h.saveProgress = async () => {};
  h.resetProgress = async () => {};
  h.drain = async () => false;
  h.transport = async (method, url, data, config) => {
    if (method === 'get') {
      const id = data?.sessionSnapshot?.userId || h.auth().user.id;
      return { data: [card(id)] };
    }
    return { data: card(config?.sessionSnapshot?.userId || h.auth().user.id) };
  };
  const depsEqual = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    createContext: () => ({ Provider: 'provider' }), useContext: () => {},
    useState: initial => {
      const r = activeRunner, i = r.cursor++;
      if (!(i in r.slots)) r.slots[i] = typeof initial === 'function' ? initial() : initial;
      return [r.slots[i], value => {
        const apply = () => {
          const next = typeof value === 'function' ? value(r.slots[i]) : value;
          r.writes++;
          if (!Object.is(next, r.slots[i])) r.dirty = true;
          r.slots[i] = next;
        };
        if (h.deferChildState && r === h.child) h.deferredState.push(apply);
        else apply();
      }];
    },
    useRef: initial => {
      const r = activeRunner, i = r.cursor++;
      if (!(i in r.slots)) r.slots[i] = { current: initial };
      return r.slots[i];
    },
    useCallback: (fn, deps) => {
      const r = activeRunner, i = r.cursor++;
      if (!r.slots[i] || !depsEqual(r.slots[i].deps, deps)) r.slots[i] = { fn, deps };
      return r.slots[i].fn;
    },
    useEffect: (fn, deps) => {
      const r = activeRunner, i = r.cursor++;
      if (!r.slots[i] || !depsEqual(r.slots[i].deps, deps)) {
        const old = r.slots[i];
        r.pending.push(() => { old?.cleanup?.(); r.slots[i].cleanup = fn(); });
        r.slots[i] = { deps };
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  const sources = { userKey: 'utils/userKey.ts', queueSession: 'utils/queueSession.ts',
    policy: 'utils/syncRetryPolicy.ts', guard: 'utils/useSessionGuard.ts', auth: 'context/AuthContext.tsx',
    storage: 'utils/progressStorage.ts', types: 'types/progress.ts',
    progress: 'context/ProgressContext.tsx', target: 'context/TargetLanguageContext.tsx',
    cards: 'pages/FlashcardsPage.tsx', queue: 'utils/offlineQueue.ts', authPage: 'components/auth/AuthPage.tsx',
    profile: 'pages/ProfilePage.tsx' };
  const exposed = {
    cards: 'fetchCards, handleSaveCard, handleDeleteCard, handleStudyScore, handleOpenAdd, handleOpenEdit, setFormData, allCards, dueCards, loading, error, successMsg, modal, studyResults',
    authPage: 'handleSubmit, setEmail, setPassword, loading, error',
    profile: 'handleSave, setName, saved, resetConfirm, setResetConfirm',
  };
  function load(name) {
    if (modules.has(name)) return modules.get(name).exports;
    const module = { exports: {} };
    modules.set(name, module);
    let source = readFileSync(join(__dirname, '../src', sources[name]), 'utf8')
      .replaceAll('import.meta.env.VITE_API_URL', 'undefined');
    // Expose closed-over handlers/state at the existing render return, without
    // replacing their implementation or adding production test exports.
    if (exposed[name]) source = source.replace(/\n  return \(\r?\n/, `\n  globalThis.__capture({${exposed[name]}});\n  return (\n`);
    const compiled = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true, target: ts.ScriptTarget.ES2020,
    } }).outputText;
    vm.runInNewContext(compiled, {
      module, exports: module.exports, localStorage, AbortController, __capture: value => { activeRunner.exposed = value; },
      fetch: (...args) => h.fetchGuest(...args), console: { log() {}, error() {} },
      setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
      setInterval: () => 1, clearInterval() {},
      document: { addEventListener() {}, removeEventListener() {} }, window: {},
      require: path => {
        if (path === 'react') return react;
        if (path === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
        if (path === 'lucide-react') return new Proxy({}, { get: (_, name) => String(name) });
        if (path === 'react-router-dom') return { useNavigate: () => () => calls.push(['navigate']) };
        if (path.endsWith('.png')) return 'image';
        if (path.endsWith('/userKey')) return load('userKey');
        if (path.endsWith('/queueSession')) return load('queueSession');
        if (path.endsWith('/syncRetryPolicy')) return load('policy');
        if (path.endsWith('/SyncContext')) return { useSync: () => ({ syncRevision: h.syncRevision || 0, lastDrainSucceeded: true }) };
        if (path.endsWith('/useSessionGuard')) return load('guard');
        if (path.endsWith('/progressStorage')) return load('storage');
        if (path.endsWith('/types/progress')) return load('types');
        if (path.endsWith('/AuthContext')) return { useAuth: () => h.auth() };
        if (path.endsWith('/TargetLanguageContext')) return { useTargetLanguage: () => ({ targetLanguage: h.language }) };
        if (path.endsWith('/NetworkContext')) return { useNetwork: () => ({ isOffline: h.isOffline }) };
        if (path.endsWith('/ThemeContext')) return { useTheme: () => ({ isDark: false }) };
        if (path.endsWith('/LanguageContext')) return { useLanguage: () => ({ t: text => text, language: 'en' }) };
        if (path.endsWith('/SoundContext')) return { useSound: () => ({}) };
        if (path.endsWith('/levelUtils')) return { getLevelFromXp: () => 'Beginner' };
        if (path.endsWith('/ProgressContext')) return { useProgress: () => ({ progress: progress(), resetProgress: () => h.resetProgress() }) };
        if (path.endsWith('/authApi')) return new Proxy({}, { get: (_, method) => (...args) => api[method](...args) });
        if (path.endsWith('/progressApi')) return {
          fetchProgress: (id, lang) => { calls.push(['fetch', id, lang]); return h.fetchProgress(id, lang); },
          saveProgressToBackend: (...args) => { calls.push(['complete', ...args]); return h.saveProgress(...args); },
          resetProgressInBackend: (...args) => h.resetProgress(...args),
        };
        if (path.endsWith('/offlineQueue')) return {
          ...load('queue'),
          processOfflineQueue: (...args) => h.progressQueue ? load('queue').processOfflineQueue(...args) : h.drain(...args),
          isPendingBackendCard: (...args) => h.queue?.isPendingBackendCard(...args) ?? false,
          pushToOfflineQueue: (...args) => load('queue').pushToOfflineQueue(...args),
        };
        if (path.endsWith('/apiClient')) return Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method,
          (url, data, config) => {
            calls.push([method, url]);
            if (url.includes('/progress/') && method === 'post') {
              const id = url.split('/')[2]; calls.push(['complete', id, data.lessonId, data.score]);
              return Promise.resolve(h.saveProgress(id, data.lessonId, data.score, config)).then(result => ({ data: result }));
            }
            if (url.includes('/progress/') && method === 'delete') return h.resetProgress(url.split('/')[2], url, data);
            return h.transport(method, url, data, config);
          }]));
        throw new Error(`Unexpected import: ${path}`);
      },
    });
    return module.exports;
  }
  function runner(name, symbol) {
    const component = load(name)[symbol];
    const r = { slots: [], pending: [], cursor: 0, writes: 0, dirty: false, mounted: true };
    r.render = () => {
      activeRunner = r; r.cursor = 0; r.dirty = false;
      r.result = component(name === 'authPage' ? { initialMode: 'login' } : { children: null });
      for (const effect of r.pending.splice(0)) effect();
      return r.result?.props?.value;
    };
    r.unmount = () => { r.mounted = false; for (const slot of r.slots) slot?.cleanup?.(); };
    r.render();
    return r;
  }
  h.progressQueue = true;
  h.mountAuth = () => { h.authRunner = runner('auth', 'AuthProvider'); };
  h.auth = () => h.authRunner.result.props.value;
  h.login = id => { h.auth().login(user(id), `test-${id}`); h.authRunner.render(); };
  h.mount = (name, symbol) => { h.progressQueue = name === 'progress'; h.child = runner(name, symbol); };
  h.settle = async () => {
    for (let i = 0; i < 5; i++) {
      await tick();
      for (const r of [h.authRunner, h.child]) if (r?.mounted && r.dirty) r.render();
    }
  };
  h.switchToB = async () => { h.auth().logout(); h.login(B); if (h.child) h.child.render(); await h.settle(); };
  h.load = load;
  return h;
}

async function pendingCardHarness() {
  const h = harness(); h.mountAuth(); h.login(A); h.queue = h.load('queue');
  h.transport = async method => {
    if (method === 'get') throw new Error('Offline');
    return { data: card(A) };
  };
  h.mount('cards', 'FlashcardsPage'); await h.settle();
  h.child.exposed.handleOpenAdd(); h.child.render();
  h.child.exposed.setFormData({ targetWord: 'old', turkishTranslation: 'translation', exampleSentence: '', note: '' });
  h.child.render(); await h.child.exposed.handleSaveCard({ preventDefault() {} }); await h.settle();
  assert.equal(h.queue.getOfflineQueue().length, 1);
  return h;
}

test('reset contract: web queued reset reaches the real Nest route and acknowledges', async () => {
  const { startResetServer } = require('../../lingua_ai_backend/test/progress-reset-server.cjs');
  const server = await startResetServer();
  try {
    const h = harness(); h.mountAuth(); await h.settle();
    h.auth().login(user(server.owner), server.token); h.authRunner.render();
    h.resetProgress = async (_id, url, config) => {
      const response = await fetch(`${server.url}${url}`, { method: 'DELETE', headers: {
        Authorization: `Bearer ${config.offlineQueueSession.token}`,
        'X-Idempotency-Key': config.headers['X-Idempotency-Key'],
      } });
      if (!response.ok) throw { response: { status: response.status } };
      return { data: await response.json() };
    };
    const queue = h.load('queue');
    queue.pushToOfflineQueue('reset-progress', {}, `registered_${server.owner}`);
    assert.equal(await queue.processOfflineQueue(server.owner), true);
    assert.equal(queue.getOfflineQueue().length, 0);
    assert.equal(queue.getFailedOfflineActions().length, 0);
    assert.deepEqual(server.resets, [server.owner]);
  } finally { await server.close(); }
});

for (const online of [true, false]) {
  test(`local_guest create/edit/review/delete stay local (backend available: ${online})`, async () => {
    const h = harness({ linguaai_is_guest: 'true', linguaai_user: JSON.stringify({
      id: 'guest', name: 'Guest User', email: 'guest@lingua.ai', isGuest: true,
    }) });
    h.mountAuth(); await h.settle(); h.isOffline = !online;
    h.transport = async () => { throw new Error('local_guest must not use backend'); };
    h.mount('cards', 'FlashcardsPage'); await h.settle();
    h.child.exposed.handleOpenAdd(); h.child.render();
    h.child.exposed.setFormData({ targetWord: 'local', turkishTranslation: 'translation', exampleSentence: '', note: '' });
    h.child.render(); await h.child.exposed.handleSaveCard({ preventDefault() {} }); await h.settle();
    const created = h.child.exposed.allCards[0]; assert.ok(created._id.startsWith('local_'));
    h.child.exposed.handleOpenEdit(created); h.child.render();
    h.child.exposed.setFormData({ targetWord: 'edited', turkishTranslation: 'new translation', exampleSentence: 'example', note: 'local note' });
    h.child.render(); await h.child.exposed.handleSaveCard({ preventDefault() {} }); await h.settle();
    assert.equal(h.child.exposed.allCards[0].targetWord, 'edited');
    await h.child.exposed.handleStudyScore(4); await h.settle();
    assert.equal(h.child.exposed.allCards[0].reviewCount, 1);
    assert.equal(h.child.exposed.allCards[0].interval, 1);
    // A reachable backend must not replace the local card/cache on refresh.
    await h.child.exposed.fetchCards(); await h.settle();
    assert.equal(h.child.exposed.allCards[0].targetWord, 'edited');
    assert.equal(h.child.exposed.allCards[0].reviewCount, 1);
    await h.child.exposed.handleDeleteCard(created._id); await h.settle();
    assert.equal(h.child.exposed.allCards.length, 0);
    assert.equal(h.child.exposed.dueCards.length, 0);
    assert.deepEqual(JSON.parse(h.localStorage.getItem('flashcards_all_guest_English')), []);
    assert.deepEqual(JSON.parse(h.localStorage.getItem('flashcards_due_guest_English')), []);
    assert.equal(h.load('queue').getOfflineQueue().length, 0);
    assert.equal(h.calls.length, 0);
  });
}

for (const backendGuest of [true, false]) {
  test(`online flashcard handlers keep backend identity (backend guest: ${backendGuest})`, async () => {
    const h = harness(); h.mountAuth(); await h.settle();
    if (backendGuest) { await h.auth().loginAsGuest(); await h.settle(); }
    else h.login(A);
    h.isOffline = false;
    let savedCard = card(A);
    const mutations = [];
    h.transport = async (method, url, data, config) => {
      if (method === 'get') return { data: savedCard ? [savedCard] : [] };
      const session = (method === 'delete' ? data : config).sessionSnapshot;
      assert.equal(session.userId, A); assert.equal(session.token, `test-${A}`);
      assert.equal(session.ownerNamespace, `${backendGuest ? 'guest' : 'registered'}_${A}`);
      mutations.push(method);
      if (method === 'post') { assert.equal('userId' in data, false); savedCard = { ...card(A), ...data }; }
      if (method === 'put' && !url.endsWith('/review')) savedCard = { ...savedCard, ...data };
      if (method === 'delete') savedCard = null;
      return { data: savedCard || {} };
    };
    h.mount('cards', 'FlashcardsPage'); await h.settle();
    h.child.exposed.handleOpenAdd(); h.child.render();
    h.child.exposed.setFormData({ targetWord: 'backend', turkishTranslation: 'translation', exampleSentence: '', note: '' });
    h.child.render(); await h.child.exposed.handleSaveCard({ preventDefault() {} }); await h.settle();
    h.child.exposed.handleOpenEdit(h.child.exposed.allCards[0]); h.child.render();
    h.child.exposed.setFormData({ targetWord: 'edited', turkishTranslation: 'translation', exampleSentence: '', note: '' });
    h.child.render(); await h.child.exposed.handleSaveCard({ preventDefault() {} }); await h.settle();
    await h.child.exposed.handleStudyScore(4); await h.settle();
    await h.child.exposed.handleDeleteCard(savedCard._id); await h.settle();
    assert.deepEqual(mutations, ['post', 'put', 'put', 'delete']);
    assert.equal(h.load('queue').getOfflineQueue().length, 0);
  });
}

function findResetButton(node) {
  if (!node || typeof node !== 'object') return;
  if (node.props?.children === 'yes_reset_all') return node;
  for (const child of Array.isArray(node) ? node : Object.values(node)) {
    const result = findResetButton(child); if (result) return result;
  }
}
for (const switchAccount of [true, false]) {
  test(`profile reset callback respects the active session (switch account: ${switchAccount})`, async () => {
    const h = harness(); h.mountAuth(); h.login(A); h.mount('profile', 'ProfilePage'); await h.settle();
    h.child.exposed.setResetConfirm(true); h.child.render();
    const pending = deferred(); let resets = 0;
    h.resetProgress = () => { resets++; return pending.promise; };
    const resetting = findResetButton(h.child.result).props.onClick();
    if (switchAccount) {
      await h.switchToB(); h.child.exposed.setResetConfirm(true); h.child.render();
    }
    const writes = h.child.writes;
    pending.resolve(); await resetting; await h.settle();
    assert.equal(resets, 1);
    assert.equal(h.child.exposed.resetConfirm, switchAccount);
    if (switchAccount) assert.equal(h.child.writes, writes);
  });
}
test('profile reset deferred state updater cannot close a newer owner confirmation', async () => {
  const h = harness(); h.mountAuth(); h.login(A); h.mount('profile', 'ProfilePage'); await h.settle();
  h.child.exposed.setResetConfirm(true); h.child.render();
  const pending = deferred(); h.resetProgress = () => pending.promise;
  const resetting = findResetButton(h.child.result).props.onClick();
  h.deferChildState = true; pending.resolve(); await resetting;
  h.deferChildState = false; await h.switchToB();
  h.child.exposed.setResetConfirm(true); h.child.render();
  for (const apply of h.deferredState.splice(0)) apply(); await h.settle();
  assert.equal(h.child.exposed.resetConfirm, true);
});

test('FlashcardsPage pending create edit compacts latest form fields into durable create', async () => {
  const h = await pendingCardHarness(); const pending = h.child.exposed.allCards[0];
  h.child.exposed.handleOpenEdit(pending); h.child.render();
  h.child.exposed.setFormData({ targetWord: 'new', turkishTranslation: 'new translation', exampleSentence: 'example', note: 'latest' });
  h.child.render(); await h.child.exposed.handleSaveCard({ preventDefault() {} }); await h.settle();
  assert.equal(h.queue.getOfflineQueue().length, 1);
  assert.equal(h.queue.getOfflineQueue()[0].payload.targetWord, 'new');
  assert.equal(h.child.exposed.allCards[0].targetWord, 'new');
  assert.equal(await h.queue.processOfflineQueue(A), true);
  const create = h.calls.filter(([method]) => method === 'post'); assert.equal(create.length, 1);
});

test('FlashcardsPage pending create review delete cancels server creation and local cache', async () => {
  const h = await pendingCardHarness(); const pending = h.child.exposed.allCards[0];
  await h.child.exposed.handleStudyScore(4); await h.settle();
  await h.child.exposed.handleDeleteCard(pending._id); await h.settle();
  assert.equal(h.queue.getOfflineQueue().length, 0); assert.equal(h.child.exposed.allCards.length, 0);
  assert.deepEqual(JSON.parse(h.localStorage.getItem(`flashcards_all_${A}_English`)), []);
  assert.equal(await h.queue.processOfflineQueue(A), true);
  assert.equal(h.calls.filter(([method]) => method === 'post').length, 0);
});

test('FlashcardsPage pending review queues original score and preserves existing SRS result', async () => {
  const h = await pendingCardHarness(); const pending = h.child.exposed.allCards[0];
  await h.child.exposed.handleStudyScore(4); await h.settle();
  const actions = h.queue.getOfflineQueue(); assert.equal(actions.length, 2);
  assert.equal(actions[1].payload.cardId, pending._id); assert.equal(actions[1].payload.score, 4);
  const reviewed = h.child.exposed.allCards[0];
  assert.equal(reviewed.interval, 1); assert.equal(reviewed.reviewCount, 1); assert.equal(reviewed.easinessFactor, 2.5);
  assert.equal(await h.queue.processOfflineQueue(A), true);
  assert.ok(h.calls.some(([method, url]) => method === 'put' && url === `/flashcards/card-${A}/review`));
});

test('FlashcardsPage queue write failure cannot locally hide an uncancelled pending create', async () => {
  const h = await pendingCardHarness(); const pending = h.child.exposed.allCards[0];
  const write = h.localStorage.setItem;
  h.localStorage.setItem = (key, value) => {
    if (key.startsWith('linguaai_offline_queue_')) throw new Error('Disk full');
    write(key, value);
  };
  await assert.rejects(h.child.exposed.handleDeleteCard(pending._id), /Disk full/);
  assert.equal(h.child.exposed.allCards[0]._id, pending._id);
  assert.equal(h.queue.getOfflineQueue().length, 1);
});

test('startup A profile response cannot overwrite B auth/storage', async () => {
  const h = harness({ linguaai_user: JSON.stringify(user(A)), linguaai_token: `test-${A}` });
  const pending = deferred(); h.api.fetchMe = () => pending.promise;
  h.mountAuth(); h.login(B);
  pending.resolve(user(A)); await h.settle();
  assert.equal(h.auth().user.id, B);
  assert.equal(JSON.parse(h.localStorage.getItem('linguaai_user')).id, B);
});
for (const failure of [false, true]) {
  test(`pending guest login cannot restore A or local guest after B login (failure: ${failure})`, async () => {
    const h = harness(); h.mountAuth(); await h.settle();
    const pending = deferred(); h.fetchGuest = () => pending.promise;
    const operation = h.auth().loginAsGuest(); h.auth().logout(); h.login(B);
    if (failure) pending.reject(new Error('Offline'));
    else pending.resolve({ ok: true, json: async () => ({ user: { ...user(A), email: 'guest-a@guest.lingua.local' }, access_token: `test-${A}` }) });
    await operation; await h.settle();
    assert.equal(h.auth().user.id, B); assert.equal(h.auth().isGuest, false);
  });
}
test('ordinary same-session profile update does not advance revision', async () => {
  const h = harness(); h.mountAuth(); h.login(A);
  const revision = h.load('queueSession').getOfflineQueueSession().revision;
  h.auth().login({ ...user(A), name: 'Updated' }, `test-${A}`); h.authRunner.render();
  assert.equal(h.load('queueSession').getOfflineQueueSession().revision, revision);
  assert.equal(h.auth().user.name, 'Updated');
});

for (const kind of ['fetch', 'completion-success', 'completion-failure', 'reset', 'language', 'unmount']) {
  test(`progress discards stale ${kind} response and follow-ups`, async () => {
    const h = harness(); h.isOffline = false; h.mountAuth(); h.login(A); h.mount('progress', 'ProgressProvider'); await h.settle();
    const pending = deferred();
    let operation;
    if (kind.startsWith('completion')) {
      h.saveProgress = () => pending.promise;
      operation = h.child.result.props.value.completeLesson('new', 100, 4);
    } else if (kind === 'reset') {
      h.resetProgress = () => pending.promise;
      operation = h.child.result.props.value.resetProgress();
    } else {
      h.fetchProgress = (id, lang) => id === A && lang === 'English' ? pending.promise : Promise.resolve(progress(30));
      operation = h.child.result.props.value.reloadProgress();
    }
    if (kind === 'language') {
      h.language = 'German'; h.localStorage.setItem('linguaai_target_language', 'German'); h.child.render(); await h.settle();
    } else if (kind === 'unmount') h.child.unmount();
    else await h.switchToB();
    const before = copy(h.child.result.props.value.progress);
    const cache = h.localStorage.getItem(`progress_registered_${B}_English`);
    const count = h.calls.length, writes = h.child.writes;
    if (kind === 'completion-failure') pending.reject(new Error('Failed'));
    else pending.resolve(progress(999));
    await operation; await h.settle();
    assert.deepEqual(copy(h.child.result.props.value.progress), before);
    assert.equal(h.localStorage.getItem(`progress_registered_${B}_English`), cache);
    assert.equal(h.calls.length, count, 'No stale follow-up refetch/upload');
    assert.equal(h.child.writes, writes);
  });
}

for (const kind of ['fetch', 'create', 'update', 'delete', 'review', 'failed-create', 'sync-refresh', 'language', 'unmount']) {
  test(`flashcards discard stale ${kind} UI/cache changes`, async () => {
    const h = harness(); h.isOffline = false; h.mountAuth(); h.login(A);
    h.mount('cards', 'FlashcardsPage'); await h.settle();
    const pending = deferred(); let operation;
    const originalTransport = h.transport;
    if (kind === 'sync-refresh') {
      h.transport = (method, url, data, config) => (method === 'get' ? data : config)?.sessionSnapshot?.userId === B
        ? originalTransport(method, url, data, config) : pending.promise;
      h.syncRevision = 1; h.child.render();
    } else {
      if (['create', 'failed-create'].includes(kind)) h.child.exposed.handleOpenAdd();
      if (kind === 'update') h.child.exposed.handleOpenEdit(card(A));
      h.child.exposed.setFormData({ targetWord: 'new', turkishTranslation: 'translation' }); h.child.render();
      h.transport = (method, url, data, config) => (method === 'get' || method === 'delete' ? data : config)?.sessionSnapshot?.userId === B
        ? originalTransport(method, url, data, config) : pending.promise;
      if (kind === 'delete') operation = h.child.exposed.handleDeleteCard(`card-${A}`);
      else if (kind === 'review') operation = h.child.exposed.handleStudyScore(4);
      else if (['create', 'update', 'failed-create'].includes(kind)) operation = h.child.exposed.handleSaveCard({ preventDefault() {} });
      else operation = h.child.exposed.fetchCards();
    }
    if (kind === 'language') {
      h.language = 'German'; h.localStorage.setItem('linguaai_target_language', 'German');
      h.transport = (method, url, data) => url.includes('German') ? originalTransport(method, url, data) : pending.promise;
      h.child.render(); await h.settle();
    } else if (kind === 'unmount') h.child.unmount();
    else await h.switchToB();
    const state = copy(h.child.exposed);
    const cache = h.localStorage.getItem(`flashcards_all_${B}_English`);
    const count = h.calls.length, writes = h.child.writes;
    if (kind === 'failed-create') pending.reject(new Error('Failed'));
    else pending.resolve(kind === 'sync-refresh' ? { data: [card(A)] } : { data: [card(A)] });
    if (operation) await operation;
    await h.settle();
    assert.deepEqual(copy(h.child.exposed), state);
    assert.equal(h.localStorage.getItem(`flashcards_all_${B}_English`), cache);
    assert.equal(h.calls.length, count, 'No stale fetchCards follow-up');
    assert.equal(h.child.writes, writes);
  });
}

test('A language update cannot call login to restore A after B becomes active', async () => {
  const h = harness(); h.mountAuth(); h.login(A); h.mount('target', 'TargetLanguageProvider'); await h.settle();
  const pending = deferred(); h.api.updateProfile = () => pending.promise;
  const operation = h.child.result.props.value.setTargetLanguage('German');
  await h.switchToB();
  const stored = h.localStorage.getItem('linguaai_target_language');
  pending.resolve({ ...user(A), targetLanguage: 'German' }); await operation; await h.settle();
  assert.equal(h.auth().user.id, B); assert.equal(h.localStorage.getItem('linguaai_target_language'), stored);
});
test('older same-session language update cannot overwrite a newer language', async () => {
  const h = harness(); h.mountAuth(); h.login(A); h.mount('target', 'TargetLanguageProvider'); await h.settle();
  const pending = deferred();
  h.api.updateProfile = data => data.targetLanguage === 'German' ? pending.promise : Promise.resolve({ ...user(A), targetLanguage: data.targetLanguage });
  const first = h.child.result.props.value.setTargetLanguage('German');
  const second = h.child.result.props.value.setTargetLanguage('French'); await second; await h.settle();
  pending.resolve({ ...user(A), targetLanguage: 'German' }); await first; await h.settle();
  assert.equal(h.auth().user.targetLanguage, 'French');
});
test('stale profile-name response cannot replace B authentication', async () => {
  const h = harness(); h.mountAuth(); h.login(A); h.mount('profile', 'ProfilePage'); await h.settle();
  h.child.exposed.setName('new name'); h.child.render();
  const pending = deferred(); h.api.updateProfile = () => pending.promise;
  const operation = h.child.exposed.handleSave(); await h.switchToB();
  pending.resolve({ ...user(A), name: 'new name' }); await operation; await h.settle();
  assert.equal(h.auth().user.id, B); assert.equal(h.child.exposed.saved, false);
});
test('login screen cannot apply an old login response after B is active', async () => {
  const h = harness(); h.mountAuth(); h.mount('authPage', 'AuthPage'); await h.settle();
  const pending = deferred(); h.api.login = () => pending.promise;
  const operation = h.child.exposed.handleSubmit({ preventDefault() {} }); await h.switchToB();
  const count = h.calls.length;
  pending.resolve({ user: user(A), access_token: `test-${A}` }); await operation; await h.settle();
  assert.equal(h.auth().user.id, B); assert.equal(h.calls.length, count);
});
test('current-session progress and flashcard responses still apply and cache', async () => {
  const h = harness(); h.isOffline = false; h.mountAuth(); h.login(B); h.mount('progress', 'ProgressProvider'); await h.settle();
  assert.equal(h.child.result.props.value.progress.totalXp, 20);
  assert.equal(JSON.parse(h.localStorage.getItem(`progress_registered_${B}_English`)).totalXp, 20);
  h.child.unmount(); h.isOffline = false; h.mount('cards', 'FlashcardsPage'); await h.settle();
  assert.equal(h.child.exposed.allCards[0].userId, B);
  assert.equal(JSON.parse(h.localStorage.getItem(`flashcards_all_${B}_English`))[0].userId, B);
});

async function offlineProgressHarness(initial) {
  const h = harness(initial); h.mountAuth(); if (!initial) h.login(A);
  await h.settle();
  h.serverProgress = progress(0); h.sent = [];
  h.fetchProgress = async () => h.serverProgress;
  h.saveProgress = async (id, lessonId, score, config) => {
    h.sent.push({ id, lessonId, score, operationId: config.headers['X-Idempotency-Key'] });
    h.serverProgress = { ...h.serverProgress, totalXp: h.serverProgress.totalXp + 50,
      completedLessonIds: [...h.serverProgress.completedLessonIds, lessonId] };
    return { data: { newTotalXp: h.serverProgress.totalXp, lessonId, score, xpEarned: 50 } };
  };
  h.mount('progress', 'ProgressProvider'); await h.settle();
  h.value = () => h.child.result.props.value;
  h.online = async () => { h.isOffline = false; h.child.render(); await h.settle(); };
  return h;
}

test('Phase 4E: offline 73 survives restart with owner, language, time and stable action ID', async () => {
  const h = await offlineProgressHarness();
  await h.value().completeLesson('one', 50, 73); await h.settle();
  const action = h.load('queue').getOfflineQueue()[0];
  assert.equal(action.payload.score, 73); assert.equal(action.payload.targetLanguage, 'English');
  assert.equal(action.ownerNamespace, `registered_${A}`); assert.ok(Date.parse(action.createdAt));
  const restarted = await offlineProgressHarness(h.snapshot());
  assert.equal(restarted.value().progress.totalXp, 50);
  await restarted.online();
  assert.equal(restarted.sent[0].score, 73); assert.equal(restarted.sent[0].operationId, action.id);
  assert.equal(restarted.load('queue').getOfflineQueue().length, 0);
  assert.equal(restarted.value().progress.totalXp, 50);
  assert.deepEqual(copy(restarted.value().progress.completedLessonIds), ['one']);
});

test('Phase 4E: failed completion remains over fresh server progress and never doubles XP', async () => {
  const h = await offlineProgressHarness(); await h.value().completeLesson('one', 50, 73);
  h.saveProgress = async () => { throw new Error('Upload failed'); };
  await h.online(); await h.value().reloadProgress(); await h.settle();
  assert.equal(h.load('queue').getOfflineQueue().length, 1);
  assert.equal(h.value().progress.totalXp, 50); assert.deepEqual(copy(h.value().progress.completedLessonIds), ['one']);
  assert.equal(JSON.parse(h.localStorage.getItem(`progress_registered_${A}_English`)).totalXp, 0);
  // The server may already have accepted a response-lost request.
  h.serverProgress = { ...progress(50), completedLessonIds: ['one'] };
  await h.value().reloadProgress(); await h.settle();
  assert.equal(h.value().progress.totalXp, 50); assert.equal(h.load('queue').getOfflineQueue().length, 1);
});

test('Phase 4E: acknowledgement retains server state even if subsequent GET fails', async () => {
  const h = await offlineProgressHarness(); await h.value().completeLesson('one', 50, 73);
  h.fetchProgress = async () => { throw new Error('GET failed'); }; await h.online();
  assert.equal(h.load('queue').getOfflineQueue().length, 0);
  assert.equal(h.value().progress.totalXp, 50); assert.deepEqual(copy(h.value().progress.completedLessonIds), ['one']);
  const restarted = await offlineProgressHarness(h.snapshot());
  assert.equal(restarted.value().progress.totalXp, 50);
});

test('Phase 4E: overlapping offline completions from the same render both survive', async () => {
  const h = await offlineProgressHarness(); const complete = h.value().completeLesson;
  await Promise.all([complete('one', 50, 73), complete('two', 80, 42)]); await h.settle();
  assert.equal(h.value().progress.totalXp, 130);
  assert.deepEqual(copy(h.value().progress.completedLessonIds), ['one', 'two']);
  assert.deepEqual(copy(h.load('queue').getOfflineQueue().map(a => a.payload.score)), [73, 42]);
  const restarted = await offlineProgressHarness(h.snapshot()); assert.equal(restarted.value().progress.totalXp, 130);
});

test('Phase 4E: append during GET wins over server snapshot, without lost pending progress', async () => {
  const h = await offlineProgressHarness(); await h.online();
  const pending = deferred(); h.fetchProgress = () => pending.promise;
  const refresh = h.value().reloadProgress(); await tick();
  h.load('queue').pushToOfflineQueue('complete-lesson', { lessonId: 'new', score: 73,
    xpReward: 50, targetLanguage: 'English' }, `registered_${A}`);
  pending.resolve(progress(0)); await refresh; await h.settle();
  assert.equal(h.value().progress.totalXp, 50); assert.deepEqual(copy(h.value().progress.completedLessonIds), ['new']);
});

test('Phase 4E: pending completions cannot cross account or language boundaries', async () => {
  const h = await offlineProgressHarness(); await h.value().completeLesson('english-one', 50, 73); await h.settle();
  h.language = 'German'; h.localStorage.setItem('linguaai_target_language', 'German'); h.child.render(); await h.settle();
  assert.equal(h.value().progress.totalXp, 0);
  await h.switchToB(); assert.equal(h.value().progress.totalXp, 0);
  h.auth().logout(); h.login(A); h.language = 'English'; h.localStorage.setItem('linguaai_target_language', 'English');
  h.child.render(); await h.settle(); assert.equal(h.value().progress.totalXp, 50);
});

test('Phase 4E: offline reset cancels obsolete completions, survives restart, keeps later work', async () => {
  const h = await offlineProgressHarness(); await h.value().completeLesson('obsolete', 50, 73);
  await h.value().resetProgress(); await h.settle();
  assert.equal(h.value().progress.totalXp, 0);
  await h.value().completeLesson('after-reset', 50, 42); await h.settle();
  const restarted = await offlineProgressHarness(h.snapshot()); let resets = 0;
  restarted.resetProgress = async () => { resets++; restarted.serverProgress = progress(0); };
  await restarted.online();
  assert.equal(resets, 1); assert.deepEqual(restarted.sent.map(a => a.lessonId), ['after-reset']);
  assert.equal(restarted.value().progress.totalXp, 50);
});

test('Phase 4E: pending reset masks old server GET when reset upload fails', async () => {
  const h = await offlineProgressHarness(); await h.value().completeLesson('obsolete', 50, 73);
  await h.value().resetProgress(); h.serverProgress = { ...progress(500), completedLessonIds: ['obsolete'] };
  h.resetProgress = async () => { throw new Error('Reset unavailable'); }; await h.online();
  assert.equal(h.value().progress.totalXp, 0); assert.deepEqual(copy(h.value().progress.completedLessonIds), []);
  assert.equal(h.load('queue').getOfflineQueue()[0].type, 'reset-progress');
});

test('Phase 4E: reset waits behind active completion and cannot be undone by its response', async () => {
  const h = await offlineProgressHarness(); await h.online();
  const started = deferred(), release = deferred(); const events = [];
  h.saveProgress = async () => { started.resolve(); await release.promise; events.push('complete');
    h.serverProgress = { ...progress(50), completedLessonIds: ['obsolete'] };
    return { data: { newTotalXp: 50 } }; };
  h.resetProgress = async () => { events.push('reset'); h.serverProgress = progress(0); };
  const complete = h.value().completeLesson('obsolete', 50, 73); await started.promise;
  const reset = h.value().resetProgress(); await tick();
  assert.equal(h.load('queue').getOfflineQueue()[0].type, 'reset-progress');
  release.resolve(); await Promise.all([complete, reset]); await h.settle();
  assert.deepEqual(events, ['complete', 'reset']); assert.equal(h.value().progress.totalXp, 0);
  assert.equal(h.load('queue').getOfflineQueue().length, 0);
});

test('Phase 4E: owner-scoped legacy action lacking a score is retained without inventing 100', async () => {
  const h = await offlineProgressHarness(); h.load('queue').pushToOfflineQueue('complete-lesson', { lessonId: 'unknown-score' }, `registered_${A}`);
  await h.online(); assert.equal(h.sent.length, 0); assert.equal(h.load('queue').getOfflineQueue().length, 0);
  assert.equal(h.load('queue').getFailedOfflineActions().length, 1);
});


test('Phase 4E: valid legacy owned score gains cached lesson context without ID replacement', async () => {
  const h = await offlineProgressHarness();
  h.localStorage.setItem('linguaai_lessons_English', JSON.stringify([{ id: 'legacy', xpReward: 50, targetLanguage: 'English' }]));
  h.load('queue').pushToOfflineQueue('complete-lesson', { lessonId: 'legacy', score: 73 }, `registered_${A}`);
  const id = h.load('queue').getOfflineQueue()[0].id;
  await h.value().reloadProgress(); await h.settle();
  assert.equal(h.value().progress.totalXp, 50);
  const migrated = h.load('queue').getOfflineQueue()[0];
  assert.equal(migrated.id, id); assert.equal(migrated.payload.score, 73);
  h.saveProgress = async () => { throw new Error('Unavailable'); }; await h.online();
  assert.deepEqual(copy(h.value().progress.completedLessonIds), ['legacy']);
  h.language = 'German'; h.localStorage.setItem('linguaai_target_language', 'German'); h.isOffline = true;
  h.child.render(); await h.settle(); assert.equal(h.value().progress.totalXp, 0);
});

test('Phase 4E: score zero stays zero and cached unscored IDs never generate uploads', async () => {
  const h = await offlineProgressHarness();
  h.localStorage.setItem(`progress_registered_${A}_English`, JSON.stringify({ ...progress(0), completedLessonIds: ['unscored'] }));
  await h.value().completeLesson('zero', 50, 0); await h.online();
  assert.equal(h.sent.length, 1); assert.equal(h.sent[0].score, 0);
});

test('Phase 4E: reset clears attributable legacy caches in every language', async () => {
  const h = await offlineProgressHarness();
  const legacy = h.load('userKey').getLegacyRegisteredProgressKey(user(A).email, false);
  h.localStorage.setItem(`progress_${legacy}_German`, JSON.stringify({ ...progress(500), completedLessonIds: ['old-german'] }));
  await h.value().resetProgress();
  h.language = 'German'; h.localStorage.setItem('linguaai_target_language', 'German'); h.child.render(); await h.settle();
  assert.equal(h.value().progress.totalXp, 0); assert.equal(h.localStorage.getItem(`progress_${legacy}_German`), null);
});

test('Phase 4E: older same-session refresh cannot replace newer acknowledged state', async () => {
  const h = await offlineProgressHarness(); await h.online();
  const old = deferred(); h.fetchProgress = () => old.promise;
  const first = h.value().reloadProgress(); await tick();
  h.fetchProgress = async () => ({ ...progress(100), completedLessonIds: ['newer'] });
  await h.value().reloadProgress(); old.resolve(progress(0)); await first; await h.settle();
  assert.equal(h.value().progress.totalXp, 100); assert.deepEqual(copy(h.value().progress.completedLessonIds), ['newer']);
});


test('Phase 4E: deferred React updater checks session again before applying pending overlay', async () => {
  const h = await offlineProgressHarness(); h.deferChildState = true;
  await h.value().completeLesson('a-pending', 50, 73);
  await h.switchToB();
  for (const update of h.deferredState.splice(0)) update();
  h.deferChildState = false; await h.settle();
  assert.equal(h.value().progress.totalXp, 0); assert.deepEqual(copy(h.value().progress.completedLessonIds), []);
  assert.equal(h.load('queue').getOfflineQueue().length, 0);
  h.auth().logout(); h.login(A); h.child.render(); await h.settle();
  assert.equal(h.value().progress.totalXp, 50);
});
