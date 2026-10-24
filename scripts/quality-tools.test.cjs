const { test } = require('node:test');
const assert = require('node:assert/strict');
const { forbiddenPath } = require('./check-hygiene.cjs');
const { novel, fingerprints } = require('./lint-ratchet.cjs');
test('artifact gate blocks runtime/config/signing paths and permits source examples/assets', () => {
  for (const path of ['a/__pycache__/main.pyc', 'a/model-cache/weights.bin', 'a/.env', 'a/.env.staging', 'a/key.properties',
    'a/private.pem', 'lingua_ai_backend/uploads/image.png', 'a/node_modules/x.js']) assert.equal(forbiddenPath(path), true, path);
  for (const path of ['a/.env.example', 'a/.env.production.example', 'a/config.py', 'a/assets/audio/source.wav']) assert.equal(forbiddenPath(path), false, path);
});
test('lint ratchet permits moved historical diagnostics, rejects new/duplicated diagnostics', () => {
  const result = line => ({ messages: [{ ruleId: 'test-rule', severity: 2, message: 'unsafe', line }] });
  const before = fingerprints(result(1), 'old();');
  const moved = fingerprints(result(2), '// comment\nold();');
  assert.equal(novel(moved, before).length, 0);
  assert.equal(novel([...moved, ...moved], before).length, 1);
  assert.equal(novel(fingerprints(result(1), 'new();'), before).length, 1);
});

test('new quality tooling and real DOM regression use read-only core ESLint checks', async () => {
  const { ESLint } = require('../lingua_ai_backend/node_modules/eslint');
  const js = require('../lingua_ai_backend/node_modules/@eslint/js');
  const globals = require('../lingua_ai_backend/node_modules/globals');
  const eslint = new ESLint({ overrideConfigFile: true, fix: false,
    overrideConfig: [js.configs.recommended, { languageOptions: { globals: { ...globals.node, ...globals.browser } } }] });
  const results = await eslint.lintFiles(['scripts/*.cjs', 'lingua_ai_web/test/react-runtime.test.cjs']);
  assert.equal(results.reduce((count, result) => count + result.errorCount + result.warningCount, 0), 0,
    JSON.stringify(results.flatMap(result => result.messages)));
});
