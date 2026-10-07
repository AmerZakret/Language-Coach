const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function apiModule(fileName, client) {
  function load(file) {
    const module = { exports: {} };
    vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText, { module, exports: module.exports, localStorage: { getItem: () => null }, require: name =>
      name.endsWith('/apiClient') ? { __esModule: true, default: client }
        : load(resolve(dirname(file), `${name}.ts`)) });
    return module.exports;
  }
  return load(resolve(__dirname, '../src/api', fileName));
}
const writingApi = send => apiModule('aiCoachApi.ts', { post: send });
const evaluation = { grammarScore: 85.75, vocabularyScore: 0, clarityScore: 7.25,
  overallScore: 8.5, corrections: [{ original: 'a', correction: 'b', explanation: 'why' }],
  feedback: 'Useful feedback', improvedVersion: 'Better text' };
const input = { topic: 'Greeting', text: 'Hello', language: 'en', targetLanguage: 'German' };

test('writing percentages preserve decimals and feedback at the web API boundary', async () => {
  const api = writingApi(async (_url, data) => {
    assert.equal(data.targetLanguage, 'de'); return { data: evaluation };
  });
  assert.deepEqual(await api.checkWriting(input), evaluation);
});
for (const score of [null, '85', 101, -1, NaN]) {
  test(`malformed writing score ${score} cannot be interpreted as success`, async () => {
    const api = writingApi(async () => ({ data: { ...evaluation, grammarScore: score } }));
    await assert.rejects(api.checkWriting(input), /invalid writing evaluation/);
  });
}
for (const status of [400, 401, 502, 503]) {
  test(`writing HTTP ${status} keeps its status instead of producing scores`, async () => {
    const failure = { response: { status, data: { message: 'Public error' } } };
    const api = writingApi(async () => { throw failure; });
    await assert.rejects(api.checkWriting(input), error => error === failure);
  });
}

for (const isGuest of [false, true]) {
  test(`web auth and profile preserve the public identity (guest: ${isGuest})`, async () => {
    const user = { id: '507f1f77bcf86cd799439011', name: 'Test',
      email: isGuest ? 'guest-a@guest.lingua.local' : 'test@example.com', isGuest, targetLanguage: 'de' };
    const api = apiModule('authApi.ts', {
      post: async () => ({ data: { user, access_token: 'valid-token' } }),
      get: async () => ({ data: user }), patch: async () => ({ data: user }),
    });
    assert.deepEqual((await api.login(user.email, 'password')).user, user);
    assert.deepEqual((await api.register(user.name, user.email, 'password')).user, user);
    assert.deepEqual(await api.fetchMe(), user);
    assert.deepEqual(await api.updateProfile({ name: 'Test' }), user);
  });
}

test('web rejects incomplete auth/profile identities instead of inventing defaults', async () => {
  const user = { id: '507f1f77bcf86cd799439011', name: 'Test', email: 'test@example.com', targetLanguage: 'en' };
  const api = apiModule('authApi.ts', {
    post: async () => ({ data: { user, access_token: 'valid-token' } }),
    get: async () => ({ data: user }), patch: async () => ({ data: user }),
  });
  await assert.rejects(api.login(user.email, 'password'), /incomplete user profile/);
  await assert.rejects(api.register(user.name, user.email, 'password'), /incomplete user profile/);
  await assert.rejects(api.fetchMe(), /incomplete user profile/);
  await assert.rejects(api.updateProfile({ name: 'Test' }), /incomplete user profile/);
});
