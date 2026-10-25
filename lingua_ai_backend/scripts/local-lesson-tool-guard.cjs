// Loaded before Nest/AppModule: no dotenv, DB connections or writes here.
function assertLocalLessonReplacement(args, env) {
  const uri = env.MONGODB_URI || '';
  if (env.NODE_ENV !== 'development' || args.length !== 1 || args[0] !== '--replace-local-english-lessons'
    || !/^mongodb:\/\/(?:127\.0\.0\.1|localhost)(?::[1-9]\d{0,4})?\/(?:lingua_dev|lingua_test)\?directConnection=true$/.test(uri)) {
    throw new Error('Local lesson replacement requires NODE_ENV=development, explicit loopback lingua_dev/lingua_test MONGODB_URI with directConnection=true, and --replace-local-english-lessons.');
  }
  return uri;
}
if (/(?:^|[\\/])update-english-db\.(?:ts|js)$/.test(process.argv[1] || '')) {
  try { assertLocalLessonReplacement(process.argv.slice(2), process.env); }
  catch (error) { console.error(error.message); process.exit(1); }
}
module.exports = { assertLocalLessonReplacement };
