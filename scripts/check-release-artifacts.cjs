// Read-only release checks. Git file inventory is the sole child process; no
// install/build/start/sign/deploy, environment-file loading or network calls.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ROOT, policyAt, plan, validate, directoryEntries } = require('./release-artifacts.cjs');
const { forbiddenPath } = require('./check-hygiene.cjs');
function repository(root = ROOT) {
  const read = name => fs.readFileSync(path.join(root, name), 'utf8');
  const policy = policyAt(root), tools = policy.toolchains;
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  assert(read('.node-version').trim() === tools.node && read('.python-version').trim() === tools.python, 'Runtime version marker drift.');
  for (const component of ['lingua_ai_backend', 'lingua_ai_web']) {
    const pkg = JSON.parse(read(`${component}/package.json`)), lock = JSON.parse(read(`${component}/package-lock.json`));
    assert(JSON.stringify(pkg.engines) === JSON.stringify(policy.engines)
      && JSON.stringify(lock.packages[''].engines) === JSON.stringify(policy.engines)
      && pkg.packageManager === `npm@${tools.npm}`, 'Node/npm manifest/lock policy drift.');
  }
  const workflow = read('.github/workflows/quality.yml');
  assert(workflow.includes('node-version:') && workflow.includes('npm install --global npm@') && [...workflow.matchAll(/node-version:\s*'([^']+)'/g)].every(match => match[1] === tools.node)
    && [...workflow.matchAll(/npm install --global npm@([\d.]+)/g)].every(match => match[1] === tools.npm)
    && workflow.includes(`flutter-version: '${tools.flutter}'`) && workflow.includes(`python-version: '${tools.python}'`), 'CI toolchain drift.');
  const pub = read('lingua_ai/pubspec.yaml'), lock = read('lingua_ai/pubspec.lock');
  assert(pub.includes("sdk: '>=3.11.0 <4.0.0'") && pub.includes("flutter: '>=3.38.4'")
    && lock.includes('dart: ">=3.11.0 <4.0.0"') && lock.includes('flutter: ">=3.38.4"'), 'Flutter lock/toolchain constraint drift.');
  const android = read('lingua_ai/android/app/build.gradle.kts');
  const ids = { androidApplicationId: android.match(/applicationId\s*=\s*"([^"]+)"/)?.[1],
    androidNamespace: android.match(/namespace\s*=\s*"([^"]+)"/)?.[1],
    iosBundleId: read('lingua_ai/ios/Runner.xcodeproj/project.pbxproj').match(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/)?.[1] };
  for (const [key, value] of Object.entries(ids)) assert(value === policy.flutter[key], 'Application identity changed without release policy review.');
  const placeholder = Object.values(ids).some(value => value?.startsWith('com.example.'));
  assert(policy.flutter.identityClassification === (placeholder ? 'PLACEHOLDER_RELEASE_BLOCKER' : 'ASSIGNED'), 'Application identity classification drift.');
  assert(!/signingConfigs\.getByName\("debug"\)/.test(android) && android.includes('Debug signing is not permitted.')
    && android.includes('else null'), 'Android release signing must fail closed.');
  assert(read('lingua_ai/android/app/src/main/AndroidManifest.xml').includes('android.permission.INTERNET')
    && read('lingua_ai/android/app/src/main/AndroidManifest.xml').includes('android.permission.RECORD_AUDIO')
    && read('lingua_ai/ios/Runner/Info.plist').includes('NSMicrophoneUsageDescription'), 'Mobile permission drift.');
  const tracked = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  assert(!tracked.some(forbiddenPath), 'Tracked secret/runtime artifact path detected; run hygiene check for paths.');
  const build = JSON.parse(read('lingua_ai_backend/tsconfig.build.json'));
  assert(build.compilerOptions.sourceMap === false && build.compilerOptions.declaration === false
    && build.compilerOptions.rootDir === '.', 'Backend map/output policy drift.');
  assert(read('lingua_ai_web/vite.config.ts').includes('sourcemap: false'), 'Web map policy must be explicit.');
  const protocol = require('./check-release-contract.cjs').releaseIdentity().backend.currentProtocolRevision;
  assert(read('RELEASE_COMPATIBILITY.md').includes(`Protocol revision **${protocol}**`), 'Protocol documentation drift.');
  const packaging = read('RELEASE_PACKAGING.md');
  for (const version of Object.values(tools)) assert(packaging.includes(version), 'Toolchain documentation drift.');
  for (const component of ['Backend', 'Web', 'Flutter', 'Pronunciation']) assert(packaging.includes(`### ${component}`), 'Four-component release checklist missing.');
  for (const name of ['README.md', 'TESTING.md', 'PRODUCTION_CONFIGURATION.md', 'PRODUCTION_RUNBOOKS.md', 'lingua_ai_backend/README.md', 'lingua_ai_web/README.md', 'lingua_ai/README.md', 'lingua_ai_pronunciation_service/README.md']) {
    assert(read(name).includes('RELEASE_PACKAGING.md'), 'Component/operator documentation lacks release contract link.');
  }
  assert(!/placeholder response|real AI integration coming soon/i.test(read('lingua_ai_backend/README.md')), 'Stale AI placeholder claim.');
  assert(packaging.includes('npm run start:prod') && packaging.includes('python -B main.py')
    && read('lingua_ai_pronunciation_service/README.md').includes('python -B main.py'), 'Production launch command drift.');
  for (const kind of ['community-create', 'ai-send', 'ai-clear']) {
    assert(read('CLIENT_RECOVERY.md').includes(kind) || read('CLIENT_RECOVERY.md').toLowerCase().includes(kind.replaceAll('-', ' ')), 'Recovery documentation drift.');
    assert(read('lingua_ai_web/src/utils/onlineIntents.ts').includes(`'${kind}'`)
      && read('lingua_ai/lib/services/online_intent_service.dart').includes(`'${kind}'`), 'Durable intent type drift.');
  }
  return { toolchains: tools, flutter: { ...ids, version: pub.match(/^version:\s*(.+)$/m)?.[1],
    classification: policy.flutter.identityClassification, storeReleaseReady: !placeholder }, protocolRevision: protocol };
}
function main(args = process.argv.slice(2)) {
  const [component = 'all', directory] = args;
  if (args.length > 2 || !['all', 'repository', 'backend', 'web', 'pronunciation'].includes(component)
    || (directory && ['all', 'repository'].includes(component))) throw new Error('Usage: node scripts/check-release-artifacts.cjs [all|repository|backend|web|pronunciation] [ARTIFACT_DIRECTORY]');
  if (component === 'all' || component === 'repository') console.log(JSON.stringify(repository()));
  for (const name of component === 'all' ? ['backend', 'web', 'pronunciation'] : component === 'repository' ? [] : [component]) {
    const entries = directory ? directoryEntries(path.resolve(directory)) : plan(name, ROOT, process.env.QUALITY_BUILD_ID || 'development');
    console.log(JSON.stringify(validate(name, entries)));
  }
  console.log('Release artifact checks passed (read-only). Signing, credentials, runtime infrastructure and production traffic are NOT authorized.');
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { repository, main };
