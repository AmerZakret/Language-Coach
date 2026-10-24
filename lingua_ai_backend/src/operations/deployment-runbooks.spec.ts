import { randomBytes } from 'node:crypto';
import fs = require('node:fs');
import * as path from 'node:path';
import * as vm from 'node:vm';
import net = require('node:net');
import tls = require('node:tls');
import { spawnSync } from 'node:child_process';
import { mongo } from 'mongoose';
import { CRITICAL_INDEXES } from './index-inventory';

const root = path.resolve(__dirname, '../../..');
const backend = path.resolve(root, 'lingua_ai_backend');
const script = path.resolve(backend, 'scripts/deployment-preflight.cjs');
const runbook = fs
  .readFileSync(path.resolve(root, 'PRODUCTION_RUNBOOKS.md'), 'utf8')
  .replace(/\r\n/g, '\n');
const prose = runbook.replace(/\s+/g, ' ');
function section(title: string) {
  const heading = `## ${title}\n`;
  expect(runbook).toContain(heading);
  return runbook.split(heading)[1].split('\n## ')[0];
}

describe('8F operator runbook safety contracts', () => {
  test('credential rotation and revocation precede broader traffic', () => {
    const deployment = section('Deployment sequence');
    expect(
      deployment.indexOf('Credential rotation before production traffic'),
    ).toBeLessThan(deployment.indexOf('Only then enable broader traffic'));
    const rotation = section(
      'Credential rotation, revocation and history cleanup',
    );
    for (const requirement of [
      'ROTATION',
      'REVOCATION',
      'HISTORY CLEANUP',
      'Verify the\n   old credential',
      'OPERATOR ACTION REQUIRED: YES',
    ])
      expect(rotation).toContain(requirement);
    expect(
      rotation.indexOf('Verify\n   replacement authentication'),
    ).toBeLessThan(rotation.indexOf('Revoke the old identity'));
  });

  test('index inventory and exact options remain operator-controlled, never automatic repair', () => {
    const migration = section('Controlled database and index migration');
    expect(migration).toContain('operator-approved migration identity');
    expect(migration).toContain('VERIFY ONLY');
    expect(migration).toContain('unique:true');
    expect(migration).toContain('simple/binary collation');
    expect(migration).toContain('Never automatically delete');
    expect(migration).toContain(
      'manual migration write, never a preflight command',
    );
    for (const { collection, key } of CRITICAL_INDEXES)
      expect(migration).toContain(
        `| ${collection} | \`${Object.keys(key).join(', ')}\` |`,
      );
    expect(migration).toContain('separately reviewing removal');
    expect(migration).toContain('Do not toggle NODE_ENV');
  });

  test('restore includes matching full database and upload versions before readiness and traffic', () => {
    const restore = section('Consistent restore procedure');
    const ordered = [
      'stop/disable all writes',
      'Restore MongoDB',
      'Restore the matching upload',
      'Verify all critical indexes',
      'Verify durable receipts/results',
      'before traffic',
      '/health/ready',
      'Re-enable a controlled canary',
    ];
    let previous = -1;
    for (const text of ordered) {
      const next = restore.indexOf(text);
      expect(next).toBeGreaterThan(previous);
      previous = next;
    }
    expect(restore).toContain('retained Community receipt results');
    expect(restore).toContain('Do not mutate restored real-user histories');
  });

  test('opposing receipt/domain restore hazards and offline rollback fence gap are explicit', () => {
    expect(prose).toContain(
      'Domain state newer than receipts can allow duplicate replay effects. Receipts newer than domain state can acknowledge effects absent after rollback.',
    );
    for (const field of [
      'progressEpoch',
      'progressWriteRevision',
      'flashcardoperations',
      'progressresets',
      'mutationreceipts',
      'chatbarriers',
      'progressauditrepairs',
    ])
      expect(runbook).toContain(field);
    expect(prose).toContain('no disaster-restore generation fence');
    expect(prose).toContain(
      'keep affected business writes and queue dispatch unavailable',
    );
    expect(prose).toContain(
      'RPO loss acceptance alone does not establish replay safety',
    );
    expect(prose).toContain('Do not delete Flutter durable slots');
  });

  test('minimum capabilities and downgrade/old-tab restrictions do not invent enforcement', () => {
    const compatibility = section(
      'Compatibility minimums and downgrade restrictions',
    );
    for (const requirement of [
      'not invented semantic version numbers',
      'Blind downgrade is prohibited',
      'Prefer forward-fix',
      'Older Flutter binaries',
      'Close/reload all pre-7A tabs',
      'No overall minimum-client enforcement',
      'Web IndexedDB',
    ])
      expect(compatibility).toContain(requirement);
    expect(compatibility.replace(/\s+/g, ' ')).toContain(
      'no runtime deployment- version negotiation',
    );
    expect(compatibility).toContain('Do not clear site data or owner queues');
  });

  test('capacity monitoring covers indefinite receipts, per-process limits and worker memory', () => {
    for (const kind of [
      'BOUNDED_PER_RESOURCE',
      'UNBOUNDED_PER_OPERATION',
      'EPHEMERAL',
      'OPERATOR_MANAGED',
    ])
      expect(runbook).toContain(kind);
    expect(prose).toContain(
      'No TTL or automatic cleanup is permitted for safety receipts',
    );
    expect(prose).toContain('Each ASGI worker multiplies model memory');
    expect(prose).toContain(
      'A: single backend instance with process-local limits',
    );
    expect(prose).toContain(
      'B: scaled backend with ingress/global rate limiting',
    );
    expect(prose).toContain('a future shared limiter store, not present');
    expect(prose).toContain('report of candidates only');
    expect(prose).toContain('No production orphan deletion command');
  });

  test('all four release checklists and smoke/incident steps have operational evidence requirements', () => {
    const release = section('Release artifact checklist');
    for (const component of ['Backend', 'Web', 'Flutter', 'Pronunciation'])
      expect(release).toContain(`### ${component} release`);
    for (const check of [
      'start:prod',
      'VITE_API_URL',
      '--dart-define=API_URL',
      'signing',
      'config.py --production',
      'readiness',
    ])
      expect(release).toContain(check);
    expect(section('Post-deploy smoke tests')).toContain(
      'Do not use production user accounts',
    );
    expect(section('Incident response basics')).toContain(
      'contain -> diagnose -> restore -> verify',
    );
    expect(section('Backup policy and coordinated boundary')).toContain(
      'RPO/RTO',
    );
  });

  test('runbook local links resolve and no secret values/unsafe expiry instructions are added', () => {
    for (const match of runbook.matchAll(/\]\(([^)]+)\)/g)) {
      const relative = match[1].split('#')[0];
      expect(path.isAbsolute(relative)).toBe(false);
      expect(fs.existsSync(path.resolve(root, relative))).toBe(true);
    }
    expect(runbook).not.toMatch(
      /mongodb(?:\+srv)?:\/\/|AIza[\w-]{25,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    );
    expect(runbook).not.toMatch(
      /(?:PRONUNCIATION_SERVICE_TOKEN|JWT_SECRET|GEMINI_API_KEY)\s*=\s*\S+/,
    );
    expect(runbook).not.toMatch(
      /expireAfterSeconds|deleteMany\(|dropIndexes\(|syncIndexes\(/,
    );
    // Manual index provisioning is intentionally documented; no executable migration is added.
    expect(runbook).toContain("db.getCollection('progresses').createIndex(");
  });
});

describe('8F local deployment preflight (no connections or writes)', () => {
  const production = () => ({
    NODE_ENV: 'production',
    CLIENT_PROTOCOL_POLICY: 'ALLOW_LEGACY',
    MONGODB_URI: 'mongodb://db.example.invalid/language',
    JWT_SECRET: randomBytes(48).toString('base64'),
    AI_ENABLED: 'false',
    PRONUNCIATION_ENABLED: 'false',
    CORS_ORIGINS: 'https://app.example.invalid',
    UPLOAD_ROOT: path.resolve(root, 'persistent-uploads'),
  });
  afterEach(() => jest.restoreAllMocks());

  test('read-only capability sandbox passes real compiled config without network/DB/file mutation', () => {
    jest.replaceProperty(process, 'env', { ...process.env, ...production() });
    const entry = require('../../scripts/production-entry.cjs');
    // Resolve trusted pure dependencies before denying write capabilities.
    require('../../dist/src/config/runtime-config.js');
    const inventory = require('../../dist/src/operations/index-inventory.js');
    const paths: string[] = [];
    const connect = jest
      .spyOn(mongo.MongoClient.prototype, 'connect')
      .mockImplementation(() => {
        throw new Error('No DB connection allowed');
      });
    const tcp = jest.spyOn(net, 'connect').mockImplementation(() => {
      throw new Error('No network allowed');
    });
    const secure = jest.spyOn(tls, 'connect').mockImplementation(() => {
      throw new Error('No network allowed');
    });
    const fetch = jest.spyOn(global, 'fetch').mockImplementation(() => {
      throw new Error('No provider calls allowed');
    });
    const writes = [
      'writeFileSync',
      'appendFileSync',
      'mkdirSync',
      'renameSync',
      'unlinkSync',
      'rmSync',
    ].map((name) =>
      jest.spyOn(fs as any, name).mockImplementation(() => {
        throw new Error('No filesystem mutation allowed');
      }),
    );
    const mutations = [
      'createIndex',
      'createIndexes',
      'dropIndex',
      'dropIndexes',
      'insertOne',
      'insertMany',
      'updateOne',
      'updateMany',
      'deleteOne',
      'deleteMany',
    ].map((name) =>
      jest
        .spyOn(mongo.Collection.prototype as any, name)
        .mockImplementation(() => {
          throw new Error('No DB mutation allowed');
        }),
    );
    const context = {
      __dirname: path.dirname(script),
      module: { exports: {} as any },
      require: (name: string) => {
        if (name === 'node:path') return path;
        if (name === 'node:fs')
          return Object.freeze({
            existsSync: fs.existsSync,
            readFileSync: (file: string, encoding: BufferEncoding) => {
              paths.push(file);
              return fs.readFileSync(file, encoding);
            },
          });
        if (name === './production-entry.cjs') return entry;
        if (name === '../dist/src/operations/index-inventory.js')
          return inventory;
        throw new Error('Capability not allowed');
      },
    };
    vm.runInNewContext(fs.readFileSync(script, 'utf8'), context);
    const result = context.module.exports.runPreflight();
    expect(result).toMatchObject({
      status: 'LOCAL_PREFLIGHT_PASSED',
      credentialRotationVerified: false,
      runtimeReadinessVerified: false,
      criticalIndexGroups: CRITICAL_INDEXES.length,
    });
    expect(result.operatorVerificationRequired).toContain(
      'offline_replay_recovery_safety',
    );
    expect(paths).toHaveLength(5); // package.json plus four fixed runbook files.
    expect(paths.some((file) => path.basename(file) === '.env')).toBe(false);
    for (const call of [connect, tcp, secure, fetch, ...writes, ...mutations])
      expect(call).not.toHaveBeenCalled();
  });

  test('standalone command is safe, explicit-production-only, redacted, and refuses mutation flags', () => {
    const env = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      ...production(),
    } as NodeJS.ProcessEnv;
    const run = (args: string[], overrides = {}) =>
      spawnSync(process.execPath, [script, ...args], {
        cwd: backend,
        env: { ...env, ...overrides },
        encoding: 'utf8',
        timeout: 5000,
      });
    const result = run([]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).runtimeReadinessVerified).toBe(false);
    expect(result.stdout + result.stderr).not.toContain(env.JWT_SECRET);
    expect(result.stdout + result.stderr).not.toContain(env.MONGODB_URI);
    for (const args of [
      ['--apply'],
      ['--db'],
      ['--output', 'unsafe'],
      ['--env', '.env'],
    ]) {
      const denied = run(args);
      expect(denied.status).toBe(1);
      expect(denied.stderr).toContain('Unsupported preflight arguments');
    }
    expect(run([], { NODE_ENV: 'development' }).status).toBe(1);
    const marker = randomBytes(32).toString('hex');
    const invalid = run([], { MONGODB_URI: `invalid://${marker}` });
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain('MONGODB_URI');
    expect(invalid.stdout + invalid.stderr).not.toContain(marker);
    expect(
      run(['--help'], {
        NODE_ENV: undefined,
        MONGODB_URI: undefined,
        JWT_SECRET: undefined,
      }).status,
    ).toBe(0);
  });

  test('missing runbook or unexpected production launcher fails without auto-repair', () => {
    const entry = require('../../scripts/production-entry.cjs');
    const fsRead = (scenario: string) =>
      Object.freeze({
        existsSync: (file: string) =>
          scenario === 'runbook' && file.endsWith('PRODUCTION_RUNBOOKS.md')
            ? false
            : fs.existsSync(file),
        readFileSync: (file: string, encoding: BufferEncoding) =>
          file.endsWith('package.json') && scenario === 'launcher'
            ? JSON.stringify({ scripts: { 'start:prod': 'node dist/main' } })
            : fs.readFileSync(file, encoding),
      });
    jest.replaceProperty(process, 'env', { ...process.env, ...production() });
    for (const scenario of ['runbook', 'launcher']) {
      const context = {
        __dirname: path.dirname(script),
        module: { exports: {} as any },
        require: (name: string) => {
          if (name === 'node:path') return path;
          if (name === 'node:fs') return fsRead(scenario);
          if (name === './production-entry.cjs') return entry;
          throw new Error('Unexpected capability');
        },
      };
      vm.runInNewContext(fs.readFileSync(script, 'utf8'), context);
      expect(context.module.exports.runPreflight).toThrow();
    }
  });
});
