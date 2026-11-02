const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('../lingua_ai_backend/node_modules/typescript');
const root = resolve(__dirname, '..');
function sourceExports(file, buildId) {
  const module = { exports: {} };
  const output = ts.transpileModule(readFileSync(resolve(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, { module, exports: module.exports, __WEB_BUILD_ID__: buildId });
  return module.exports;
}
function releaseIdentity(buildId) {
  const backend = sourceExports('lingua_ai_backend/src/compatibility/protocol-contract.ts');
  const flutterSource = readFileSync(resolve(root, 'lingua_ai/lib/core/config/client_protocol.dart'), 'utf8');
  if (!/static const revision = 2;/.test(flutterSource)) throw new Error('Flutter protocol drift.');
  const web = sourceExports('lingua_ai_web/src/utils/clientProtocol.ts', buildId);
  if (backend.CURRENT_CLIENT_PROTOCOL !== 2 || web.CLIENT_PROTOCOL_REVISION !== 2 || backend.protocolMetadata('ALLOW_LEGACY').minimumMutationRevision !== 1 ||
      backend.MINIMUM_MUTATION_PROTOCOL > backend.CURRENT_CLIENT_PROTOCOL ||
      backend.CLIENT_PROTOCOL_HEADER !== web.CLIENT_PROTOCOL_HEADER) throw new Error('Client/backend protocol drift.');
  return { rolloutStage: 'PHASE_10D_ALL_CLIENTS_V2', clientsTimelineAware: true, backend: { ...backend.protocolMetadata('ALLOW_LEGACY'), protocolHeader: backend.CLIENT_PROTOCOL_HEADER }, flutter: { protocolRevision: 2, timelineAware: true }, web: { timelineAware: true, protocolRevision: web.CLIENT_PROTOCOL_REVISION, buildId: web.WEB_BUILD_ID } };
}
if (require.main === module) {
  try { const value = releaseIdentity(); console.log(process.argv.includes('--json') ? JSON.stringify(value) : 'Source-executed staged contract: PASS (server v2; web v2; Flutter v2; enforcement remains staged).'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { releaseIdentity };
