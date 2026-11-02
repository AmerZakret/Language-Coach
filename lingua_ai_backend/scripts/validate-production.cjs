try {
  const { summary } = require('./production-entry.cjs').validateProduction();
  console.log(JSON.stringify(summary));
  console.log(
    'Production configuration shape and compiled entry point validated. No connections made; credential rotation is NOT verified.',
  );
} catch (error) {
  console.error(
    error.message?.startsWith('Configuration error:')
      ? error.message
      : 'Production preflight failed. Set NODE_ENV=production and run npm run build first.',
  );
  process.exitCode = 1;
}
