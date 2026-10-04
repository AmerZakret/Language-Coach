const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the actual AuthProvider with in-memory hooks, storage, and API calls.
// No browser, live backend, or additional test dependencies are required.
const source = readFileSync(join(__dirname, '../src/context/AuthContext.tsx'), 'utf8')
  .replace('import.meta.env.VITE_API_URL', 'undefined');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const keyModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(
  readFileSync(join(__dirname, '../src/utils/userKey.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText, { module: keyModule, exports: keyModule.exports });
const progressKey = context => keyModule.exports.getUserProgressKey(
  context.user, context.isGuest, context.token,
);

function storage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

async function mount(localStorage, fetch, fetchMe = async () => {
  throw new Error('Unexpected profile request');
}) {
  const state = [];
  const effects = [];
  let cursor = 0;
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
    useEffect: callback => { effects.push(callback); },
    createElement: (type, props) => ({ type, props }),
  };
  const module = { exports: {} };
  const sessionModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(
    readFileSync(join(__dirname, '../src/utils/queueSession.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText, { module: sessionModule, exports: sessionModule.exports, localStorage,
    require: name => {
      if (name === './userKey') return keyModule.exports;
      throw new Error(`Unexpected session import: ${name}`);
    },
  });
  vm.runInNewContext(compiled, {
    module, exports: module.exports, localStorage, fetch,
    require: name => {
      if (name === 'react') return react;
      if (name === '../api/authApi') return { fetchMe };
      if (name === '../utils/queueSession') return sessionModule.exports;
      if (name === '../utils/userKey') return keyModule.exports;
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const context = () => {
    cursor = 0;
    return module.exports.AuthProvider({ children: null }).props.value;
  };
  context();
  for (const effect of [...effects]) effect();
  await new Promise(resolve => setImmediate(resolve));
  return context;
}

function backendGuest(index) {
  return {
    access_token: `test-only-guest-token-${index}`,
    user: { id: index === 1 ? '507f1f77bcf86cd799439011' : '507f1f77bcf86cd799439012',
      name: 'Guest User', email: `guest-test-${index}@guest.lingua.local`,
      targetLanguage: 'English', isGuest: true },
  };
}

test('guest login persists the full backend user, ID, and token across refresh', async () => {
  const saved = storage();
  const guest = backendGuest(1);
  let calls = 0;
  const fetch = async () => { calls++; return { ok: true, json: async () => guest }; };
  const context = await mount(saved, fetch);
  await context().loginAsGuest();
  assert.equal(context().user.id, guest.user.id);
  assert.equal(context().user.email, guest.user.email);
  assert.equal(context().user.targetLanguage, 'English');
  assert.deepEqual(JSON.parse(saved.getItem('linguaai_user')), guest.user);
  assert.equal(saved.getItem('linguaai_token'), guest.access_token);
  const keyBeforeRefresh = progressKey(context());
  assert.equal(keyBeforeRefresh, `guest_${guest.user.id}`);
  const refreshed = await mount(saved, fetch);
  assert.equal(refreshed().user.id, guest.user.id);
  assert.equal(refreshed().token, guest.access_token);
  assert.equal(refreshed().isGuest, true);
  assert.equal(progressKey(refreshed()), keyBeforeRefresh);
  assert.equal(calls, 1, 'refresh must not create another guest account');
});

test('an explicit new guest session after logout receives a new identity', async () => {
  const saved = storage();
  let calls = 0;
  const context = await mount(saved, async () => ({
    ok: true, json: async () => backendGuest(++calls),
  }));
  await context().loginAsGuest();
  const firstId = context().user.id;
  const firstKey = progressKey(context());
  context().logout();
  assert.equal(saved.getItem('linguaai_token'), null);
  await context().loginAsGuest();
  assert.notEqual(context().user.id, firstId);
  assert.notEqual(progressKey(context()), firstKey);
  assert.equal(calls, 2);
});

test('unavailable backend falls back to an offline guest without a stale token', async () => {
  const saved = storage();
  saved.setItem('linguaai_token', 'previous-test-token');
  saved.setItem('linguaai_is_guest', 'true');
  const context = await mount(saved, async () => { throw new Error('Offline'); });
  await context().loginAsGuest();
  assert.equal(context().user.id, 'guest');
  assert.equal(context().token, null);
  assert.equal(progressKey(context()), 'local_guest');
  assert.equal(saved.getItem('linguaai_token'), null);
  const refreshed = await mount(saved, async () => { throw new Error('Unexpected request'); });
  assert.equal(refreshed().user.id, 'guest');
  assert.equal(refreshed().token, null);
  assert.equal(progressKey(refreshed()), 'local_guest');
});

test('a token without a real backend guest ID is never retained', async () => {
  const saved = storage();
  const context = await mount(saved, async () => ({ ok: true, json: async () => ({
    access_token: 'test-only-token', user: { id: 'guest', name: 'Guest User',
      email: 'guest-test@guest.lingua.local' },
  }) }));
  await context().loginAsGuest();
  assert.equal(context().token, null);
  assert.equal(saved.getItem('linguaai_token'), null);
});

test('legacy shared or malformed guest storage loses backend authorization', async () => {
  for (const storedUser of [null, '{invalid-json', JSON.stringify({
    id: '507f1f77bcf86cd799439011', name: 'Guest User', email: 'guest@lingua.ai',
  })]) {
    const saved = storage();
    saved.setItem('linguaai_is_guest', 'true');
    saved.setItem('linguaai_token', 'legacy-test-token');
    if (storedUser) saved.setItem('linguaai_user', storedUser);
    const context = await mount(saved, async () => { throw new Error('Unexpected request'); });
    assert.equal(context().user.id, 'guest');
    assert.equal(context().token, null);
    assert.equal(saved.getItem('linguaai_token'), null);
  }
});

test('normal login and profile restoration preserve existing behavior', async () => {
  const saved = storage();
  const user = { id: '507f1f77bcf86cd799439013', name: 'Normal User',
    email: 'normal@example.com', isGuest: false };
  const context = await mount(saved, async () => { throw new Error('Unexpected guest call'); });
  context().login(user, 'normal-test-token');
  const keyBeforeRefresh = progressKey(context());
  const refreshed = await mount(saved, async () => { throw new Error('Unexpected guest call'); },
    async () => user);
  assert.equal(refreshed().user.id, user.id);
  assert.equal(refreshed().token, 'normal-test-token');
  assert.equal(refreshed().isGuest, false);
  assert.equal(progressKey(refreshed()), keyBeforeRefresh);
  assert.equal(keyBeforeRefresh, `registered_${user.id}`);
});
