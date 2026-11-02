// OPERATOR_TOOL: explicit new-empty disposable initialization, no public endpoint.
import { Client } from 'pg';
import {
  objectConfig,
  S3ObjectStorage,
  storageIdentityBody,
  ObjectRequestError,
} from '../community/object-storage';
/** One bounded version-inventory page; absence of current objects alone is insufficient. */
export async function assertNewEmptyObjectStore(s3: S3ObjectStorage) {
  const result = await s3.request(
    'GET',
    '',
    { versions: '', 'max-keys': '2' },
    Buffer.alloc(0),
    {},
    16384,
  );
  const xml = result.body.toString();
  const keys = [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => m[1]);
  if (
    !/<ListVersionsResult[\s>]/.test(xml) ||
    !/<IsTruncated>false<\/IsTruncated>/.test(xml) ||
    /<DeleteMarker[\s>]/.test(xml) ||
    keys.length > 1 ||
    keys.some((k) => k !== 'control/identity.json')
  )
    throw Error('NEW_EMPTY_OBJECT_STORE_REQUIRED');
}
export async function main() {
  if (
    process.env.STAGING_OBJECT_BOOTSTRAP !==
      'I_ACKNOWLEDGE_NEW_EMPTY_OBJECT_STORAGE' ||
    process.env.AUTHORITY_OPERATOR_INTENT !==
      'I_ACKNOWLEDGE_DISPOSABLE_AUTHORITY' ||
    process.env.OBJECT_STORAGE_ENDPOINT !== 'http://object-store:8333' ||
    process.env.OBJECT_STORAGE_BUCKET !== 'language-coach-c2-local'
  )
    throw Error('EXPLICIT_DISPOSABLE_OBJECT_TARGET_REQUIRED');
  const c = objectConfig({
    ...process.env,
    OBJECT_STORAGE_ACCESS_KEY: process.env.STAGING_OBJECT_ADMIN_ACCESS_KEY,
    OBJECT_STORAGE_SECRET_KEY: process.env.STAGING_OBJECT_ADMIN_SECRET_KEY,
  });
  const uri = new URL(process.env.AUTHORITY_OPERATOR_URL || '');
  if (
    uri.hostname !== 'authority' ||
    uri.pathname !== '/timeline_authority' ||
    uri.username !== 'timeline_operator'
  )
    throw Error('DISPOSABLE_AUTHORITY_REQUIRED');
  const pg = new Client({
    connectionString: uri.toString(),
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
    statement_timeout: 5000,
  });
  pg.on('error', () => undefined);
  try {
    await pg.connect();
    await pg.query('SELECT pg_advisory_lock(110013,1)');
    const check = await pg.query<{ count: string }>(
      'SELECT (SELECT count(*) FROM timeline_authority.current_state)+(SELECT count(*) FROM timeline_authority.issued)+(SELECT count(*) FROM timeline_authority.objects) AS count',
    );
    if (String(check.rows[0].count) !== '0')
      throw Error('NEW_EMPTY_ENVIRONMENT_REQUIRED');
    const s3 = new S3ObjectStorage(c);
    // Existing stores are inspected, never reset. Repeated empty initialization is exact.
    try {
      await s3.request('PUT');
    } catch (e) {
      if (!(e instanceof ObjectRequestError) || e.status !== 409) throw e;
    }
    await assertNewEmptyObjectStore(s3);
    await s3.request(
      'PUT',
      '',
      { versioning: '' },
      Buffer.from(
        '<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Status>Enabled</Status></VersioningConfiguration>',
      ),
      { 'content-type': 'application/xml' },
    );
    const identity = Buffer.from(storageIdentityBody(c));
    try {
      await s3.request('PUT', 'control/identity.json', {}, identity, {
        'if-none-match': '*',
        'content-type': 'application/json',
      });
    } catch (e) {
      if (!(e instanceof ObjectRequestError) || e.status !== 412) throw e;
    }
    await s3.verifyIdentity();
    await pg.query('SELECT timeline_authority.bind_objects($1,$2,$3,$4)', [
      c.environment,
      c.namespace,
      c.bucket,
      c.storageIdentity,
    ]);
    console.log(
      'Disposable versioned object store and independent binding verified. No authority OPEN or data reset.',
    );
  } finally {
    await pg.end().catch(() => undefined);
  }
}
if (require.main === module)
  main().catch(() => {
    console.error('OBJECT_BOOTSTRAP_FAILED; inspect while isolated.');
    process.exitCode = 1;
  });
