try {
  const { entry } = require('./production-entry.cjs').validateProduction();
  require(entry);
} catch (error) {
  // Validator errors contain field names/policies only. Never print parser details.
  console.error(
    error.message?.startsWith('Configuration error:')
      ? error.message
      : 'Production startup preflight failed. Set NODE_ENV=production and build the backend.',
  );
  process.exitCode = 1;
}
