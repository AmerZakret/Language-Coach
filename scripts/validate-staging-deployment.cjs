// Offline structural contract only: no network, Docker invocation, environment load or mutation.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const base = path.join(root, 'deployment/staging');
const load = name => JSON.parse(fs.readFileSync(path.join(base, name), 'utf8'));
const read = name => fs.readFileSync(path.join(base, name), 'utf8');
const fail = message => { throw new Error(`Staging deployment contract: ${message}`); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha = /^[0-9a-f]{64}$/;
const publicId = /^[A-Za-z0-9._-]{1,96}$/;

function safeText(value) {
  if (typeof value !== 'string') fail('unexpected text field');
  if (/-----BEGIN .*PRIVATE KEY-----|mongodb(?:\+srv)?:\/\/[^\s:/]+:[^\s@]+@|AIza[\w-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}/i.test(value)) fail('secret-like material in public manifest');
  return value;
}
function rejectSecretFields(value) {
  if (Array.isArray(value)) return value.forEach(rejectSecretFields);
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/(?:secret|token|password|credential|private.?key|api.?key|uri)/i.test(key)) fail('secret/config field does not belong in public manifest');
    rejectSecretFields(child);
  }
}
function endpoint(value, kind) {
  let url;
  try { url = new URL(safeText(value)); } catch { fail(`invalid ${kind} URL`); }
  if (url.username || url.password || url.search || url.hash || !url.hostname) fail(`unsafe ${kind} URL`);
  if (kind === 'public' && (url.protocol !== 'https:' || /(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname) || /^[\d.]+$/.test(url.hostname))) fail('public endpoint must be HTTPS and non-local');
  if (kind === 'private' && (url.protocol !== 'http:' || url.hostname !== 'pronunciation' || url.port !== '8001')) fail('pronunciation must use its internal-only service name');
  return url;
}
function validateManifest(m, strict = false) {
  if (!m || m.schemaVersion !== 1 || m.environment !== 'staging' || m.environment === 'production') fail('explicit staging schema/environment required');
  if (!publicId.test(safeText(m.deploymentIdentity)) || !publicId.test(safeText(m.buildId))) fail('invalid public deployment/build identity');
  if (!uuid.test(safeText(m.dataTimelineId)) || m.protocolRevision !== 2 || m.clientFloor?.protocolRevision !== 2 || m.clientFloor?.capability !== 'timeline-aware-protocol-2') fail('timeline or protocol mismatch');
  if (m.backendInstances !== 1 || m.externalTimelineControl !== 'REQUIRED_11B_C') fail('one backend and unresolved external control required');
  if (m.mongo?.targetIdentity !== 'local-compose-single-node' || m.mongo?.host !== 'mongo:27017' || m.mongo?.database !== 'lingua_staging' || m.mongo?.replicaSet !== 'staging-rs') fail('disposable Mongo identity mismatch');
  if (m.uploads?.storageIdentity !== 'language-coach-11b-local_uploads' || m.uploads?.root !== '/srv/uploads') fail('persistent upload identity mismatch');
  if (!publicId.test(safeText(m.pronunciation?.modelIdentity)) || (m.pronunciation?.modelSha256 !== 'PENDING_MODEL' && !sha.test(m.pronunciation?.modelSha256 || ''))) fail('model identity/checksum invalid');
  endpoint(m.pronunciation?.internalUrl, 'private');
  const web = endpoint(m.ingress?.webUrl, 'public');
  const api = endpoint(m.ingress?.apiUrl, 'public');
  if (web.hostname !== 'app.staging.test' || api.hostname !== 'api.staging.test' || web.port !== '8443' || api.port !== '8443' || m.ingress?.trustedProxyIp !== '172.30.50.10') fail('local ingress identity mismatch');
  for (const key of ['backendSha256', 'webSha256', 'pronunciationSha256']) {
    const value = safeText(m.artifacts?.[key]);
    if (value !== 'PENDING_BUILD' && !sha.test(value)) fail('artifact digest shape invalid');
    if (strict && value === 'PENDING_BUILD') fail('strict deployment requires actual artifact digests');
  }
  if (strict && (m.pronunciation.modelSha256 === 'PENDING_MODEL' || m.pronunciation.modelIdentity === 'UNPROVISIONED_FIXTURE')) fail('strict deployment requires a provisioned model identity and digest');
  rejectSecretFields(m);
  safeText(JSON.stringify(m));
  return m;
}
function serviceNetworks(service) { return Array.isArray(service.networks) ? service.networks : Object.keys(service.networks || {}); }
function validateCompose(c, m) {
  const s = c.services || {};
  const allowedServices = ['backend','backend-tools','ingress','mongo','mongo-init','pronunciation','web'];
  if (c.name !== 'language-coach-11b-local' || JSON.stringify(Object.keys(s).sort()) !== JSON.stringify(allowedServices)) fail('compose service inventory mismatch');
  if (Object.values(s).some(service => service.network_mode === 'host' || service.privileged === true)) fail('host networking/privileged service forbidden');
  if (s.backend.deploy?.replicas !== 1 || s.backend.ports || s.web.ports || s.mongo.ports || s.pronunciation.ports || s['mongo-init'].ports) fail('only ingress may publish a port; backend scale fixed at one');
  if (JSON.stringify(s.ingress.ports) !== JSON.stringify(['127.0.0.1:8443:8443'])) fail('ingress must be loopback-published HTTPS only');
  if (s.mongo.image !== 'mongo:7.0.45-jammy' || s['mongo-init'].image !== s.mongo.image || !s.mongo.command.includes('--replSet') || !s.mongo.command.includes('staging-rs')) fail('pinned replica-set Mongo required');
  const disposableUri = `mongodb://${m.mongo.host}/${m.mongo.database}?replicaSet=${m.mongo.replicaSet}`;
  if (s.backend.environment?.MONGODB_URI !== disposableUri || s['backend-tools'].environment?.MONGODB_URI !== disposableUri) fail('Mongo target must be fixed to disposable Compose replica set');
  if (!s.mongo.volumes.includes('mongo-data:/data/db') || !s.backend.volumes.includes('uploads:/srv/uploads') || !s.pronunciation.volumes.includes('model-cache:/models:ro')) fail('persistent state/mount contract mismatch');
  if (!c.volumes?.['mongo-data'] || !c.volumes?.uploads || !c.volumes?.['model-cache']) fail('named volumes required');
  if (!c.networks?.database?.internal || !c.networks?.inference?.internal || !serviceNetworks(s.backend).includes('database') || !serviceNetworks(s.backend).includes('inference') || !serviceNetworks(s.backend).includes('frontend')) fail('backend network boundaries missing');
  if (serviceNetworks(s.ingress).includes('database') || serviceNetworks(s.ingress).includes('inference') || serviceNetworks(s.mongo).includes('frontend') || serviceNetworks(s.pronunciation).includes('frontend')) fail('private service exposed to ingress network');
  if (s.ingress.networks?.frontend?.ipv4_address !== m.ingress.trustedProxyIp || s.backend.environment?.TRUST_PROXY !== m.ingress.trustedProxyIp) fail('trusted proxy address drift');
  if (s.backend.environment?.CLIENT_PROTOCOL_POLICY !== 'ENFORCE_MUTATIONS' || s.backend.environment?.UPLOAD_ROOT !== m.uploads.root || s.backend.environment?.CORS_ORIGINS !== m.ingress.webUrl || s.backend.environment?.PRONUNCIATION_SERVICE_URL !== m.pronunciation.internalUrl) fail('backend deployment contract drift');
  if (s.backend.environment?.DATA_WRITE_MODE !== '${STAGING_DATA_WRITE_MODE:-CLOSED}' || s.backend.environment?.DATA_TIMELINE_ID !== '${STAGING_TIMELINE_ID:?supply a synthetic staging timeline UUID}' || s.backend.environment?.AI_ENABLED !== 'false') fail('closed initial deployment contract drift');
  if (s.web.build?.args?.VITE_API_URL !== m.ingress.apiUrl || s.backend.environment?.RELEASE_BUILD_ID !== '${STAGING_BUILD_ID:-phase11b-local}') fail('artifact/config build identity drift');
  if (s['backend-tools'].environment?.RELEASE_BUILD_ID !== s.backend.environment.RELEASE_BUILD_ID) fail('operator tooling build identity drift');
  if (s.pronunciation.environment?.WHISPER_ALLOW_DOWNLOAD !== 'false' || s.pronunciation.environment?.PRONUNCIATION_ALLOW_INSECURE_LOCAL !== 'false' || s.pronunciation.environment?.INFERENCE_CONCURRENCY !== '1') fail('pronunciation production boundary drift');
  if (!s.backend.environment?.JWT_SECRET?.startsWith('${STAGING_JWT_SECRET:?') || !s.backend.environment?.PRONUNCIATION_SERVICE_TOKEN?.startsWith('${STAGING_PRONUNCIATION_SERVICE_TOKEN:?') || !s.pronunciation.environment?.PRONUNCIATION_SERVICE_TOKEN?.startsWith('${STAGING_PRONUNCIATION_SERVICE_TOKEN:?')) fail('runtime secret injection required');
  if (!s['backend-tools'].profiles?.includes('tools') || s.backend.depends_on?.['mongo-init']?.condition !== 'service_completed_successfully') fail('explicit bootstrap/startup order missing');
  if (s.backend.read_only !== true || s.pronunciation.read_only !== true || s.web.read_only !== true || s.ingress.read_only !== true) fail('runtime filesystem confinement missing');
  return c;
}
function validateFiles() {
  const backend = read('Dockerfile.backend'), web = read('Dockerfile.web'), pronunciation = read('Dockerfile.pronunciation');
  const runtime = backend.split('FROM node:22.14.0-bookworm-slim AS runtime\n')[1];
  const tooling = backend.split('FROM node:22.14.0-bookworm-slim AS tooling\n')[1]?.split('FROM node:22.14.0-bookworm-slim AS runtime\n')[0];
  if (!tooling || !tooling.includes('COPY --from=runtime-dependencies /app/node_modules') || !tooling.includes('USER node') || !tooling.includes('bootstrap-indexes.cjs')) fail('operator tooling image contract mismatch');
  if (!runtime || (backend.match(/FROM node:22\.14\.0-bookworm-slim AS /g) || []).length !== 4 || (backend.match(/npm install --global npm@10\.9\.0/g) || []).length !== 2 || !backend.includes('npm ci --omit=dev') || !backend.includes('node scripts/package-release.cjs backend') || !runtime.includes('! command -v npm') || !runtime.includes('USER node') || !runtime.includes("3000/health/ready") || !runtime.includes('CMD ["node", "scripts/start-production.cjs"]') || /COPY \. \./.test(runtime)) fail('backend runtime image contract mismatch');
  if (!web.includes('FROM node:22.14.0-bookworm-slim AS build') || !web.includes('FROM caddy:2.11.6-alpine AS runtime') || !web.includes('npm install --global npm@10.9.0') || !web.includes('node scripts/package-release.cjs web') || !web.includes('USER 10001:10001') || !web.includes('VITE_API_URL="$VITE_API_URL"') || /COPY \. \./.test(web.split('FROM caddy:')[1] || '')) fail('web static image contract mismatch');
  if ((pronunciation.match(/FROM python:3\.12\.4-slim-bookworm AS /g) || []).length !== 2 || !pronunciation.includes('--require-hashes --only-binary=:all:') || !pronunciation.includes('requirements-installer.txt') || !pronunciation.includes('USER pronunciation') || !pronunciation.includes('CMD ["python", "-B", "main.py"]') || /COPY .*model\.bin/.test(pronunciation)) fail('pronunciation image contract mismatch');
  const ingress = read('Caddyfile.ingress'), site = read('Caddyfile.web');
  if (!ingress.includes('tls internal') || !ingress.includes('request_body {') || !ingress.includes('max_size 11MB') || !ingress.includes('header_up X-Forwarded-For {remote_host}') || !ingress.includes('header_up -Forwarded') || ingress.includes('reverse_proxy pronunciation') || ingress.includes('reverse_proxy mongo')) fail('HTTPS ingress route/header contract mismatch');
  if (!site.includes('try_files {path} /index.html') || !site.includes('max-age=31536000, immutable') || !site.includes('no-cache, must-revalidate') || !site.includes('handle /release.json') || !site.includes('handle /assets/*')) fail('static cache/SPA contract mismatch');
  const ignore = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8');
  for (const pattern of ['.git','**/node_modules','**/.env.*','**/uploads','**/model-cache','**/*.map']) if (!ignore.includes(pattern)) fail('unsafe Docker build context exclusion');
  const template = read('.env.staging.example');
  if (!template.includes(`STAGING_TIMELINE_ID=${load('manifest.example.json').dataTimelineId}`) || !template.includes('STAGING_DATA_WRITE_MODE=CLOSED') || /^STAGING_MONGODB_URI=/m.test(template)) fail('staging configuration template drift');
  for (const name of ['Dockerfile.backend','Dockerfile.web','Dockerfile.pronunciation','Caddyfile.ingress','Caddyfile.web','compose.json','manifest.example.json']) safeText(read(name));
}
function manifestFrom(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { fail('manifest must be readable valid JSON'); }
}
function validate(strict = false, manifestFile = path.join(base, 'manifest.example.json'), expectedBuildId, expectedTimelineId) {
  const manifest = validateManifest(manifestFrom(manifestFile), strict);
  if (expectedBuildId && manifest.buildId !== expectedBuildId) fail('manifest build identity does not match deployment input');
  if (expectedTimelineId && manifest.dataTimelineId !== expectedTimelineId) fail('manifest timeline does not match deployment input');
  if (strict && (!expectedBuildId || !expectedTimelineId)) fail('strict validation requires explicit build and timeline IDs');
  validateCompose(load('compose.json'), manifest);
  validateFiles();
  return { status: 'STATIC_STAGING_CONTRACT_VALID', environment: manifest.environment, backendInstances: 1, externalTimelineControl: manifest.externalTimelineControl, artifactDigestsPending: Object.values(manifest.artifacts).includes('PENDING_BUILD'), liveInfrastructureVerified: false };
}
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const strict = args.includes('--strict');
    const value = flag => {
      const index = args.indexOf(flag);
      if (index < 0) return undefined;
      if (!args[index + 1] || args[index + 1].startsWith('--') || args.lastIndexOf(flag) !== index) fail('invalid validator arguments');
      return args[index + 1];
    };
    const manifestFile = value('--manifest');
    const expectedBuildId = value('--build-id');
    const expectedTimelineId = value('--timeline-id');
    const expectedLength = Number(strict) + (manifestFile ? 2 : 0) + (expectedBuildId ? 2 : 0) + (expectedTimelineId ? 2 : 0);
    if (args.length !== expectedLength || (expectedBuildId && !publicId.test(expectedBuildId)) || (expectedTimelineId && !uuid.test(expectedTimelineId))) fail('invalid validator arguments');
    console.log(JSON.stringify(validate(strict, manifestFile ? path.resolve(manifestFile) : undefined, expectedBuildId, expectedTimelineId)));
  }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { validate, validateManifest, validateCompose };
