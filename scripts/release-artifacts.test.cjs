const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('../lingua_ai_backend/node_modules/typescript');
const { allowed, metadata, validate, plan, policyAt, ROOT, safeEndpoint, buildId, secretCategory } = require('./release-artifacts.cjs');
const { assemble } = require('./package-release.cjs');
const { assertLocalLessonReplacement } = require('../lingua_ai_backend/scripts/local-lesson-tool-guard.cjs');
const policy = policyAt(ROOT);
const files = object => new Map(Object.entries(object).map(([name, data]) => [name, Buffer.from(typeof data === 'string' ? data : JSON.stringify(data))]));
function backend() {
  return files({ 'dist/src/main.js': 'require("./config/runtime-config");', 'dist/src/config/runtime-config.js': 'exports.value = 1;',
    ...Object.fromEntries(policy.backend.launcherFiles.map(name => [name, ''])),
    'package.json': { version: '0.0.1', engines: policy.engines, packageManager: `npm@${policy.toolchains.npm}`, dependencies: {}, scripts: { 'start:prod': 'node scripts/start-production.cjs', 'validate:prod': 'node scripts/validate-production.cjs' } },
    'package-lock.json': { packages: { '': { dependencies: {} } } }, 'release-manifest.json': metadata('backend', '0.0.1', 'ci-fixture', 1) });
}
function web() {
  return files({ 'index.html': '<script src="assets/app.js"></script>', 'assets/app.js': 'const api="https://api.example.invalid";',
    'release.json': { buildId: 'ci-fixture', protocolRevision: 1 },
    'release-manifest.json': { ...metadata('web', '0.0.0', 'ci-fixture', 1), apiEndpoint: 'https://api.example.invalid' } });
}
test('9E backend runtime allowlist excludes tests, maps, declarations, tooling, destructive scripts and environment files', () => {
  assert.equal(validate('backend', backend()).files, 8);
  for (const name of ['dist/src/auth/auth.spec.js', 'dist/src/tooling/progress-audit-cli.js', 'dist/scripts/update-english-db.js',
    'dist/src/tooling/timeline-control.js', 'dist/src/tooling/timeline-control-cli.js',
    'scripts/deployment-preflight.cjs', 'dist/src/main.js.map', 'dist/src/main.d.ts', '.env.production', 'test/fixture.js', 'node_modules/x.js']) {
    const fixture = backend(); fixture.set(name, Buffer.from('forbidden'));
    assert.throws(() => validate('backend', fixture), /Forbidden/, name);
  }
  const missing = backend(); missing.set('dist/src/main.js', Buffer.from('require("./tooling/repair");'));
  assert.throws(() => validate('backend', missing), /Unpackaged/);
  const inline = backend(); inline.set('dist/src/main.js', Buffer.from('//# sourceMappingURL=data:application/json;base64,e30='));
  assert.throws(() => validate('backend', inline), /Source-map/);
});
test('9E web artifact rejects maps, env/config secrets, unsafe application endpoints and unexpected metadata', () => {
  assert.equal(validate('web', web()).files, 4);
  for (const name of ['assets/app.js.map', '.env', 'src/config.ts', 'test/app.test.js', 'key.properties']) {
    const fixture = web(); fixture.set(name, Buffer.from('forbidden')); assert.throws(() => validate('web', fixture), /Forbidden/);
  }
  for (const body of ['const token="PRONUNCIATION_SERVICE_TOKEN";', 'const api="http://localhost:3000";', '//# sourceMappingURL=app.map']) {
    const fixture = web(); fixture.set('assets/app.js', Buffer.from(body)); assert.throws(() => validate('web', fixture));
  }
  const bad = web(); bad.set('release-manifest.json', Buffer.from(JSON.stringify({ ...metadata('web', '0.0.0', 'ci', 1), apiEndpoint: 'https://api.example.invalid', token: 'fixture' })));
  assert.throws(() => validate('web', bad), /manifest/);
  // React Router's URL constructor fallback is library plumbing, not an API endpoint.
  const router = web(); router.set('assets/router.js', Buffer.from('const origin="http://localhost";'));
  assert.doesNotThrow(() => validate('web', router));
});
test('9E pronunciation source artifact excludes caches, model weights, audio, tests, venv and environment files', () => {
  const fixture = files({ ...Object.fromEntries(policy.pronunciation.sourceFiles.map(name => [name, ''])),
    'release-manifest.json': metadata('pronunciation', null, 'development', null) });
  assert.equal(validate('pronunciation', fixture).files, 6);
  for (const name of ['test_service.py', 'requirements-dev.txt', '__pycache__/main.pyc', 'model-cache/weights.bin', 'audio.wav', '.env', 'venv/x.py']) {
    const bad = new Map(fixture); bad.set(name, Buffer.from('forbidden')); assert.throws(() => validate('pronunciation', bad));
  }
});
test('9E credential scanning reports categories without printing candidate values; public identifiers are bounded', () => {
  // Construct synthetic scanner samples at runtime; keep the existing HEAD
  // literal-secret gate intact, including its coverage of test fixtures.
  const syntheticMongo = ['mongodb://', 'fixture', ':fixture', '@db.example.invalid/db'].join('');
  const syntheticPrivateKey = ['-----BEGIN ', 'PRIVATE KEY', '-----'].join('');
  for (const value of ['../build', 'x'.repeat(97), '', 'private\nvalue']) assert.throws(() => buildId(value));
  assert.equal(buildId(), 'development'); assert.equal(buildId('ci-123.2'), 'ci-123.2');
  for (const endpoint of ['http://api.example.invalid', 'https://127.0.0.1', 'https://10.1.1.1', 'https://host.local', 'https://user:password@api.example.invalid', 'https://api.example.invalid?token=fixture']) assert.throws(() => safeEndpoint(endpoint));
  for (const text of [syntheticMongo, syntheticPrivateKey, `const JWT_SECRET="${'fixture'.repeat(5)}";`]) assert.ok(secretCategory(text));
  const fixture = backend(); fixture.set('dist/src/main.js', Buffer.from(`const URI=${JSON.stringify(syntheticMongo)};`));
  assert.throws(() => validate('backend', fixture), error => !error.message.includes('fixture:fixture'));
});
test('9E destructive local lesson replacement requires explicit development opt-in and cannot target Atlas or developer arbitrary DBs', () => {
  const env = { NODE_ENV: 'development', MONGODB_URI: 'mongodb://127.0.0.1:27017/lingua_test?directConnection=true' };
  assert.equal(assertLocalLessonReplacement(['--replace-local-english-lessons'], env), env.MONGODB_URI);
  for (const patch of [{ NODE_ENV: 'production' }, { MONGODB_URI: 'mongodb+srv://db.example.invalid/live' },
    { MONGODB_URI: 'mongodb://localhost/production?directConnection=true' }, { MONGODB_URI: 'mongodb://localhost/lingua_dev' }]) {
    assert.throws(() => assertLocalLessonReplacement(['--replace-local-english-lessons'], { ...env, ...patch }));
  }
  assert.throws(() => assertLocalLessonReplacement([], env));
  const source = fs.readFileSync(path.join(ROOT, 'lingua_ai_backend/scripts/update-english-db.ts'), 'utf8');
  assert.ok(source.indexOf("import './local-lesson-tool-guard.cjs'") < source.indexOf("from '@nestjs/core'"));
});
test('9E actual Vite configuration disables maps and derives safe release metadata from package/version inputs', () => {
  function load(file) {
    const module = { exports: {} };
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    vm.runInNewContext(output, { module, exports: module.exports, process, URL, __dirname: path.join(ROOT, 'lingua_ai_web'), require: name => {
      if (name === 'vite') return { defineConfig: value => value, loadEnv: () => ({ VITE_API_URL: 'https://api.example.invalid', VITE_BUILD_ID: 'ci-artifact' }) };
      if (name === '@vitejs/plugin-react' || name === '@tailwindcss/vite') return () => ({});
      if (name === 'path') return path;
      if (name === './package.json') return require('../lingua_ai_web/package.json');
      return load(path.resolve(ROOT, 'lingua_ai_web', name + '.ts'));
    } });
    return module.exports;
  }
  const config = load(path.join(ROOT, 'lingua_ai_web/vite.config.ts')).default({ command: 'build', mode: 'production' });
  assert.equal(config.build.sourcemap, false);
  let emitted;
  config.plugins.find(plugin => plugin.name === 'release-artifact-metadata').generateBundle.call({ emitFile: value => { emitted = JSON.parse(value.source); } });
  assert.equal(emitted.appVersion, require('../lingua_ai_web/package.json').version);
  assert.equal(emitted.buildId, 'ci-artifact'); assert.equal(emitted.protocolRevision, 2);
  assert.deepEqual(Object.keys(emitted).sort(), ['apiEndpoint', 'appVersion', 'artifactType', 'buildId', 'component', 'protocolRevision']);
});
test('9E assembly is explicit, refuses overwrite, and pronunciation package derivation leaves source unchanged', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lingua-release-test-'));
  const cleanup = () => {
    if (path.dirname(temporary) !== path.resolve(os.tmpdir()) || !path.basename(temporary).startsWith('lingua-release-test-')) throw new Error('Unsafe test cleanup path.');
    fs.rmSync(temporary, { recursive: true, force: true });
  };
  try {
    const destination = path.join(temporary, 'pronunciation');
    const before = fs.readFileSync(path.join(ROOT, 'lingua_ai_pronunciation_service/main.py'));
    const result = assemble('pronunciation', destination, ROOT, 'ci-fixture');
    assert.equal(result.files, 6); assert.equal(result.appVersion, null);
    assert.throws(() => assemble('pronunciation', destination), /must not exist/);
    assert.deepEqual(fs.readFileSync(path.join(ROOT, 'lingua_ai_pronunciation_service/main.py')), before);
    assert.equal(allowed('backend', 'dist/src/auth/auth.controller.js', policy), true);
    assert.equal(plan('pronunciation').size, 6);
  } finally {
    cleanup();
  }
});
test('9E source toolchain, identity, command, protocol, recovery and four-component checklist contracts agree', () => {
  const result = require('./check-release-artifacts.cjs').repository();
  assert.equal(result.flutter.classification, 'PLACEHOLDER_RELEASE_BLOCKER');
  assert.equal(result.flutter.storeReleaseReady, false);
  assert.equal(result.flutter.version, '1.0.0+1');
  assert.equal(result.toolchains.flutter, '3.41.7'); assert.equal(result.toolchains.dart, '3.11.5');
});


