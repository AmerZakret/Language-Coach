const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const A = 'registered_507f1f77bcf86cd799439011';
const B = 'registered_507f1f77bcf86cd799439012';
function harness() {
  const values = new Map(), modules = new Map();
  const localStorage = { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key),
    get length() { return values.size; }, key: i => [...values.keys()][i] ?? null };
  const h = { values, localStorage, get: async () => ({ data: {
    progressEpoch: 0, stats: { totalXp: 50, streak: 0 }, completedLessons: [{ lessonId: 'one', score: 73 }],
  } }) };
  function load(path) {
    const file = resolve(__dirname, '../src', path);
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, esModuleInterop: true,
    } }).outputText, { module, exports: module.exports, localStorage, console,
      require: name => {
        if (name.endsWith('/apiClient')) return { __esModule: true, default: { get: (...args) => h.get(...args) } };
        if (name.endsWith('/queueSession')) return { getSessionRequestConfig: () => ({ sessionSnapshot: { userId: A } }) };
        return load(resolve(dirname(file), name) + '.ts');
      } });
    return module.exports;
  }
  return Object.assign(h, { load, store: load('utils/progressStorage.ts'), api: load('api/progressApi.ts'), policy: load('utils/syncRetryPolicy.ts') });
}
const valid = { totalXp: 50, streak: 0, completedLessonIds: ['one'], lessonScores: { one: 73 }, weeklyActivity: [0, 0, 0, 0, 0, 0, 0], progressEpoch: 0 };

test('6C: corrupt caches are unavailable, remain intact and cannot be persisted as authoritative zero', () => {
  const { store, localStorage } = harness();
  for (const raw of ['bad JSON', 'null', '[]', JSON.stringify({ ...valid, totalXp: -1 }),
    JSON.stringify({ ...valid, completedLessonIds: [null] }), JSON.stringify({ ...valid, totalXp: 0.5 }),
    JSON.stringify({ ...valid, weeklyActivity: ['bad'] }), JSON.stringify({ ...valid, lessonScores: { one: 101 } })]) {
    localStorage.setItem(`progress_${A}_English`, raw);
    const snapshot = store.loadProgress(A, 'en');
    assert.equal(snapshot.available, false);
    assert.throws(() => store.saveProgress(A, 'English', snapshot));
    assert.equal(localStorage.getItem(`progress_${A}_English`), raw);
  }
});
test('6C: pending/ack duplicates keep one count and award, with best justified score', () => {
  const { store } = harness();
  const overlay = store.overlayPendingProgress(valid, [{ lessonId: 'one', score: 91, xpReward: 50 },
    { lessonId: 'one', score: 20, xpReward: 50 }, { lessonId: 'two', score: 42, xpReward: 80 },
    { lessonId: 'two', score: 20, xpReward: 80 }], false);
  assert.equal(overlay.totalXp, 130); assert.equal(overlay.completedLessonIds.length, 2);
  assert.equal(overlay.lessonScores.one, 91); assert.equal(overlay.lessonScores.two, 42);
  assert.equal(valid.lessonScores.one, 73);
});
test('6C: reset clears canonical and historical language keys only for its owner', () => {
  const { store, localStorage } = harness();
  for (const language of ['en', 'English', 'de', 'German', 'german']) {
    localStorage.setItem(`progress_${A}_${language}`, 'A');
    localStorage.setItem(`progress_${B}_${language}`, 'B');
  }
  localStorage.setItem(`progress_epoch_${A}`, '1'); localStorage.setItem(`flashcards_${A}_en`, 'cards');
  localStorage.setItem(`progress_${A}_settings`, 'unrelated');
  store.resetOwnerProgress(A);
  for (const language of ['en', 'English', 'de', 'German', 'german']) {
    assert.equal(localStorage.getItem(`progress_${A}_${language}`), null);
    assert.equal(localStorage.getItem(`progress_${B}_${language}`), 'B');
  }
  assert.equal(localStorage.getItem(`progress_epoch_${A}`), '1');
  assert.equal(localStorage.getItem(`flashcards_${A}_en`), 'cards');
  assert.equal(localStorage.getItem(`progress_${A}_settings`), 'unrelated');
});
test('6C: acknowledgement prefers server lesson language, updates its score and rejects stale epochs', () => {
  const { store } = harness(); store.acknowledgeProgressEpoch(A, 0);
  store.saveProgress(A, 'de', { ...valid, totalXp: 200, completedLessonIds: ['german'], lessonScores: { german: 80 } });
  store.acknowledgeCompletion(A, { lessonId: 'one', targetLanguage: 'German' },
    { newTotalXp: 50, score: 91, progressEpoch: 0, targetLanguage: 'en' });
  assert.equal(store.loadProgress(A, 'en').lessonScores.one, 91);
  assert.equal(store.loadProgress(A, 'de').totalXp, 200);
  store.acknowledgeProgressEpoch(A, 1); store.saveProgress(A, 'en', { ...valid, totalXp: 80, progressEpoch: 1 });
  store.acknowledgeCompletion(A, { lessonId: 'one', targetLanguage: 'English' }, { newTotalXp: 999, score: 100, progressEpoch: 0 });
  assert.equal(store.loadProgress(A, 'en').totalXp, 80);
});
for (const [status, category, terminal] of [[401, 'authentication', false], [400, 'validation', true], [403, 'forbidden', true], [503, 'backend', false], [429, 'rate-limited', false]]) {
  test(`6C: GET ${status} preserves its error for ${category} reconciliation`, async () => {
    const h = harness(), error = { response: { status } }; h.get = async () => { throw error; };
    await assert.rejects(h.api.fetchProgress(A, 'en'), e => e === error);
    const classification = h.policy.classifySyncFailure(error);
    assert.equal(classification.category, category); assert.equal(classification.terminal, terminal);
  });
}
test('6C: unreachable GET rejects rather than returning empty progress; valid response preserves scores', async () => {
  const h = harness(), error = new Error('unreachable'); const normal = h.get;
  h.get = async () => { throw error; };
  await assert.rejects(h.api.fetchProgress(A, 'en'), e => e === error);
  assert.equal(h.policy.classifySyncFailure(error).category, 'network');
  h.get = normal; const result = await h.api.fetchProgress(A, 'en');
  assert.equal(result.available, true); assert.equal(result.lessonScores.one, 73);
  h.get = async () => ({ data: {} });
  await assert.rejects(h.api.fetchProgress(A, 'en'), /Invalid progress response/);
});
