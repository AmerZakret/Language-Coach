const { execFileSync, spawnSync } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const { readFileSync, existsSync } = require('node:fs');
const { resolve, join } = require('node:path');
const root = resolve(__dirname, '..');
const qualityBuildId = process.env.QUALITY_BUILD_ID || 'quality-check';
if (!/^[A-Za-z0-9._-]{1,96}$/.test(qualityBuildId)) throw new Error('QUALITY_BUILD_ID must be a bounded public identifier.');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const flutter = process.platform === 'win32' ? 'flutter.bat' : 'flutter';
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
function snapshot() {
  const names = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean).sort();
  return createHash('sha256').update(names.map(name => `${name}\0${existsSync(join(root, name)) ? createHash('sha256').update(readFileSync(join(root, name))).digest('hex') : 'MISSING'}`).join('\0'))
    .update(git(['diff', '--cached', '--binary'])).digest('hex');
}
// Never pass inherited application credentials/configuration into quality checks.
const safeEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  !/^(CLIENT_PROTOCOL_POLICY|RELEASE_BUILD_ID|NODE_ENV|MONGODB_URI|JWT_SECRET|GEMINI_.*|AI_ENABLED|PRONUNCIATION_.*|WHISPER_.*|CORS_ORIGINS|UPLOAD_ROOT|VITE_.*|ALLOW_LOCAL_.*|TRUST_PROXY)$/.test(name)));
// Keep disposable Mongo binaries in the ignored test dependency cache, not in
// a developer database directory. CI may download only this test server binary.
safeEnv.MONGOMS_DOWNLOAD_DIR ||= join(root, 'lingua_ai_backend/node_modules/.cache/mongodb-memory-server');
function run(command, args, cwd = root, env = {}) {
  console.log(`\n> ${command} ${args.join(' ')} [${cwd === root ? '.' : cwd.slice(root.length + 1)}]`);
  // cmd.exe is needed only for fixed npm/flutter .cmd/.bat launchers on Windows.
  const result = spawnSync(command, args, { cwd, env: { ...safeEnv, ...env }, stdio: 'inherit', shell: process.platform === 'win32' && /\.(cmd|bat)$/.test(command) });
  if (result.error || result.status !== 0) throw new Error(`Quality command failed (${result.status ?? result.error?.code}).`);
}
const python = process.env.QUALITY_PYTHON || (existsSync(join(root, 'lingua_ai_pronunciation_service/venv/Scripts/python.exe'))
  ? join(root, 'lingua_ai_pronunciation_service/venv/Scripts/python.exe') : process.platform === 'win32' ? 'python' : 'python3');
const jobs = {
  backend() {
    const cwd = join(root, 'lingua_ai_backend');
    run(npm, ['run', 'build'], cwd); run(npm, ['test'], cwd); run(npm, ['run', 'test:e2e'], cwd);
    run(process.execPath, ['scripts/check-release-contract.cjs']);
    run(process.execPath, ['scripts/lint-ratchet.cjs', 'backend']);
    run(process.execPath, ['scripts/check-release-artifacts.cjs', 'backend']);
  },
  web() {
    const cwd = join(root, 'lingua_ai_web');
    run(npm, ['ls'], cwd); run(npm, ['test'], cwd);
    run(npm, ['run', 'build'], cwd, { VITE_API_URL: 'https://api.example.invalid', VITE_BUILD_ID: qualityBuildId });
    run(process.execPath, ['scripts/check-release-contract.cjs']);
    run(process.execPath, ['scripts/lint-ratchet.cjs', 'web']);
    run(process.execPath, ['scripts/check-release-artifacts.cjs', 'web']);
  },
  flutter() {
    const cwd = join(root, 'lingua_ai');
    run(flutter, ['pub', 'get', '--enforce-lockfile'], cwd);
    run(flutter, ['test', `--dart-define=BUILD_ID=${qualityBuildId}`], cwd); run(flutter, ['analyze'], cwd);
  },
  pronunciation() {
    const cwd = join(root, 'lingua_ai_pronunciation_service');
    run(python, ['-B', '-m', 'unittest', '-v', 'test_service'], cwd);
    run(python, ['-B', join(root, 'scripts/check-python.py')], cwd);
    run(python, ['-B', '-m', 'pip', 'check'], cwd);
    run(process.execPath, ['scripts/check-release-artifacts.cjs', 'pronunciation']);
  },
  release() {
    const cwd = join(root, 'lingua_ai_backend');
    run(npm, ['run', 'build'], cwd);
    const env = { CLIENT_PROTOCOL_POLICY: 'ENFORCE_MUTATIONS', RELEASE_BUILD_ID: qualityBuildId, NODE_ENV: 'production', MONGODB_URI: 'mongodb://db.example.invalid/quality',
      JWT_SECRET: randomBytes(48).toString('base64'), AI_ENABLED: 'false', PRONUNCIATION_ENABLED: 'false',
      CORS_ORIGINS: 'https://app.example.invalid', UPLOAD_ROOT: resolve(root, '.quality-upload-contract') };
    run(npm, ['run', 'validate:prod'], cwd, env); run(npm, ['run', 'preflight:deploy'], cwd, env);
  },
  hygiene() { run(process.execPath, ['--test', 'scripts/quality-tools.test.cjs', 'scripts/release-artifacts.test.cjs']); run(process.execPath, ['scripts/check-hygiene.cjs']); },
};
function main() {
  const selected = process.argv[2] || 'all';
  if (selected !== 'all' && !Object.hasOwn(jobs, selected)) throw new Error('Unknown quality component.');
  const before = snapshot(); let failure;
  try { for (const name of selected === 'all' ? Object.keys(jobs) : [selected]) jobs[name](); }
  catch (error) { failure = error; }
  finally {
    if (snapshot() !== before) failure = new Error(`${failure ? `${failure.message} ` : ''}Quality checks mutated source/index or left unignored artifacts. Inspect git status; nothing was discarded.`);
    run('git', ['diff', '--check']);
  }
  if (failure) throw failure;
  console.log('\nQuality checks passed; source/index and unignored file inventory unchanged. Infrastructure readiness is NOT proven.');
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { snapshot };
