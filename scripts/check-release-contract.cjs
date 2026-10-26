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
  const web = sourceExports('lingua_ai_web/src/utils/clientProtocol.ts', buildId);
  if (backend.CURRENT_CLIENT_PROTOCOL !== 2 || web.CLIENT_PROTOCOL_REVISION !== 1 || backend.protocolMetadata('ALLOW_LEGACY').minimumMutationRevision !== 1 ||
      backend.MINIMUM_MUTATION_PROTOCOL > backend.CURRENT_CLIENT_PROTOCOL ||
      backend.CLIENT_PROTOCOL_HEADER !== web.CLIENT_PROTOCOL_HEADER) throw new Error('Client/backend protocol drift.');
  return { rolloutStage: 'PHASE_10B_SERVER_V2_CLIENTS_V1', clientsTimelineAware: false, backend: { ...backend.protocolMetadata('ALLOW_LEGACY'), protocolHeader: backend.CLIENT_PROTOCOL_HEADER }, web: { protocolRevision: web.CLIENT_PROTOCOL_REVISION, buildId: web.WEB_BUILD_ID } };
}
if (require.main === module) {
  try { const value = releaseIdentity(); console.log(process.argv.includes('--json') ? JSON.stringify(value) : 'Source-executed staged contract: PASS (server v2; web/Flutter v1; clients are not timeline-aware).'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { releaseIdentity };
