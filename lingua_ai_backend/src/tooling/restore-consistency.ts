// Read-only consistency evidence, never a repair or reopening authority. The
// trusted coordinated manifest must be retained outside the Mongo restore set.
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { Connection, mongo } from 'mongoose';
import {
  readTimelineControl,
  verifyTimelineSchema,
} from '../operations/timeline-gate';
import { isTimelineId } from '../operations/timeline-contract';
import {
  CRITICAL_INDEXES,
  inspectIndexes,
} from '../operations/index-inventory';
import {
  COMMUNITY_IMAGE_NAME,
  COMMUNITY_IMAGE_PREFIX,
} from '../community/community-image.storage';

export const RESTORE_COLLECTIONS = [
  'users',
  'lessons',
  'progresses',
  'progressresets',
  'flashcards',
  'flashcardoperations',
  'communityposts',
  'mutationreceipts',
  'chatmessages',
  'chatbarriers',
] as const;
export type RestoreManifest = {
  schemaVersion: 1;
  snapshotId: string;
  sourceTimelineId: string;
  collections: Record<string, string>;
  uploads: Record<string, string>;
};
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, stable(item)]),
    );
  return value;
}
export function restoreDigest(value: unknown): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        stable(mongo.BSON.EJSON.serialize(value, { relaxed: false })),
      ),
    )
    .digest('hex');
}
export async function collectionDigest(
  connection: Connection,
  name: string,
): Promise<string> {
  const rows = await connection
    .db!.collection(name)
    .find({})
    .sort({ _id: 1 })
    .toArray();
  return restoreDigest(rows);
}
export async function uploadDigests(
  root: string,
): Promise<Record<string, string>> {
  const base = await realpath(root),
    directory = await realpath(join(base, 'community'));
  const child = relative(base, directory);
  if (
    !child ||
    child === '..' ||
    child.startsWith(`..${sep}`) ||
    isAbsolute(child)
  )
    throw new Error('Unsafe upload directory');
  const files: Record<string, string> = {};
  for (const name of (await readdir(directory)).sort()) {
    if (!COMMUNITY_IMAGE_NAME.test(name))
      throw new Error('Unexpected upload entry');
    const file = join(directory, name),
      stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('Unsafe upload entry');
    files[name] = createHash('sha256')
      .update(await readFile(file))
      .digest('hex');
  }
  return files;
}
export async function captureRestoreManifest(
  connection: Connection,
  root: string,
  snapshotId: string,
): Promise<RestoreManifest> {
  const row = await readTimelineControl(connection, 5000);
  if (!isTimelineId(snapshotId)) throw new Error('Invalid snapshot identity');
  const collections: Record<string, string> = {};
  for (const name of RESTORE_COLLECTIONS)
    collections[name] = await collectionDigest(connection, name);
  return {
    schemaVersion: 1,
    snapshotId,
    sourceTimelineId: row.dataTimelineId,
    collections,
    uploads: await uploadDigests(root),
  };
}

export async function auditRestoreConsistency(
  connection: Connection,
  root: string,
  manifest: RestoreManifest,
  external: { expectedTimelineId: string; writeMode: 'CLOSED' | 'OPEN' },
) {
  const findings = new Set<string>();
  const add = (code: string) => findings.add(code);
  if (external.writeMode !== 'CLOSED') add('EXTERNAL_ISOLATION_REQUIRED');
  if (
    manifest.schemaVersion !== 1 ||
    !isTimelineId(manifest.snapshotId) ||
    !isTimelineId(manifest.sourceTimelineId) ||
    Object.keys(manifest.collections).sort().join() !==
      [...RESTORE_COLLECTIONS].sort().join() ||
    !Object.values(manifest.collections).every((value) =>
      /^[a-f0-9]{64}$/.test(value),
    )
  )
    add('MANIFEST_UNVERIFIED');
  let before: Awaited<ReturnType<typeof readTimelineControl>> | undefined;
  try {
    before = await readTimelineControl(connection, 5000);
    await verifyTimelineSchema(connection, 5000);
    if (
      before.dataTimelineId !== manifest.sourceTimelineId &&
      before.sourceTimelineId !== manifest.sourceTimelineId
    )
      add('SOURCE_TIMELINE_MISMATCH');
    if (before.dataTimelineId !== external.expectedTimelineId)
      add('EXTERNAL_TIMELINE_MISMATCH');
    if (before.writeState !== 'CLOSED') add('MONGO_ISOLATION_REQUIRED');
    for (const name of RESTORE_COLLECTIONS) {
      if (
        (await collectionDigest(connection, name)) !==
        manifest.collections[name]
      ) {
        add(
          name === 'chatbarriers'
            ? 'AI_BARRIER_MANIFEST_MISMATCH'
            : [
                  'mutationreceipts',
                  'flashcardoperations',
                  'progressresets',
                ].includes(name)
              ? 'RECEIPT_MANIFEST_MISMATCH'
              : 'DOMAIN_MANIFEST_MISMATCH',
        );
      }
    }
    for (const index of CRITICAL_INDEXES) {
      const actual = (await connection
        .db!.collection(index.collection)
        .listIndexes()
        .toArray()) as Parameters<typeof inspectIndexes>[1];
      if (inspectIndexes(index, actual).length) add('EXPECTED_INDEX_MISSING');
    }
    const files = await uploadDigests(root);
    if (restoreDigest(files) !== restoreDigest(manifest.uploads))
      add('UPLOAD_MANIFEST_MISMATCH');
    const referenced = new Set<string>();
    for (const post of await connection
      .db!.collection('communityposts')
      .find({}, { projection: { imageUrl: 1 } })
      .toArray()) {
      if (!post.imageUrl) continue;
      if (
        typeof post.imageUrl !== 'string' ||
        !post.imageUrl.startsWith(COMMUNITY_IMAGE_PREFIX) ||
        !COMMUNITY_IMAGE_NAME.test(
          post.imageUrl.slice(COMMUNITY_IMAGE_PREFIX.length),
        )
      ) {
        add('UNSAFE_UPLOAD_REFERENCE');
        continue;
      }
      const name = post.imageUrl.slice(COMMUNITY_IMAGE_PREFIX.length);
      referenced.add(name);
      if (!(name in files)) add('BROKEN_UPLOAD_REFERENCE');
    }
    if (Object.keys(files).some((name) => !referenced.has(name)))
      add('ORPHAN_UPLOAD');
    const after = await readTimelineControl(connection, 5000);
    if (restoreDigest(before) !== restoreDigest(after))
      add('CONTROL_CHANGED_DURING_AUDIT');
  } catch {
    add('AUDIT_INCOMPLETE');
  }
  return {
    schemaVersion: 1,
    findings: [...findings].sort(),
    reconciliationRequired: findings.size > 0,
    // Evidence for an operator decision only. This function never opens a gate.
    coordinatedSnapshotMatches: findings.size === 0,
    writesReopened: false,
  };
}
