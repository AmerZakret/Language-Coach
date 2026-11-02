// OPERATOR_TOOL. Verify explicit bounded Mongo references and retained object versions.
// No orphan deletion, effect replay, migration, authority transition or automatic reopen.
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createConnection } from 'mongoose';
import { AuthorityOperator, assertNoFileEffects } from './durable-control';
import { objectConfig, S3ObjectStorage } from '../community/object-storage';
import { readAuthority } from '../operations/durable-authority';
import { readTimelineControl } from '../operations/timeline-gate';
import type { StoredObject } from '../community/shared-community.storage';
export async function main(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== '--plan')
    throw Error('EXPLICIT_RECONCILIATION_PLAN_REQUIRED');
  const p = JSON.parse(readFileSync(args[1], 'utf8')) as {
    expectedRevision: number;
    timelineId: string;
    generation: number;
    reference: string;
    isolationReference: string;
    historyContinuityReference: string;
  };
  if (
    !p ||
    Object.keys(p).sort().join() !==
      [
        'expectedRevision',
        'timelineId',
        'generation',
        'reference',
        'isolationReference',
        'historyContinuityReference',
      ]
        .sort()
        .join() ||
    ![p.reference, p.isolationReference, p.historyContinuityReference].every(
      (x) => typeof x === 'string' && /^[A-Za-z0-9._:/-]{1,96}$/.test(x),
    ) ||
    process.env.DATA_WRITE_MODE !== 'CLOSED' ||
    process.env.AUTHORITY_OPERATOR_INTENT !==
      'I_ACKNOWLEDGE_DISPOSABLE_AUTHORITY' ||
    process.env.OBJECT_STORAGE_ENDPOINT !== 'http://object-store:8333' ||
    process.env.MONGODB_URI !==
      'mongodb://mongo:27017/lingua_staging?replicaSet=staging-rs'
  )
    throw Error('DISPOSABLE_CLOSED_RECONCILIATION_REQUIRED');
  const c = objectConfig(process.env),
    s3 = new S3ObjectStorage(c),
    url = new URL(process.env.AUTHORITY_OPERATOR_URL || '');
  if (
    url.hostname !== 'authority' ||
    url.pathname !== '/timeline_authority' ||
    url.username !== 'timeline_operator'
  )
    throw Error('DISPOSABLE_OPERATOR_REQUIRED');
  const op = new AuthorityOperator(url.toString()),
    mongo = createConnection(process.env.MONGODB_URI, {
      autoIndex: false,
      autoCreate: false,
      serverSelectionTimeoutMS: 5000,
      timeoutMS: 5000,
    });
  try {
    await Promise.all([op.connect(), mongo.asPromise()]);
    await op.exclusive(async () => {
      const before = await readAuthority(
        op.uri,
        c.environment,
        String(process.env.TIMELINE_AUTHORITY_STORAGE_ID),
        5000,
        undefined,
        true,
      );
      if (
        !['CLOSED', 'MAINTENANCE'].includes(before.mode) ||
        before.revision !== p.expectedRevision ||
        before.timeline_id !== p.timelineId ||
        before.generation !== p.generation
      )
        throw Error('RECONCILIATION_CAS_MISMATCH');
      await assertNoFileEffects(op);
      await s3.verifyIdentity();
      const control = await readTimelineControl(mongo, 5000);
      if (
        control.writeState !== 'CLOSED' ||
        control.dataTimelineId !== before.timeline_id
      )
        throw Error('MONGO_CLOSED_TARGET_REQUIRED');
      const posts = await mongo
        .db!.collection('communityposts')
        .find(
          { imageUrl: { $type: 'string' } },
          { projection: { imageUrl: 1 }, timeoutMS: 5000 },
        )
        .limit(501)
        .toArray();
      if (posts.length > 500)
        throw Error('BOUNDED_RECONCILIATION_LIMIT_EXCEEDED');
      const urls = [...new Set(posts.map((x) => String(x.imageUrl)))].sort(),
        inventory: unknown[] = [],
        ids: string[] = [];
      for (const imageUrl of urls) {
        if (
          !/^\/uploads\/community\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(
            imageUrl,
          )
        )
          throw Error('LEGACY_REFERENCE_REQUIRES_VERIFIED_MIGRATION');
        const result = await op.client.query<StoredObject>(
          'SELECT * FROM timeline_authority.objects WHERE public_name=$1',
          [imageUrl.split('/').pop()],
        );
        const row = result.rows[0];
        if (
          !row ||
          !row.version_id ||
          row.environment !== c.environment ||
          row.bucket !== c.bucket ||
          row.namespace !== c.namespace ||
          row.storage_identity !== c.storageIdentity
        )
          throw Error('OBJECT_HISTORY_OR_IDENTITY_MISSING');
        const info = await s3.head(row.object_key, row.version_id),
          buffer = await s3.read(row.object_key, row.version_id);
        if (
          info.size !== row.bytes ||
          info.sha256 !== row.sha256 ||
          info.contentType !== row.content_type ||
          createHash('sha256').update(buffer).digest('hex') !== row.sha256
        )
          throw Error('REFERENCED_OBJECT_VERIFICATION_FAILED');
        inventory.push({
          id: row.id,
          key: row.object_key,
          version: row.version_id,
          sha256: row.sha256,
          bytes: row.bytes,
        });
        ids.push(row.id);
      }
      const after = await readTimelineControl(mongo, 5000);
      if (
        after.controlVersion !== control.controlVersion ||
        after.dataTimelineId !== control.dataTimelineId ||
        after.writeState !== 'CLOSED'
      )
        throw Error('MONGO_CHANGED_DURING_RECONCILIATION');
      // Publish no partial adoption or completion receipt if any verification failed.
      await op.client.query('BEGIN');
      try {
        for (const id of ids)
          await op.client.query(
            'SELECT timeline_authority.object_adopt($1,$2,$3)',
            [id, p.expectedRevision, p.reference],
          );
        const sha = createHash('sha256')
          .update(JSON.stringify(inventory))
          .digest('hex');
        await op.client.query(
          'SELECT timeline_authority.object_reconcile_complete($1,$2,$3,$4,$5)',
          [randomUUID(), p.expectedRevision, urls.length, sha, p.reference],
        );
        await op.client.query('COMMIT');
        const counts = await op.client.query(
          'SELECT status,count(*)::integer AS count FROM timeline_authority.objects GROUP BY status',
        );
        console.log(
          JSON.stringify({
            status: 'DISPOSABLE_OBJECT_REFERENCES_VERIFIED',
            timelineId: p.timelineId,
            generation: p.generation,
            referenceCount: urls.length,
            inventorySha256: sha,
            effectCounts: counts.rows,
            unreferencedObjectsRetained: true,
            productionAuthorized: false,
          }),
        );
      } catch (e) {
        await op.client.query('ROLLBACK').catch(() => undefined);
        throw e;
      }
    });
  } finally {
    await Promise.all([op.close(), mongo.close()]);
  }
}
if (require.main === module)
  main().catch(() => {
    console.error(
      'OBJECT_RECONCILIATION_FAILED; remain isolated; no cleanup/reopen.',
    );
    process.exitCode = 1;
  });
