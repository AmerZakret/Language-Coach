import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import {
  S3ObjectStorage,
  objectConfig,
  objectKey,
  storageIdentityBody,
} from './object-storage';
import { validateEnvironment } from '../config/runtime-config';
import { assertNewEmptyObjectStore } from '../tooling/object-bootstrap-cli';

const env = {
  OBJECT_STORAGE_ENDPOINT: 'http://object-store:8333',
  OBJECT_STORAGE_BUCKET: 'language-coach-c2-local',
  OBJECT_STORAGE_NAMESPACE: 'community',
  OBJECT_STORAGE_IDENTITY: 'synthetic-object-data',
  OBJECT_STORAGE_ACCESS_KEY: randomBytes(32).toString('hex'),
  OBJECT_STORAGE_SECRET_KEY: randomBytes(32).toString('hex'),
  TIMELINE_AUTHORITY_ENVIRONMENT: 'synthetic',
  READINESS_TIMEOUT_MS: 100,
};
const c = objectConfig(env),
  A = '11111111-1111-4111-8111-111111111111',
  name = '22222222-2222-4222-8222-222222222222.png',
  key = objectKey(c, A, 1, name),
  bytes = Buffer.from('synthetic bounded adapter bytes');
const sha = createHash('sha256').update(bytes).digest('hex');
let server: Server,
  adapter: S3ObjectStorage,
  mode: string,
  requests: {
    method: string;
    url: string;
    headers: import('node:http').IncomingHttpHeaders;
  }[];
