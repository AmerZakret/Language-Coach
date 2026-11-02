const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const moduleExports = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../build-config/api-url.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { module: moduleExports, exports: moduleExports.exports, URL });
const { validateApiUrl } = moduleExports.exports;

for (const value of [undefined, '', 'http://localhost:3000', 'https://127.0.0.1', 'https://[::1]',
  'https://10.0.2.2', 'https://192.168.1.2', 'https://172.16.0.1', 'https://2130706433',
  'https://api.local', 'http://api.example.invalid', 'https://user:password@api.example.invalid']) {
  test(`production rejects missing/local/unsafe API configuration ${String(value).replace(/\/\/.*@/, '//[redacted]@')}`, () => {
    assert.throws(() => validateApiUrl(value, true), /VITE_API_URL/);
  });
}
test('development allows localhost default and explicit local values', () => {
  assert.equal(validateApiUrl(undefined, false), 'http://localhost:3000');
  assert.equal(validateApiUrl('http://localhost:3000/', false), 'http://localhost:3000');
});
test('production accepts explicit public HTTPS and documented self-hosted override', () => {
  assert.equal(validateApiUrl(' https://api.example.invalid/ ', true), 'https://api.example.invalid');
  assert.equal(validateApiUrl('http://localhost:3000', true, true), 'http://localhost:3000');
  assert.throws(() => validateApiUrl(undefined, true, true));
});
test('Vite validates every build, including custom modes, and embeds validated URL', () => {
  const source = fs.readFileSync(path.join(__dirname, '../vite.config.ts'), 'utf8');
  assert.match(source, /validateApiUrl\(env.VITE_API_URL, command === 'build'/);
  assert.match(source, /'import.meta.env.VITE_API_URL': JSON.stringify\(apiUrl\)/);
});
