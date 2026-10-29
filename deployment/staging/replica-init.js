// Disposable local simulation only. No users, application rows or indexes are seeded.
const expected = 'staging-rs';
let config;
try {
  config = rs.conf();
} catch (error) {
  if (error.codeName !== 'NotYetInitialized') throw error;
}
if (!config) {
  rs.initiate({ _id: expected, members: [{ _id: 0, host: 'mongo:27017' }] });
} else if (config._id !== expected || config.members.length !== 1 || config.members[0].host !== 'mongo:27017') {
  throw new Error('Unexpected replica set configuration; no automatic repair.');
}
for (let attempt = 0; attempt < 60; attempt++) {
  if (db.hello().isWritablePrimary === true) quit(0);
  sleep(1000);
}
throw new Error('Disposable replica set did not elect a primary.');
