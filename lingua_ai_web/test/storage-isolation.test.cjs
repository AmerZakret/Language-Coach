const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function loadModule(path, dependencies = {}, globals = {}) {
  const source = readFileSync(join(__dirname, '../src', path), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, ...globals,
    require: name => {
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return module.exports;
}

const userKeys = loadModule('utils/userKey.ts');
const { getUserProgressKey, getLegacyRegisteredProgressKey } = userKeys;
const { DEFAULT_PROGRESS } = loadModule('types/progress.ts');
const guestA = { id: '507f1f77bcf86cd799439011', email: 'guest-a@guest.lingua.local' };
const guestB = { id: '507f1f77bcf86cd799439012', email: 'guest-b@guest.lingua.local' };

function storageFixture() {
  const values = new Map();
  const localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  return { localStorage, ...loadModule('utils/progressStorage.ts', {
    '../types/progress': { DEFAULT_PROGRESS },
    './targetLanguage': loadModule('utils/targetLanguage.ts'),
  }, { localStorage }) };
}

test('Guest A and B store progress separately and a restored guest reads the same cache', () => {
  const { saveProgress, loadProgress, getProgressStorageKey, localStorage } = storageFixture();
  const keyA = getUserProgressKey(guestA, true, 'token-a');
  const keyB = getUserProgressKey(guestB, true, 'token-b');
  assert.equal(keyA, `guest_${guestA.id}`);
  assert.equal(keyB, `guest_${guestB.id}`);
  assert.notEqual(getProgressStorageKey(keyA, 'English'), getProgressStorageKey(keyB, 'English'));
  saveProgress(keyA, 'English', { ...DEFAULT_PROGRESS, available: true, totalXp: 10, completedLessonIds: ['a'] });
  assert.equal(loadProgress(keyB, 'English').totalXp, 0);
  saveProgress(keyB, 'English', { ...DEFAULT_PROGRESS, available: true, totalXp: 20, completedLessonIds: ['b'] });

  localStorage.setItem('linguaai_user', JSON.stringify(guestA));
  const restoredA = JSON.parse(localStorage.getItem('linguaai_user'));
  // Reload the helper module too, so the result cannot rely on in-memory identity.
  const restoredKey = loadModule('utils/userKey.ts').getUserProgressKey(restoredA, true, 'token-a');
  assert.equal(restoredKey, keyA);
  assert.equal(loadProgress(restoredKey, 'English').totalXp, 10);
  assert.equal(loadProgress(keyB, 'English').totalXp, 20);
  assert.equal(loadProgress(keyA, 'German').totalXp, 0);
});

test('registered keys survive refresh and email changes; legacy member caches migrate once', () => {
  const { saveProgress, loadProgress, resetProgress, localStorage } = storageFixture();
  const member = { id: guestA.id, email: 'member@example.com' };
  const key = getUserProgressKey(member, false, 'member-token');
  assert.equal(key, `registered_${member.id}`);
  assert.equal(getUserProgressKey(JSON.parse(JSON.stringify(member)), false, 'member-token'), key);
  assert.equal(getUserProgressKey({ ...member, email: 'updated@example.com' }, false, 'member-token'), key);
  assert.notEqual(key, getUserProgressKey(guestA, true, 'token-a'));
  const legacyKey = getLegacyRegisteredProgressKey(member.email, false);
  saveProgress(legacyKey, 'English', { ...DEFAULT_PROGRESS, available: true, totalXp: 42 });
  assert.equal(loadProgress(key, 'English', legacyKey).totalXp, 42);
  assert.ok(localStorage.getItem(`progress_${key}_English`));
  assert.equal(localStorage.getItem(`progress_${legacyKey}_English`), null);
  saveProgress(legacyKey, 'English', { ...DEFAULT_PROGRESS, available: true, totalXp: 999 });
  assert.equal(loadProgress(key, 'English', legacyKey).totalXp, 42);
  resetProgress(key, 'English');
  assert.equal(loadProgress(key, 'English', legacyKey).totalXp, 0);
});

test('offline-only guests have a separate namespace and never inherit shared legacy guest progress', () => {
  const { loadProgress, saveProgress } = storageFixture();
  const localKey = getUserProgressKey({ id: 'guest', email: 'guest@lingua.ai' }, true, null);
  assert.equal(localKey, 'local_guest');
  assert.equal(getUserProgressKey(guestA, true, null), localKey);
  assert.equal(getUserProgressKey({ id: 'guest' }, true, 'stale-token'), localKey);
  assert.equal(getUserProgressKey(null), localKey);
  for (const guest of [guestA, guestB]) {
    const key = getUserProgressKey(guest, true, 'guest-token');
    assert.notEqual(key, localKey);
    assert.equal(getLegacyRegisteredProgressKey(guest.email, true), undefined);
    saveProgress(key, 'English', { ...DEFAULT_PROGRESS, available: true, totalXp: 10 });
  }
  saveProgress('guest', 'English', { ...DEFAULT_PROGRESS, available: true, totalXp: 999 });
  assert.equal(loadProgress(localKey, 'English').totalXp, 0);
});