test('9E release planning and repository checks cannot write files or open network connections', () => {
  const net = require('node:net'), http = require('node:http'), tls = require('node:tls');
  const hooks = [[fs, 'writeFileSync'], [fs, 'appendFileSync'], [fs, 'mkdirSync'], [fs, 'unlinkSync'],
    [fs, 'rmSync'], [net.Socket.prototype, 'connect'], [http, 'request'], [tls, 'connect']];
  const originals = hooks.map(([object, key]) => object[key]);
  try {
    for (const [object, key] of hooks) object[key] = () => { throw new Error('Forbidden release-check side effect'); };
    assert.doesNotThrow(() => validate('pronunciation', plan('pronunciation')));
    assert.doesNotThrow(() => require('./check-release-artifacts.cjs').repository());
  } finally { hooks.forEach(([object, key], index) => { object[key] = originals[index]; }); }
});

test('9E actual destructive tool entry fails before Nest/env/application loading under production configuration', () => {
  const { spawnSync } = require('node:child_process');
  const entry = path.join(ROOT, 'lingua_ai_backend/scripts/update-english-db.ts');
  const code = `process.argv = ['node', ${JSON.stringify(entry)}, '--replace-local-english-lessons'];
    const Module = require('node:module'), original = Module._load;
    Module._load = function(name, ...args) { if (name === '@nestjs/core' || name.includes('app.module')) throw new Error('UNEXPECTED_APP_BOOTSTRAP'); return original.call(this, name, ...args); };
    require(${JSON.stringify(entry)});`;
  const result = spawnSync(process.execPath, ['-r', 'ts-node/register', '-e', code], {
    cwd: path.join(ROOT, 'lingua_ai_backend'), encoding: 'utf8', timeout: 15000,
    env: { ...process.env, NODE_ENV: 'production', MONGODB_URI: 'mongodb://db.example.invalid/blocked' }
  });
  assert.equal(result.status, 1); assert.match(result.stderr, /Local lesson replacement requires/);
  assert.doesNotMatch(result.stderr, /UNEXPECTED_APP_BOOTSTRAP|db.example.invalid/);
});
