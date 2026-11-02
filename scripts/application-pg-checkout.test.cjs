const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync, mkdirSync, mkdtempSync } = require('node:fs');
const { resolve, join } = require('node:path');

const root = resolve(__dirname, '..');
const migrationPath = 'lingua_ai_backend/migrations/application';
const sha256 = value => createHash('sha256').update(value).digest('hex');

test('application PG bytes survive real CRLF/LF checkouts without accepting tampering', { timeout: 120000 }, () => {
  const artifacts = join(root, '.release-validation');
  mkdirSync(artifacts, { recursive: true });
  const fixture = mkdtempSync(join(artifacts, 'application-pg-checkout-'));
  const emptyConfig = join(fixture, 'empty.gitconfig');
  const emptyTemplate = join(fixture, 'empty-template');
  writeFileSync(emptyConfig, '');
  mkdirSync(emptyTemplate);
  // Isolate fixture configuration/hooks; never edit global or project config.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name)));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig });
  // The sandbox may have a different Windows SID from the explicitly authorized
  // workspace owner. Trust only this root for these commands, never a wildcard.
  const git = (cwd, args, input) => execFileSync('git', ['-c', 'safe.directory=' + root.replaceAll('\\', '/'), '-C', cwd, ...args], {
    env, input, timeout: 30000, maxBuffer: 100 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const indexBefore = git(root, ['ls-files', '--stage', '-z']);
  const refsBefore = git(root, ['show-ref']);
  const records = indexBefore.toString('utf8').split('\0').filter(Boolean).map(line => {
    const match = /^(\d{6}) ([0-9a-f]{40}) 0\t(.+)$/.exec(line);
    assert.ok(match, 'Only an unconflicted stage-zero index is supported');
    return { mode: match[1], oid: match[2], path: match[3] };
  });
  const blob = path => {
    assert.ok(records.some(record => record.path === path), `Required staged path missing: ${path}`);
    return git(root, ['show', ':' + path]);
  };
  const manifestBytes = blob(migrationPath + '/manifest.json');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert.equal(manifest.entries.length, 6);
  const ids = manifest.entries.map(entry => entry.id);
  const paths = [
    ...ids.map(id => migrationPath + '/' + id + '.sql'),
    migrationPath + '/manifest.json',
    'deployment/application-postgres/provision.sh',
  ];
  const canonical = new Map(paths.map(path => [path, blob(path)]));
  for (const [path, bytes] of canonical) {
    assert.equal(bytes.includes(13), false, `Canonical CR byte: ${path}`);
    assert.equal(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), false, `Canonical BOM: ${path}`);
  }
  for (const entry of manifest.entries) {
    assert.equal(sha256(canonical.get(migrationPath + '/' + entry.id + '.sql')), entry.sha256);
  }

  try {
    // Copy the complete intended index, not HEAD alone, into an isolated object
    // database. pack-objects --stdout only READS project objects; all writes,
    // tree/temporary commit/ref creation happen in this disposable fixture.
    const seed = join(fixture, 'seed');
    mkdirSync(seed);
    git(seed, ['init', '--initial-branch=checkout-fixture', '--template=' + emptyTemplate]);
    const oids = [...new Set(records.map(record => record.oid))];
    const pack = git(root, ['pack-objects', '--stdout'], oids.join('\n') + '\n');
    git(seed, ['unpack-objects'], pack);
    git(seed, ['update-index', '-z', '--index-info'], indexBefore);
    const tree = git(seed, ['write-tree']).toString('utf8').trim();
    const commit = git(seed, [
      '-c', 'user.name=Synthetic checkout fixture', '-c', 'user.email=fixture@example.invalid',
      'commit-tree', tree, '-m', 'Disposable checkout-integrity fixture only',
    ]).toString('utf8').trim();
    git(seed, ['update-ref', 'refs/heads/checkout-fixture', commit]);

    const verify = checkout => {
      // Run the ACTUAL verifier source from the fresh checkout, not a copied
      // checksum algorithm or a possibly stale compiled dist file.
      const verifier = join(checkout, 'lingua_ai_backend/src/persistence/pg-schema.ts');
      const script = `try {
        const loaded = require(process.argv[1]).loadApplicationManifest(process.argv[2]);
        console.log(JSON.stringify({result:'ACCEPTED',digest:loaded.digest,ids:loaded.manifest.entries.map(e=>e.id)}));
      } catch(error) {
        if(error.category!=='SCHEMA_MISMATCH') throw error;
        console.log(JSON.stringify({result:error.category}));
      }`;
      return JSON.parse(execFileSync(process.execPath, [
        '-r', join(root, 'lingua_ai_backend/node_modules/ts-node/register/transpile-only'),
        '-e', script, verifier, join(checkout, migrationPath),
      ], {
        cwd: checkout, env: { ...env, TS_NODE_PROJECT: join(checkout, 'lingua_ai_backend/tsconfig.json') },
        timeout: 10000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      }));
    };

    for (const [label, autocrlf, eol] of [['crlf', 'true', 'crlf'], ['lf', 'false', 'lf']]) {
      const checkout = join(fixture, label);
      git(fixture, ['clone', '--local', '--no-hardlinks', '--no-checkout', '--template=' + emptyTemplate, seed, checkout]);
      git(checkout, ['config', 'core.autocrlf', autocrlf]);
      git(checkout, ['config', 'core.eol', eol]);
      git(checkout, ['checkout', '--detach', commit]);
      assert.equal(git(checkout, ['rev-parse', 'HEAD^{tree}']).toString('utf8').trim(), tree);
      const attrs = git(checkout, ['check-attr', '-z', 'text', 'eol', '--', ...paths]).toString('utf8').split('\0');
      for (let i = 0; i < attrs.length - 1; i += 3) {
        assert.equal(attrs[i + 2], attrs[i + 1] === 'text' ? 'set' : 'lf', attrs[i]);
      }
      const hashes = {};
      for (const [path, bytes] of canonical) {
        const actual = readFileSync(join(checkout, path));
        assert.deepEqual(actual, bytes, `Checkout changed canonical bytes: ${label}/${path}`);
        hashes[path] = sha256(actual);
      }
      // Demonstrate these are real, distinct checkout filters. Unrelated Windows
      // scripts retain the original text=auto policy and become CRLF only in A.
      const windowsScript = 'deployment/application-postgres/Test-Restart.ps1';
      const windowsAttrs = git(checkout, ['check-attr', 'text', 'eol', '--', windowsScript]).toString('utf8');
      assert.match(windowsAttrs, /text: auto/);
      assert.match(windowsAttrs, /eol: unspecified/);
      assert.equal(readFileSync(join(checkout, windowsScript)).includes(13), label === 'crlf');
      const accepted = verify(checkout);
      assert.deepEqual(accepted, { result: 'ACCEPTED', digest: sha256(manifestBytes), ids });
      const tamper = join(checkout, paths[0]);
      const original = readFileSync(tamper);
      const altered = Buffer.from(original);
      altered[0] ^= 1;
      try {
        writeFileSync(tamper, altered);
        assert.deepEqual(verify(checkout), { result: 'SCHEMA_MISMATCH' });
      } finally {
        // Restore only this disposable fixture file, never the project worktree.
        writeFileSync(tamper, original);
      }
      assert.deepEqual(verify(checkout), accepted);
      console.log(JSON.stringify({
        event: 'application_pg_checkout_integrity', fixture, label, tree, commit,
        autocrlf, eol, hashes, manifestDigest: accepted.digest, ids,
        attributes: 'text eol=lf', lines: git(checkout, ['ls-files', '--eol', '--', ...paths]).toString('utf8'),
        tamper: 'SCHEMA_MISMATCH', restored: 'ACCEPTED',
      }));
    }
  } finally {
    assert.deepEqual(git(root, ['ls-files', '--stage', '-z']), indexBefore, 'Project index changed');
    assert.deepEqual(git(root, ['show-ref']), refsBefore, 'Project refs changed');
    // Retain the isolated checkouts as evidence; no recursive cleanup/prune.
  }
});
