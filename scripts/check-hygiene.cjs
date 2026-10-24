const { execFileSync } = require('node:child_process');
const { resolve, basename } = require('node:path');
const root = resolve(__dirname, '..');
function forbiddenPath(name) {
  const file = basename(name).toLowerCase();
  return /(^|\/)(__pycache__|node_modules|dist|build|coverage|\.dart_tool|model-cache|\.venv|venv)(\/|$)/i.test(name)
    || /\.py[co]$/i.test(file)
    || /^lingua_ai_backend\/uploads\//i.test(name)
    || (/^\.env(?:\.|$)/i.test(file) && !/^\.env(?:\.[\w-]+)?\.example$/i.test(file))
    || /\.(?:jks|keystore|p12|pfx|pem|key)$/i.test(file)
    || /^(?:key\.properties|id_rsa|id_ed25519)$/i.test(file);
}
function main() {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const bad = files.filter(forbiddenPath);
  if (bad.length) throw new Error(`Forbidden release artifact paths:\n${bad.join('\n')}`);
  console.log('Artifact/config path hygiene passed. This path gate does not certify secret rotation or scan Git history.');
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { forbiddenPath };