beforeEach(async () => {
  mode = 'ok';
  requests = [];
  server = createServer((req, res) => {
    requests.push({ method: req.method!, url: req.url!, headers: req.headers });
    if (mode === 'hang') return;
    if (mode === 'denied') {
      res.writeHead(403).end();
      return;
    }
    if (mode === 'lost') {
      req.socket.destroy();
      return;
    }
    if (mode === 'redirect') {
      res
        .writeHead(307, { location: 'http://127.0.0.1:1/credential-leak' })
        .end();
      return;
    }
    if (req.url?.includes('versioning')) {
      res.end(
        '<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>',
      );
      return;
    }
    if (req.url?.includes('control/identity.json')) {
      res.end(mode === 'wrong-identity' ? '{}' : storageIdentityBody(c));
      return;
    }
    res.setHeader('x-amz-version-id', 'synthetic-version');
    if (req.method === 'PUT' || req.method === 'DELETE') {
      req.resume();
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', bytes.length);
    res.setHeader('x-amz-meta-sha256', sha);
    res.end(
      req.method === 'HEAD'
        ? undefined
        : mode === 'corrupt'
          ? Buffer.alloc(bytes.length)
          : bytes,
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  adapter = new S3ObjectStorage({
    ...c,
    endpoint: 'http://127.0.0.1:' + (server.address() as AddressInfo).port,
  });
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});
test('immutable create uses conditional write, bounded digest and signed exact request', async () => {
  expect(await adapter.createImmutable(key, bytes, 'image/png')).toMatchObject({
    version: 'synthetic-version',
    sha256: sha,
  });
  expect(requests).toHaveLength(1);
  expect(requests[0].headers['if-none-match']).toBe('*');
  expect(requests[0].headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
  expect(requests[0].headers['x-amz-meta-sha256']).toBe(sha);
});
test('read/head bind retained version and checksum; delete never targets a version', async () => {
  expect(await adapter.read(key, 'synthetic-version')).toEqual(bytes);
  expect((await adapter.head(key, 'synthetic-version')).sha256).toBe(sha);
  await adapter.delete(key);
  expect(requests[0].url).toContain('?versionId=synthetic-version');
  expect(requests[2].url).not.toContain('versionId');
});
test.each(['wrong-identity', 'denied', 'redirect', 'hang'])(
  'availability fails closed on %s without retry/fallback',
  async (m) => {
    mode = m;
    await expect(adapter.checkAvailability()).rejects.toThrow();
    expect(requests).toHaveLength(1);
  },
);
test('lost upload acknowledgement is explicitly uncertain', async () => {
  mode = 'lost';
  await expect(
    adapter.createImmutable(key, bytes, 'image/png'),
  ).rejects.toMatchObject({ uncertain: true });
  expect(requests).toHaveLength(1);
});
test('corrupt stored bytes fail checksum verification', async () => {
  mode = 'corrupt';
  await expect(adapter.read(key, 'synthetic-version')).rejects.toThrow(
    'OBJECT_CHECKSUM_MISMATCH',
  );
});
test.each([
  '../other',
  'community/synthetic/../../secret',
  key.replace('/synthetic/', '/other/'),
  key.replace(A, 'invalid'),
  key.replace(name, 'untrusted-name.png'),
])('forged/path-traversal key refuses network: %s', async (k) => {
  await expect(adapter.delete(k)).rejects.toThrow('INVALID_OBJECT_KEY');
  expect(requests).toHaveLength(0);
});
test.each(['null', '../secret', 'x'.repeat(257), ''])(
  'invalid object version refuses network',
  async (v) => {
    await expect(adapter.read(key, v)).rejects.toThrow(
      'INVALID_OBJECT_VERSION',
    );
    expect(requests).toHaveLength(0);
  },
);
test('size/type limits reject before transport', async () => {
  await expect(
    adapter.createImmutable(key, Buffer.alloc(5242881), 'image/png'),
  ).rejects.toThrow();
  await expect(
    adapter.createImmutable(key, bytes, 'text/html'),
  ).rejects.toThrow();
  expect(requests).toHaveLength(0);
});
test.each([
  { OBJECT_STORAGE_ENDPOINT: 'http://external.example' },
  { OBJECT_STORAGE_ENDPOINT: 'https://name:password@store.example' },
  { OBJECT_STORAGE_NAMESPACE: '../other' },
  { OBJECT_STORAGE_ACCESS_KEY: '' },
  { OBJECT_STORAGE_SECRET_KEY: '' },
])(
  'configuration rejects insecure endpoint or absent identity/credentials',
  (change) => {
    expect(() => objectConfig({ ...env, ...change })).toThrow();
  },
);
test('required staging profile cannot fall back to filesystem', () => {
  expect(() =>
    validateEnvironment({
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://db.example.invalid/test',
      JWT_SECRET: randomBytes(32).toString('hex'),
      AI_ENABLED: 'false',
      PRONUNCIATION_ENABLED: 'false',
      DATA_TIMELINE_ID: A,
      DEPLOYMENT_PROFILE: 'DURABLE_REQUIRED',
      TIMELINE_AUTHORITY_MODE: 'DURABLE_REQUIRED',
      TIMELINE_AUTHORITY_ENVIRONMENT: 'synthetic',
      TIMELINE_AUTHORITY_STORAGE_ID: 'synthetic-authority',
      TIMELINE_AUTHORITY_GENERATION: 1,
      TIMELINE_AUTHORITY_URL: [
        'postgresql://',
        'reader',
        ':',
        randomBytes(32).toString('hex'),
        '@authority/test',
      ].join(''),
      UPLOAD_STORAGE_BACKEND: 'FILESYSTEM',
    }),
  ).toThrow('UPLOAD_STORAGE_BACKEND');
});

test.each([
  '<Version><Key>community/old/object.png</Key></Version>',
  '<DeleteMarker><Key>community/old/object.png</Key></DeleteMarker>',
  '<Version><Key>control/identity.json</Key></Version><Version><Key>control/identity.json</Key></Version>',
])(
  'new-empty bootstrap rejects retained object history without a write',
  async (history) => {
    const request = jest.spyOn(adapter, 'request').mockResolvedValue({
      status: 200,
      headers: {},
      body: Buffer.from(
        '<ListVersionsResult><IsTruncated>false</IsTruncated>' +
          history +
          '</ListVersionsResult>',
      ),
    });
    await expect(assertNewEmptyObjectStore(adapter)).rejects.toThrow(
      'NEW_EMPTY_OBJECT_STORE_REQUIRED',
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe('GET');
    expect(request.mock.calls[0][2]).toEqual({ versions: '', 'max-keys': '2' });
  },
);

test.each([
  '<ListVersionsResult><IsTruncated>true</IsTruncated></ListVersionsResult>',
  '<Error/>',
])(
  'new-empty bootstrap rejects truncated or unrecognized inventory',
  async (xml) => {
    jest
      .spyOn(adapter, 'request')
      .mockResolvedValue({ status: 200, headers: {}, body: Buffer.from(xml) });
    await expect(assertNewEmptyObjectStore(adapter)).rejects.toThrow(
      'NEW_EMPTY_OBJECT_STORE_REQUIRED',
    );
  },
);
