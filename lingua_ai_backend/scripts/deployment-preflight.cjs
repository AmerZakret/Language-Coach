// Local verification only. No Nest bootstrap, connectivity, migration, or writes.
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

function fail(code) {
  throw Object.assign(new Error('Local deployment preflight failed.'), {
    preflightCode: code,
  });
}

function runPreflight() {
  // Existing validator parses environment only; never loads .env or starts Nest.
  const { validateProduction } = require('./production-entry.cjs');
  const production = validateProduction(); // Includes required-profile/authority shape validation.
  const backend = resolve(__dirname, '..');
  const root = resolve(backend, '..');
  const manifest = JSON.parse(
    readFileSync(resolve(backend, 'package.json'), 'utf8'),
  );
  if (manifest.scripts?.['start:prod'] !== 'node scripts/start-production.cjs')
    fail('PRODUCTION_LAUNCHER_MISMATCH');
  if (!existsSync(resolve(backend, 'scripts/start-production.cjs')))
    fail('PRODUCTION_LAUNCHER_MISSING');

  for (const relative of [
    'PRODUCTION_RUNBOOKS.md',
    'PRODUCTION_CONFIGURATION.md',
    'lingua_ai_backend/src/tooling/README.md',
    'lingua_ai_pronunciation_service/README.md',
  ]) {
    const file = resolve(root, relative);
    if (!existsSync(file) || !readFileSync(file, 'utf8').trim())
      fail('RUNBOOK_MISSING');
  }
  // Pure inventory metadata, not Mongoose models, schema hooks or DB inspection.
  const {
    CRITICAL_INDEXES,
  } = require('../dist/src/operations/index-inventory.js');
  if (!Array.isArray(CRITICAL_INDEXES) || !CRITICAL_INDEXES.length)
    fail('INDEX_INVENTORY_MISSING');
  return {
    status: 'LOCAL_PREFLIGHT_PASSED',
    checks: {
      backendConfiguration: 'ok',
      compiledEntry: 'ok',
      productionLauncher: 'ok',
      runbookFiles: 'ok',
      indexInventoryReference: 'ok',
    },
    criticalIndexGroups: CRITICAL_INDEXES.length,
    credentialRotationVerified: false,
    runtimeReadinessVerified: false,
    independentAuthorityConfigured: production.summary.timelineAuthorityMode === 'DURABLE_REQUIRED',
    operatorVerificationRequired: [
      'credential_rotation_and_revocation',
      'database_topology_and_actual_indexes',
      'catalog_and_shared_upload_storage',
      'coordinated_backup_and_restore_drill',
      'offline_replay_recovery_safety',
      'web_flutter_artifacts_and_client_capabilities',
      'pronunciation_config_artifacts_and_private_network',
      'ingress_limits_and_smoke_tests',
    ],
  };
}

function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'Usage: npm run preflight:deploy (after build, injected NODE_ENV=production).',
    );
    console.log(
      'Local read-only checks from the release checkout; no connections, file writes or index changes.',
    );
    console.log(
      'No .env loading, DB/apply mode, model loading, or credential rotation verification.',
    );
    return;
  }
  if (args.length) {
    console.error(
      'Unsupported preflight arguments; no DB, apply or mutation mode exists.',
    );
    process.exitCode = 1;
    return;
  }
  try {
    console.log(JSON.stringify(runPreflight()));
  } catch (error) {
    const codes = [
      'PRODUCTION_LAUNCHER_MISMATCH',
      'PRODUCTION_LAUNCHER_MISSING',
      'RUNBOOK_MISSING',
      'INDEX_INVENTORY_MISSING',
    ];
    console.error(
      error.message?.startsWith('Configuration error:')
        ? error.message
        : codes.includes(error.preflightCode)
          ? `Local deployment preflight failed: ${error.preflightCode}.`
          : 'Local deployment preflight failed. Require NODE_ENV=production, built backend and release runbooks.',
    );
    process.exitCode = 1;
  }
}

module.exports = { runPreflight, main };
if (require.main === module) main();
