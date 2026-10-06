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
  const h = { localStorage, calls, timers, language: 'English', isOffline: true };
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
  h.transport = async (method, url) => {
    if (method === 'get') {
      const id = url.includes(A) ? A : B;
      return { data: [card(id)] };
    }
    return { data: card(A) };
  };
  const depsEqual = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    createContext: () => ({ Provider: 'provider' }), useContext: () => {},
    useState: initial => {
      const r = activeRunner, i = r.cursor++;
      if (!(i in r.slots)) r.slots[i] = typeof initial === 'function' ? initial() : initial;
      return [r.slots[i], value => {
        const next = typeof value === 'function' ? value(r.slots[i]) : value;
        r.writes++;
        if (!Object.is(next, r.slots[i])) r.dirty = true;
        r.slots[i] = next;
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
    guard: 'utils/useSessionGuard.ts', auth: 'context/AuthContext.tsx',
    storage: 'utils/progressStorage.ts', types: 'types/progress.ts',
    progress: 'context/ProgressContext.tsx', target: 'context/TargetLanguageContext.tsx',
    cards: 'pages/FlashcardsPage.tsx', queue: 'utils/offlineQueue.ts', authPage: 'components/auth/AuthPage.tsx',
    profile: 'pages/ProfilePage.tsx' };
  const exposed = {
    cards: 'fetchCards, handleSaveCard, handleDeleteCard, handleStudyScore, handleOpenAdd, handleOpenEdit, setFormData, allCards, dueCards, loading, error, successMsg, modal, studyResults',
    authPage: 'handleSubmit, setEmail, setPassword, loading, error',
    profile: 'handleSave, setName, saved',
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
      module, exports: module.exports, localStorage, __capture: value => { activeRunner.exposed = value; },
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
        if (path.endsWith('/ProgressContext')) return { useProgress: () => ({ progress: progress() }) };
        if (path.endsWith('/authApi')) return new Proxy({}, { get: (_, method) => (...args) => api[method](...args) });
        if (path.endsWith('/progressApi')) return {
          fetchProgress: (id, lang) => { calls.push(['fetch', id, lang]); return h.fetchProgress(id, lang); },
          saveProgressToBackend: (...args) => { calls.push(['complete', ...args]); return h.saveProgress(...args); },
          resetProgressInBackend: (...args) => h.resetProgress(...args),
        };
        if (path.endsWith('/offlineQueue')) return {
          processOfflineQueue: (...args) => h.drain(...args),
          isPendingBackendCard: (...args) => h.queue?.isPendingBackendCard(...args) ?? false,
          pushToOfflineQueue: (...args) => h.queue?.pushToOfflineQueue(...args),
        };
        if (path.endsWith('/apiClient')) return Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method,
          (url, data) => { calls.push([method, url]); return h.transport(method, url, data); }]));
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
  h.mountAuth = () => { h.authRunner = runner('auth', 'AuthProvider'); };
  h.auth = () => h.authRunner.result.props.value;
  h.login = id => { h.auth().login(user(id), `test-${id}`); h.authRunner.render(); };
  h.mount = (name, symbol) => { h.child = runner(name, symbol); };
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
    const h = harness(); h.mountAuth(); h.login(A); h.mount('progress', 'ProgressProvider'); await h.settle();
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

for (const kind of ['fetch', 'create', 'update', 'delete', 'review', 'failed-create', 'drain', 'language', 'unmount']) {
  test(`flashcards discard stale ${kind} UI/cache changes`, async () => {
    const h = harness(); h.isOffline = false; h.mountAuth(); h.login(A);
    h.mount('cards', 'FlashcardsPage'); await h.settle();
    const pending = deferred(); let operation;
    const originalTransport = h.transport;
    if (kind === 'drain') {
      h.drain = id => id === A ? pending.promise : Promise.resolve(false);
      h.isOffline = true; h.child.render(); h.isOffline = false; h.child.render();
    } else {
      if (['create', 'failed-create'].includes(kind)) h.child.exposed.handleOpenAdd();
      if (kind === 'update') h.child.exposed.handleOpenEdit(card(A));
      h.child.exposed.setFormData({ targetWord: 'new', turkishTranslation: 'translation' }); h.child.render();
      h.transport = (method, url, data) => url.includes(B) ? originalTransport(method, url, data) : pending.promise;
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
    else pending.resolve(kind === 'drain' ? true : { data: [card(A)] });
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
  const h = harness(); h.mountAuth(); h.login(B); h.mount('progress', 'ProgressProvider'); await h.settle();
  assert.equal(h.child.result.props.value.progress.totalXp, 20);
  assert.equal(JSON.parse(h.localStorage.getItem(`progress_registered_${B}_English`)).totalXp, 20);
  h.child.unmount(); h.isOffline = false; h.mount('cards', 'FlashcardsPage'); await h.settle();
  assert.equal(h.child.exposed.allCards[0].userId, B);
  assert.equal(JSON.parse(h.localStorage.getItem(`flashcards_all_${B}_English`))[0].userId, B);
});
