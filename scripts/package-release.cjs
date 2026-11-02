// Explicit packaging only; never starts an application or installs dependencies.
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, buildId, plan, validate, directoryEntries } = require('./release-artifacts.cjs');
function assemble(component, destination, root = ROOT, identity = 'development') {
  const entries = plan(component, root, buildId(identity));
  validate(component, entries);
  const target = path.resolve(destination);
  if (fs.existsSync(target)) throw new Error('Release destination must not exist; nothing was overwritten.');
  fs.mkdirSync(target); // Parent must already exist; no recursive overwrite/cleanup.
  for (const [name, bytes] of entries) {
    const file = path.resolve(target, name);
    if (!file.startsWith(target + path.sep)) throw new Error('Invalid release destination path.');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes, { flag: 'wx' });
  }
  return validate(component, directoryEntries(target));
}
if (require.main === module) {
  try {
    const [component, destination, identity] = process.argv.slice(2);
    if (!component || !destination || process.argv.length > 5) throw new Error('Usage: node scripts/package-release.cjs backend|web|pronunciation NEW_DIRECTORY [PUBLIC_BUILD_ID]');
    console.log(JSON.stringify(assemble(component, destination, ROOT, identity)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { assemble };
