const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

function productionEntry() {
  const entry = resolve(__dirname, '../dist/src/main.js');
  if (!existsSync(entry))
    throw new Error('Production entry point missing; run npm run build first.');
  return entry;
}
function validateProduction() {
  if (process.env.NODE_ENV !== 'production')
    throw new Error('NODE_ENV=production must be explicitly set.');
  const entry = productionEntry();
  const {
    validateEnvironment,
    safeConfigSummary,
  } = require('../dist/src/config/runtime-config.js');
  const config = validateEnvironment(process.env); // Environment only; do not read local .env.
  return { entry, summary: safeConfigSummary({ get: (name) => config[name] }) };
}
module.exports = { productionEntry, validateProduction };
