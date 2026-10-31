// OPERATOR_TOOL: bounded, explicit same-timeline retry of an established deletion intent.
import { readFileSync } from 'node:fs';
import { createConnection } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { validateEnvironment } from '../config/runtime-config';
import { SharedCommunityStorage } from '../community/shared-community.storage';
import { DurableTimelineAuthority } from '../operations/durable-authority';
import { TimelineWriteGate } from '../operations/timeline-gate';
import { MutationTimeline } from '../operations/mutation-timeline';
import { isTimelineId } from '../operations/timeline-contract';
export async function main(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== '--plan')
    throw Error('EXPLICIT_OBJECT_EFFECT_PLAN_REQUIRED');
  const p = JSON.parse(readFileSync(args[1], 'utf8')) as {
    publicName: string;
    operationId: string;
    timelineId: string;
    generation: number;
  };
  const c = validateEnvironment(process.env);
  if (
    !p ||
    Object.keys(p).sort().join() !==
      ['publicName', 'operationId', 'timelineId', 'generation'].sort().join() ||
    !/^[a-f0-9-]{36}\.(jpg|png|webp)$/.test(p.publicName) ||
    !isTimelineId(p.operationId) ||
    p.timelineId !== c.DATA_TIMELINE_ID ||
    p.generation !== Number(c.TIMELINE_AUTHORITY_GENERATION) ||
    c.DATA_WRITE_MODE !== 'OPEN' ||
    c.UPLOAD_STORAGE_BACKEND !== 'S3' ||
    process.env.AUTHORITY_OPERATOR_INTENT !==
      'I_ACKNOWLEDGE_DISPOSABLE_AUTHORITY' ||
    c.OBJECT_STORAGE_ENDPOINT !== 'http://object-store:8333' ||
    c.MONGODB_URI !==
      'mongodb://mongo:27017/lingua_staging?replicaSet=staging-rs'
  )
    throw Error('SAME_TIMELINE_DISPOSABLE_RETRY_REQUIRED');
  const mongo = createConnection(c.MONGODB_URI, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 5000,
    timeoutMS: 5000,
  });
  const config = new ConfigService(c),
    authority = new DurableTimelineAuthority(config);
  try {
    await mongo.asPromise();
    const timeline = new MutationTimeline(
        mongo,
        config,
        new TimelineWriteGate(
          mongo,
          config,
          () => false,
          () => true,
          authority,
        ),
      ),
      storage = new SharedCommunityStorage(config, timeline, mongo);
    const row = await storage.lookup(p.publicName);
    if (
      !row ||
      row.delete_operation !== p.operationId ||
      row.verified_timeline !== p.timelineId ||
      Number(row.verified_generation) !== p.generation ||
      !['DELETE_PENDING', 'DELETED'].includes(row.status)
    )
      throw Error('ESTABLISHED_DELETE_INTENT_REQUIRED');
    await timeline.run(
      { dataTimelineId: p.timelineId, protocol: 2, legacyReceipts: false },
      () => storage.remove('/uploads/community/' + p.publicName),
    );
    if ((await storage.lookup(p.publicName))?.status !== 'DELETED')
      throw Error('DELETE_INTENT_STILL_PENDING_OR_REFERENCED');
    console.log(
      'SAME_TIMELINE_DELETE_INTENT_COMPLETED; retained versions unchanged.',
    );
  } finally {
    authority.onModuleDestroy();
    await mongo.close();
  }
}
if (require.main === module)
  main().catch(() => {
    console.error(
      'OBJECT_EFFECT_RETRY_REFUSED; no background replay or cross-timeline reassignment.',
    );
    process.exitCode = 1;
  });
