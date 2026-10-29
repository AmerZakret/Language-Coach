// Explicit disposable bootstrap. The production application remains VERIFY-ONLY.
const path = require('node:path');
const backend = path.resolve(__dirname, '../../lingua_ai_backend');
const { isTimelineId } = require(path.join(backend, 'dist/src/operations/timeline-contract.js'));
const { CRITICAL_INDEXES, inspectIndexes } = require(path.join(backend, 'dist/src/operations/index-inventory.js'));

function validateTarget(env) {
  if (env.STAGING_BOOTSTRAP !== 'I_ACKNOWLEDGE_DISPOSABLE_STAGING') throw new Error('Explicit disposable bootstrap acknowledgement required.');
  if (!isTimelineId(env.DATA_TIMELINE_ID)) throw new Error('Explicit synthetic timeline UUID required.');
  let uri;
  try { uri = new URL(env.MONGODB_URI); } catch { throw new Error('Invalid disposable Mongo target.'); }
  if (uri.protocol !== 'mongodb:' || uri.hostname !== 'mongo' || uri.port !== '27017'
    || uri.pathname !== '/lingua_staging' || uri.username || uri.password
    || uri.searchParams.get('replicaSet') !== 'staging-rs'
    || [...uri.searchParams.keys()].some(key => key !== 'replicaSet')) {
    throw new Error('Bootstrap is restricted to the uncredentialed local Compose replica set.');
  }
  return env.MONGODB_URI;
}

async function bootstrap(env = process.env) {
  const uri = validateTarget(env); // Complete target validation before any connection.
  const { createConnection } = require(path.join(backend, 'node_modules/mongoose'));
  const connection = createConnection(uri, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  try {
    await connection.asPromise();
    const db = connection.db;
    if (connection.name !== 'lingua_staging') throw new Error('Unexpected database identity.');
    const hello = await db.admin().command({ hello: 1 });
    if (hello.setName !== 'staging-rs' || hello.isWritablePrimary !== true) throw new Error('Disposable replica-set primary required.');
    for (const expected of CRITICAL_INDEXES) {
      if (expected.collection === 'timelinecontrol') continue; // Existing operator CLI provisions strict control schema.
      const collection = db.collection(expected.collection);
      const exists = await db.listCollections({ name: expected.collection }).hasNext();
      const indexes = exists ? await collection.listIndexes().toArray() : [];
      const failures = inspectIndexes(expected, indexes);
      if (failures.some(item => item.code !== 'MISSING_INDEX')) throw new Error(`Unexpected index state for ${expected.collection}; no repair attempted.`);
      if (failures.some(item => item.code === 'MISSING_INDEX')) {
        await collection.createIndex(expected.key, { name: expected.id, unique: true, collation: { locale: 'simple' } });
      }
      const verified = inspectIndexes(expected, await collection.listIndexes().toArray());
      if (verified.length) throw new Error(`Index verification failed for ${expected.collection}.`);
    }
    for (const name of ['communityposts', 'chatmessages']) {
      if (!(await db.listCollections({ name }).hasNext())) await db.createCollection(name);
    }
    console.log('Disposable correctness indexes verified. Timeline control remains CLOSED/absent until explicit operator CLI initialization.');
  } finally {
    await connection.close();
  }
}

if (require.main === module) bootstrap().catch(() => {
  console.error('Disposable bootstrap failed; inspect target and index state. No repair was attempted.');
  process.exitCode = 1;
});
module.exports = { validateTarget, bootstrap };
