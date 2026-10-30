// Disposable local simulation only. No users, application rows or indexes are seeded.
const expected = 'staging-rs';
let replicaConfig = null;
try {
  replicaConfig = rs.conf();
} catch (error) {
  if (error.codeName !== 'NotYetInitialized') throw error;
}
if (!replicaConfig) {
  rs.initiate({ _id: expected, members: [{ _id: 0, host: 'mongo:27017' }] });
} else if (replicaConfig._id !== expected || replicaConfig.members.length !== 1 || replicaConfig.members[0].host !== 'mongo:27017') {
  throw new Error('Unexpected replica set configuration; no automatic repair.');
}
for (let attempt = 0; attempt < 60; attempt++) {
  if (db.hello().isWritablePrimary === true) quit(0);
  sleep(1000);
}
throw new Error('Disposable replica set did not elect a primary.');
