// OPERATOR_TOOL: explicit live read-only companion to the offline release preflight.
import { readFileSync } from 'node:fs';
import { createConnection } from 'mongoose';
import { validateEnvironment } from '../config/runtime-config';
import { ConfigService } from '@nestjs/config';
import {
  readAuthority,
  DurableTimelineAuthority,
} from '../operations/durable-authority';
import {
  readTimelineControl,
  verifyTimelineSchema,
} from '../operations/timeline-gate';
import { boundedCoreReadiness } from './durable-control';

interface PublicAuthorityManifest {
  environment: string;
  buildId: string;
  dataTimelineId: string;
  authority: {
    type: string;
    mode: string;
    fileEffectFencing: string;
    environmentIdentity: string;
    storageIdentity: string;
    generation: number;
    revision: number;
    writeMode: string;
  };
}
export async function main(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== '--manifest')
    throw new Error('EXPLICIT_MANIFEST_REQUIRED');
  const m = JSON.parse(
    readFileSync(args[1], 'utf8'),
  ) as PublicAuthorityManifest;
  const c = validateEnvironment(process.env);
  if (
    c.DEPLOYMENT_PROFILE !== 'DURABLE_REQUIRED' ||
    c.TIMELINE_AUTHORITY_MODE !== 'DURABLE_REQUIRED' ||
    c.MONGODB_URI !==
      'mongodb://mongo:27017/lingua_staging?replicaSet=staging-rs' ||
    new URL(String(c.TIMELINE_AUTHORITY_URL)).hostname !== 'authority' ||
    m.environment !== 'staging' ||
    m.buildId !== c.RELEASE_BUILD_ID ||
    m.authority?.type !== 'postgresql' ||
    m.authority.mode !== 'DURABLE_REQUIRED' ||
    m.authority.fileEffectFencing !== 'DURABLE_EFFECTS_V1'
  )
    throw new Error('EXPLICIT_SYNTHETIC_PROFILE_REQUIRED');
  const read = () =>
    readAuthority(
      String(c.TIMELINE_AUTHORITY_URL),
      String(c.TIMELINE_AUTHORITY_ENVIRONMENT),
      String(c.TIMELINE_AUTHORITY_STORAGE_ID),
      c.READINESS_TIMEOUT_MS,
    );
  const first = await read();
  const shared = c.UPLOAD_STORAGE_BACKEND === 'S3';
  if (shared) {
    const storage = (m as unknown as { objectStorage: Record<string, unknown> })
      .objectStorage;
    if (
      !storage ||
      storage.backend !== 'S3' ||
      storage.bucketIdentity !== c.OBJECT_STORAGE_BUCKET ||
      storage.namespace !== c.OBJECT_STORAGE_NAMESPACE ||
      storage.storageIdentity !== c.OBJECT_STORAGE_IDENTITY ||
      storage.timelineId !== first.timeline_id ||
      storage.generation !== first.generation ||
      storage.migrationState !== c.UPLOAD_MIGRATION_STATE ||
      storage.reconciliationStatus !== 'VERIFIED'
    )
      throw Error('LIVE_OBJECT_MANIFEST_MISMATCH');
  }
  if (
    first.timeline_id !== m.dataTimelineId ||
    first.timeline_id !== c.DATA_TIMELINE_ID ||
    first.environment !== m.authority.environmentIdentity ||
    first.storage_identity !== m.authority.storageIdentity ||
    first.generation !== m.authority.generation ||
    first.generation !== Number(c.TIMELINE_AUTHORITY_GENERATION) ||
    first.revision !== m.authority.revision ||
    first.mode !== m.authority.writeMode
  )
    throw new Error('LIVE_AUTHORITY_MANIFEST_MISMATCH');
  const mongo = createConnection(c.MONGODB_URI, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: c.READINESS_TIMEOUT_MS,
    timeoutMS: c.READINESS_TIMEOUT_MS,
  });
  const authority = new DurableTimelineAuthority(new ConfigService(c));
  try {
    await mongo.asPromise();
    await verifyTimelineSchema(mongo, c.READINESS_TIMEOUT_MS);
    const row = await readTimelineControl(mongo, c.READINESS_TIMEOUT_MS);
    if (
      row.dataTimelineId !== first.timeline_id ||
      row.writeState !== (first.mode === 'OPEN' ? 'OPEN' : 'CLOSED')
    )
      throw new Error('MONGO_AUTHORITY_DISAGREEMENT');
    if (first.mode === 'OPEN' && !shared)
      await authority.fileEffect(
        first.timeline_id,
        'readiness-probe',
        (fence) =>
          boundedCoreReadiness(
            mongo,
            c.UPLOAD_ROOT,
            c.READINESS_TIMEOUT_MS,
            false,
            fence,
          ),
      );
    else
      await boundedCoreReadiness(
        mongo,
        c.UPLOAD_ROOT,
        c.READINESS_TIMEOUT_MS,
        true,
      );
    const last = await read();
    if (last.revision !== first.revision)
      throw new Error('AUTHORITY_CHANGED_DURING_PREFLIGHT');
    console.log(
      JSON.stringify({
        status: 'SYNTHETIC_LIVE_AUTHORITY_PREFLIGHT_PASSED',
        generation: last.generation,
        revision: last.revision,
        writeMode: last.mode,
        productionAuthorized: false,
        uploadWriteProbeVerified: first.mode === 'OPEN' && !shared,
        ...(shared ? { sharedObjectIdentityVerified: true } : {}),
      }),
    );
  } finally {
    authority.onModuleDestroy();
    await mongo.close();
  }
}
if (require.main === module)
  main().catch(() => {
    console.error(
      'LIVE_AUTHORITY_PREFLIGHT_FAILED; no reconciliation or opening performed.',
    );
    process.exitCode = 1;
  });
