const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const { createRequire } = require('node:module');

function load(path) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText, { module, exports: module.exports, require: createRequire(path) });
  return module.exports;
}
const backend = load(join(__dirname, '../../lingua_ai_backend/src/common/xp-level.ts'));
const web = load(join(__dirname, '../src/utils/levelUtils.ts'));

test('6B: web displays backend levels at every boundary without a fictitious next Advanced level', () => {
  for (const xp of [0, 199, 200, 201, 499, 500, 501, 899, 900, 901, 1399, 1400, 1401, 2199, 2200, 2201, 10000]) {
    assert.equal(web.getLevelFromXp(xp), backend.deriveLevel(xp));
    assert.equal(web.getProgressToNextLevel(xp).currentLevel, backend.deriveLevel(xp));
  }
  for (const xp of [2200, 2201, 10000]) {
    const meter = web.getProgressToNextLevel(xp);
    assert.equal(meter.progress, 100); assert.equal(meter.xpRemaining, 0);
    assert.equal(meter.nextLevel, 'Max');
  }
  for (const xp of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => web.getLevelFromXp(xp));
    assert.throws(() => web.getProgressToNextLevel(xp));
  }
});
