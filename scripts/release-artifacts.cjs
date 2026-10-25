// Pure planning/validation: no writes, process execution, network or app bootstrap.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const policyAt = root => json(path.join(root, 'release-policy.json'));
function walk(root, prefix = '') {
  if (!prefix && fs.lstatSync(root).isSymbolicLink()) throw new Error('Release input symlinks are forbidden.');
  return fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error('Release input symlinks are forbidden.');
    if (entry.isDirectory()) return walk(root, name);
    if (!entry.isFile()) throw new Error('Unsupported release input type.');
    return [name];
  }).sort();
}
function buildId(value = 'development') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,96}$/.test(value)) throw new Error('Invalid public build identifier.');
  return value;
}
function safeEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid public web API endpoint.'); }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || !host.includes('.') || /(?:^|\.)(?:localhost|local|internal)$/.test(host)
    || host === 'host.docker.internal' || /^[\d.]+$/.test(host) || host.includes(':')) throw new Error('Unsafe public web API endpoint.');
}
function secretCategory(text) {
  const rules = [
    ['credentialed Mongo URI', /mongodb(?:\+srv)?:\/\/[^\s:/"']+:[^\s@"']+@/i],
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['provider key', /AIza[\w-]{30,}/], ['GitHub token', /gh[pousr]_[A-Za-z0-9]{30,}/],
    ['cloud access key', /AKIA[A-Z0-9]{16}/],
    ['literal bearer credential', /["']Bearer\s+[A-Za-z0-9._~-]{16,}["']/i],
    ['literal secret assignment', /(?:JWT_SECRET|GEMINI_API_KEY|PRONUNCIATION_SERVICE_TOKEN|storePassword|keyPassword)["']?\s*[:=]\s*["'][A-Za-z0-9+/_=.-]{20,}["']/],
  ];
  return rules.find(([, expression]) => expression.test(text))?.[0];
}
function allowed(component, name, policy) {
  if (name === 'release-manifest.json') return true;
  if (/(?:^|\/)(?:__pycache__|node_modules|uploads|model-cache|test|tests|fixtures|tooling)(?:\/|$)/i.test(name)
    || /(?:^|\/)\.env(?:\.|$)|\.(?:map|pyc|pyo|pem|key|jks|keystore|p12|pfx)$|(?:^|\/)key\.properties$/i.test(name)
    || /\.(?:spec|test)\.[cm]?js$/.test(name)) return false;
  if (component === 'backend') {
    if (['package.json', 'package-lock.json', ...policy.backend.launcherFiles].includes(name)) return true;
    if (!name.startsWith('dist/src/') || !name.endsWith('.js')) return false;
    const source = name.slice('dist/src/'.length);
    return policy.backend.rootModules.includes(source) || policy.backend.runtimeDirectories.includes(source.split('/')[0]);
  }
  if (component === 'web') return policy.web.rootFiles.includes(name)
    || (policy.web.assetDirectories.includes(name.split('/')[0]) && policy.web.extensions.includes(path.extname(name).toLowerCase()));
  if (component === 'pronunciation') return policy.pronunciation.sourceFiles.includes(name);
  return false;
}
function metadata(component, version, identity, protocol) {
  return { component, appVersion: version, buildId: buildId(identity), protocolRevision: protocol,
    artifactType: { backend: 'node-runtime', web: 'static-spa', pronunciation: 'python-source' }[component] };
}
function validate(component, entries, policy = policyAt(ROOT)) {
  const names = [...entries.keys()];
  if (names.some(name => !allowed(component, name, policy))) throw new Error(`Forbidden ${component} artifact path: ${names.find(name => !allowed(component, name, policy))}`);
  const required = component === 'backend' ? ['dist/src/main.js', 'dist/src/config/runtime-config.js', 'package.json', 'package-lock.json', ...policy.backend.launcherFiles]
    : component === 'web' ? policy.web.rootFiles : policy.pronunciation.sourceFiles;
  if ([...required, 'release-manifest.json'].some(name => !entries.has(name))) throw new Error(`Missing required ${component} artifact file.`);
  const manifest = JSON.parse(entries.get('release-manifest.json').toString());
  const keys = ['component', 'appVersion', 'buildId', 'protocolRevision', 'artifactType', ...(component === 'web' ? ['apiEndpoint'] : [])];
  if (Object.keys(manifest).sort().join() !== keys.sort().join() || manifest.component !== component
    || (component === 'pronunciation' ? manifest.appVersion !== null : typeof manifest.appVersion !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(manifest.appVersion))
    || manifest.artifactType !== metadata(component, null, 'development', null).artifactType
    || (component === 'pronunciation' ? manifest.protocolRevision !== null : !Number.isInteger(manifest.protocolRevision) || manifest.protocolRevision < 1)) throw new Error('Invalid release manifest fields.');
  buildId(manifest.buildId);
  for (const [name, bytes] of entries) {
    // Text only. Binary source assets are never dumped or decoded as logs.
    if (!/\.(?:js|cjs|json|html|css|py|txt)$/.test(name)) continue;
    const text = bytes.toString('utf8'), category = secretCategory(text);
    if (category) throw new Error(`Forbidden credential category in ${component}/${name}: ${category}`);
    if (/sourceMappingURL\s*=/.test(text)) throw new Error(`Source-map reference in ${component}/${name}`);
    if (component === 'web' && /GEMINI_API_KEY|JWT_SECRET|PRONUNCIATION_SERVICE_TOKEN|https?:\/\/(?:localhost|127\.0\.0\.1|10\.0\.2\.2):\d+/i.test(text)) throw new Error(`Forbidden browser configuration in web/${name}`);
    if (component === 'backend' && /\.[cm]?js$/.test(name)) {
      for (const match of text.matchAll(/require\(["'](\.[^"']+)["']\)/g)) {
        let target = path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1]));
        if (!/\.(?:[cm]?js|json)$/.test(target)) target = entries.has(`${target}.js`) ? `${target}.js` : `${target}/index.js`;
        if (!entries.has(target)) throw new Error(`Unpackaged local runtime dependency from ${name}`);
      }
    }
  }
  if (component === 'web') {
    safeEndpoint(manifest.apiEndpoint);
    const publicIdentity = JSON.parse(entries.get('release.json'));
    if (Object.keys(publicIdentity).sort().join() !== 'buildId,protocolRevision'
      || publicIdentity.buildId !== manifest.buildId || publicIdentity.protocolRevision !== manifest.protocolRevision) throw new Error('Web identity drift.');
    if (!names.some(name => name.endsWith('.js') && entries.get(name).includes(Buffer.from(manifest.apiEndpoint)))) throw new Error('API endpoint not found in built JS.');
  }
  if (component === 'backend') {
    const pkg = JSON.parse(entries.get('package.json')), lock = JSON.parse(entries.get('package-lock.json'));
    if (pkg.version !== manifest.appVersion || pkg.devDependencies || pkg.jest
      || Object.keys(pkg).some(key => !policy.backend.packageFields.includes(key))
      || JSON.stringify(pkg.engines) !== JSON.stringify(policy.engines) || pkg.packageManager !== `npm@${policy.toolchains.npm}`
      || JSON.stringify(Object.entries(pkg.dependencies).sort()) !== JSON.stringify(Object.entries(lock.packages[''].dependencies).sort())
      || pkg.scripts['start:prod'] !== 'node scripts/start-production.cjs'
      || Object.keys(pkg.scripts).sort().join() !== 'start:prod,validate:prod') throw new Error('Runtime package metadata drift.');
  }
  const hash = createHash('sha256');
  for (const name of names.sort()) hash.update(name).update('\0').update(entries.get(name));
  return { component, files: names.length, appVersion: manifest.appVersion, buildId: manifest.buildId, protocolRevision: manifest.protocolRevision, sha256: hash.digest('hex') };
}
function plan(component, root = ROOT, identity = 'development') {
  const policy = policyAt(root), entries = new Map();
  const add = (name, file) => {
    const info = fs.lstatSync(file);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('Release inputs must be regular files.');
    entries.set(name, fs.readFileSync(file));
  };
  let manifest;
  if (component === 'backend') {
    const base = path.join(root, 'lingua_ai_backend');
    const built = walk(path.join(base, 'dist'));
    if (built.some(name => name.endsWith('.map'))) throw new Error('Backend production build still emits maps.');
    for (const name of built) if (allowed(component, `dist/${name}`, policy)) add(`dist/${name}`, path.join(base, 'dist', name));
    const source = json(path.join(base, 'package.json')), lock = json(path.join(base, 'package-lock.json'));
    const pkg = Object.fromEntries(policy.backend.packageFields.filter(key => Object.hasOwn(source, key)).map(key => [key, source[key]]));
    pkg.scripts = { 'start:prod': pkg.scripts['start:prod'], 'validate:prod': pkg.scripts['validate:prod'] };
    delete lock.packages[''].devDependencies; // Preserve locked versions/integrities, including dev graph metadata.
    entries.set('package.json', Buffer.from(JSON.stringify(pkg, null, 2) + '\n'));
    entries.set('package-lock.json', Buffer.from(JSON.stringify(lock, null, 2) + '\n'));
    for (const name of policy.backend.launcherFiles) add(name, path.join(base, name));
    const protocol = require(path.join(base, 'dist/src/compatibility/protocol-contract.js')).CURRENT_CLIENT_PROTOCOL;
    manifest = metadata(component, pkg.version, identity, protocol);
  } else if (component === 'web') {
    const base = path.join(root, 'lingua_ai_web/dist');
    for (const name of walk(base)) add(name, path.join(base, name));
    return entries; // Both public manifests were generated by the actual Vite build.
  } else if (component === 'pronunciation') {
    for (const name of policy.pronunciation.sourceFiles) add(name, path.join(root, 'lingua_ai_pronunciation_service', name));
    manifest = metadata(component, null, identity, null); // Service app version is deliberately unassigned.
  } else throw new Error('Unknown release component.');
  entries.set('release-manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  return entries;
}
function directoryEntries(directory) {
  return new Map(walk(directory).map(name => [name, fs.readFileSync(path.join(directory, name))]));
}
module.exports = { ROOT, policyAt, walk, buildId, safeEndpoint, secretCategory, allowed, metadata, validate, plan, directoryEntries };
