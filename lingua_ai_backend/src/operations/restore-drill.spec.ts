import { getModelToken, getConnectionToken } from '@nestjs/mongoose';
import { Model, Connection, mongo } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import {
  RestoreDrill,
  A,
  B,
  C,
  latch,
  restoreReopeningMatrix,
} from '../../test/restore-drill-fixture';
import { MutationTimeline } from './mutation-timeline';
import { TimelineWriteGate, readTimelineControl } from './timeline-gate';
import { CONTROL_COLLECTION } from './timeline-contract';
import { AbuseControls } from '../security/abuse-controls';
import { MutationReceipt } from '../common/mutation-receipt';
import { ChatMessage } from '../ai-coach/schemas/chat-message.schema';
import { ChatBarrier } from '../ai-coach/schemas/chat-barrier.schema';
import { CommunityImageStorage } from '../community/community-image.storage';
import {
  auditRestoreConsistency,
  restoreDigest,
  RESTORE_COLLECTIONS,
} from '../tooling/restore-consistency';
import { telemetry } from './telemetry';
import { ReadinessService } from './readiness.service';

const repetitions = Array.from({ length: 10 }, (_, i) => i + 1);
describe('10E physical disposable snapshot/restore drill', () => {
  jest.setTimeout(120000);
  const drill = new RestoreDrill();
  let provider: jest.SpyInstance;
  const result = () =>
    ({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      reply: 'deterministic',
                      correction: 'synthetic',
                    }),
                  },
                ],
              },
            },
          ],
        }),
    }) as Response;
  const model = <T>(name: string) =>
    drill.apps[0].get<Model<T>>(getModelToken(name));
  const rows = (name: string) =>
    drill.db.db!.collection(name).find({}).sort({ _id: 1 }).toArray();
  const audit = (manifest: Parameters<typeof auditRestoreConsistency>[2]) =>
    auditRestoreConsistency(drill.db, drill.root, manifest, {
      expectedTimelineId: B,
      writeMode: 'CLOSED',
    });
  const image = () =>
    sharp({
      create: { width: 2, height: 2, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer();
  async function postImage(key = randomUUID()) {
    return drill
      .call('post', '/community/posts', A, key)
      .field('learningLanguage', 'en')
      .field('text', 'synthetic')
      .attach('image', await image(), 'image.png')
      .expect(201);
  }
  beforeAll(() => drill.start());
  beforeEach(async () => {
    for (const app of drill.apps)
      jest
        .spyOn(app.get<AbuseControls>(AbuseControls), 'consume')
        .mockImplementation(() => undefined);
    provider = jest
      .spyOn(global, 'fetch')
      .mockImplementation(() => Promise.resolve(result()));
    await drill.reset();
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => drill.stop());

  test.each([
    'progress-complete',
    'progress-reset',
    'card-create',
    'card-review',
    'card-update',
    'card-delete',
    'community-create',
    'community-update',
    'community-delete',
    'community-reaction',
    'ai-send',
  ])(
    'S0 rollback physically loses acknowledged %s; old A rejected, fresh B succeeds',
    async (domain) => {
      const card = await drill
        .call('post', '/flashcards')
        .send({
          targetWord: 'word',
          turkishTranslation: 'translation',
          targetLanguage: 'en',
        })
        .expect(201);
      const post = await drill
        .call('post', '/community/posts')
        .send({ text: 'baseline', learningLanguage: 'en' })
        .expect(201);
      if (domain === 'progress-reset')
        await drill
          .call('post', `/progress/${drill.owner}/complete-lesson`)
          .send({ lessonId: 'one', score: 80, progressEpoch: 5 })
          .expect(201);
      const s0 = await drill.snapshot(),
        key = randomUUID();
      const operation = (timeline: string, id: string) => {
        if (domain === 'progress-complete')
          return drill
            .call(
              'post',
              `/progress/${drill.owner}/complete-lesson`,
              timeline,
              id,
            )
            .send({ lessonId: 'one', score: 80, progressEpoch: 5 });
        if (domain === 'progress-reset')
          return drill
            .call('delete', `/progress/${drill.owner}`, timeline, id)
            .send({ expectedEpoch: 5 });
        if (domain === 'card-create')
          return drill.call('post', '/flashcards', timeline, id).send({
            targetWord: 'new',
            turkishTranslation: 'translation',
            targetLanguage: 'en',
          });
        if (domain === 'card-review')
          return drill
            .call(
              'put',
              `/flashcards/${(card.body as { _id: string })._id}/review`,
              timeline,
              id,
            )
            .send({ score: 4 });
        if (domain === 'card-update')
          return drill
            .call(
              'put',
              `/flashcards/${(card.body as { _id: string })._id}`,
              timeline,
              id,
            )
            .send({ note: 'new' });
        if (domain === 'card-delete')
          return drill.call(
            'delete',
            `/flashcards/${(card.body as { _id: string })._id}`,
            timeline,
            id,
          );
        if (domain === 'community-create')
          return drill
            .call('post', '/community/posts', timeline, id)
            .send({ text: 'new', learningLanguage: 'en' });
        if (domain === 'community-update')
          return drill
            .call(
              'put',
              `/community/posts/${(post.body as { _id: string })._id}`,
              timeline,
              id,
            )
            .send({ text: 'new', expectedRevision: 0 });
        if (domain === 'community-delete')
          return drill
            .call(
              'delete',
              `/community/posts/${(post.body as { _id: string })._id}`,
              timeline,
              id,
            )
            .set('X-Resource-Revision', '0');
        if (domain === 'community-reaction')
          return drill
            .call(
              'post',
              `/community/posts/${(post.body as { _id: string })._id}/like`,
              timeline,
              id,
            )
            .send({ liked: true });
        return drill.send(timeline, id);
      };
      const status = [
        'progress-complete',
        'card-create',
        'community-create',
        'community-reaction',
        'ai-send',
      ].includes(domain)
        ? 201
        : 200;
      await operation(A, key).expect(status);
      expect(
        restoreDigest(
          await rows(
            domain === 'ai-send'
              ? 'chatmessages'
              : domain.startsWith('card')
                ? 'flashcards'
                : domain.startsWith('community')
                  ? 'communityposts'
                  : 'users',
          ),
        ),
      ).not.toBe(
        restoreDigest(
          s0.collections[
            domain === 'ai-send'
              ? 'chatmessages'
              : domain.startsWith('card')
                ? 'flashcards'
                : domain.startsWith('community')
                  ? 'communityposts'
                  : 'users'
          ] ?? [],
        ),
      );
      await drill.restoreB(s0);
      // Equality of epoch/revision values is intentional: only lineage separates them.
      expect((await rows('users'))[0].progressEpoch).toBe(5);
      const before = await Promise.all(RESTORE_COLLECTIONS.map(rows)),
        calls = provider.mock.calls.length;
      const lookup = jest.spyOn(
        model<MutationReceipt>(MutationReceipt.name),
        'findOne',
      );
      await operation(A, key).expect(409);
      expect(lookup).not.toHaveBeenCalled();
      expect(await Promise.all(RESTORE_COLLECTIONS.map(rows))).toEqual(before);
      expect(provider).toHaveBeenCalledTimes(calls);
      await operation(B, randomUUID()).expect(status);
      expect(
        await drill.db
          .db!.collection('mutationreceipts')
          .countDocuments({ operationId: key, dataTimelineId: B }),
      ).toBe(0);
    },
  );

  test.each(repetitions)(
    'MANDATORY clear hazard: physical S0 restore preserves M1/M2 and later B message, repeat %i',
    async () => {
      await drill.send().expect(201);
      const s0 = await drill.snapshot(),
        key = randomUUID();
      await drill.clear(A, key).expect(200);
      expect(await rows('chatmessages')).toHaveLength(0);
      expect(
        await drill.db
          .db!.collection('mutationreceipts')
          .findOne({ operationId: key }),
      ).not.toBeNull();
      expect((await rows('chatbarriers'))[0].revision).toBe(2);
      await drill.restoreB(s0);
      expect(
        await drill.db
          .db!.collection('mutationreceipts')
          .findOne({ operationId: key }),
      ).toBeNull();
      expect((await rows('chatbarriers'))[0].revision).toBe(1);
      await drill.send(B).expect(201);
      const before = await Promise.all(
          ['chatmessages', 'chatbarriers', 'mutationreceipts'].map(rows),
        ),
        calls = provider.mock.calls.length;
      const deletion = jest.spyOn(
        model<ChatMessage>(ChatMessage.name),
        'deleteMany',
      );
      const barrier = jest.spyOn(
        model<ChatBarrier>(ChatBarrier.name),
        'updateOne',
      );
      const receipt = jest.spyOn(
        model<MutationReceipt>(MutationReceipt.name),
        'findOne',
      );
      const tx = jest.spyOn(
        drill.apps[0].get<MutationTimeline>(MutationTimeline),
        'transaction',
      );
      await drill.clear(A, key).expect(409);
      expect(deletion).not.toHaveBeenCalled();
      expect(barrier).not.toHaveBeenCalled();
      expect(receipt).not.toHaveBeenCalled();
      expect(tx).not.toHaveBeenCalled();
      expect(provider).toHaveBeenCalledTimes(calls);
      expect(
        await Promise.all(
          ['chatmessages', 'chatbarriers', 'mutationreceipts'].map(rows),
        ),
      ).toEqual(before);
      expect(before[0]).toHaveLength(4);
    },
  );
  test('historical unsafe fixture demonstrates why lost clear receipts alone are insufficient', async () => {
    await drill.send().expect(201);
    const s0 = await drill.snapshot(),
      key = randomUUID();
    await drill.clear(A, key).expect(200);
    await drill.restoreB(s0);
    await drill.send(B).expect(201);
    // Isolated historical control, deliberately not a runtime route/helper.
    const historical = drill.db.db!.collection('historicalunsafecontrol');
    await historical.insertMany(await rows('chatmessages'));
    expect(await historical.countDocuments()).toBe(4);
    const missing = await drill.db
      .db!.collection('mutationreceipts')
      .findOne({ operationId: key });
    expect(missing).toBeNull();
    // Reproduce the receipt-miss -> destructive delete in a separate synthetic
    // Mongo collection only. The current runtime route remains fenced.
    if (!missing)
      expect(
        (
          await historical.deleteMany({
            userId: new mongo.ObjectId(drill.owner),
            targetLanguage: 'en',
          })
        ).deletedCount,
      ).toBe(4);
    expect(await historical.countDocuments()).toBe(0);
    expect(await rows('chatmessages')).toHaveLength(4);
  });

  test.each([
    'lost-receipt',
    'lost-domain',
    'lost-barrier',
    'barrier-without-clear-receipt',
  ])(
    'read-only audit detects partial recovery %s and never opens/repairs',
    async (mismatch) => {
      await drill.send().expect(201);
      const s0 = await drill.snapshot();
      await drill.clear().expect(200);
      const s1 = await drill.snapshot();
      const expected = ['lost-receipt', 'lost-domain'].includes(mismatch)
        ? s0
        : s1;
      await drill.restoreB(expected, true, false);
      if (
        mismatch === 'lost-receipt' ||
        mismatch === 'barrier-without-clear-receipt'
      ) {
        await drill.db.db!.collection('mutationreceipts').deleteMany({});
      } else if (mismatch === 'lost-domain') {
        await drill.db.db!.collection('chatmessages').deleteMany({});
      } else await drill.db.db!.collection('chatbarriers').deleteMany({});
      const before = await rows('timelinecontrol'),
        commands: string[] = [];
      const record = (event: mongo.CommandStartedEvent) =>
        commands.push(event.commandName);
      drill.db.getClient().on('commandStarted', record);
      const report = await audit(expected.manifest);
      drill.db.getClient().off('commandStarted', record);
      expect(report.reconciliationRequired).toBe(true);
      expect(report.findings).toContain(
        mismatch === 'lost-barrier'
          ? 'AI_BARRIER_MANIFEST_MISMATCH'
          : mismatch === 'lost-domain'
            ? 'DOMAIN_MANIFEST_MISMATCH'
            : 'RECEIPT_MANIFEST_MISMATCH',
      );
      expect(
        commands.some((name) =>
          [
            'insert',
            'update',
            'delete',
            'findAndModify',
            'create',
            'drop',
          ].includes(name),
        ),
      ).toBe(false);
      expect(await rows('timelinecontrol')).toEqual(before);
      await drill.send(B).expect(503);
      expect(report.writesReopened).toBe(false);
    },
  );

  test.each(['mongo-older', 'uploads-older', 'coordinated'])(
    'independent upload/Mongo restore audit: %s',
    async (mode) => {
      await postImage();
      const s0 = await drill.snapshot();
      await postImage();
      const s1 = await drill.snapshot();
      await drill.restoreB(
        mode === 'uploads-older' ? s1 : s0,
        mode !== 'mongo-older',
        false,
      );
      if (mode === 'uploads-older') await drill.restoreUploads(s0.uploads);
      const files = await readdir(join(drill.root, 'community'));
      const report = await audit((mode === 'uploads-older' ? s1 : s0).manifest);
      expect(report.coordinatedSnapshotMatches).toBe(mode === 'coordinated');
      if (mode !== 'coordinated')
        expect(report.findings).toContain(
          mode === 'mongo-older' ? 'ORPHAN_UPLOAD' : 'BROKEN_UPLOAD_REFERENCE',
        );
      expect(await readdir(join(drill.root, 'community'))).toEqual(files);
      expect((await readTimelineControl(drill.db, 5000)).writeState).toBe(
        'CLOSED',
      );
      await drill.send(B).expect(503);
    },
  );

  test('staged upload close compensation removes only the owned file', async () => {
    const images = drill.apps[0].get<CommunityImageStorage>(
        CommunityImageStorage,
      ),
      store = images.store.bind(images) as typeof images.store;
    const unrelated = `${C}.png`;
    await writeFile(join(drill.root, 'community', unrelated), await image());
    const bytes = await readFile(join(drill.root, 'community', unrelated));
    jest.spyOn(images, 'store').mockImplementationOnce(async (file) => {
      const url = await store(file);
      await drill.transition('close');
      return url;
    });
    await drill
      .call('post', '/community/posts')
      .field('learningLanguage', 'en')
      .attach('image', await image(), 'image.png')
      .expect(503);
    expect(await rows('communityposts')).toHaveLength(0);
    expect(await rows('mutationreceipts')).toHaveLength(0);
    expect(await readdir(join(drill.root, 'community'))).toEqual([unrelated]);
    expect(await readFile(join(drill.root, 'community', unrelated))).toEqual(
      bytes,
    );
    await expect(
      images.remove('/uploads/community/../../unrelated'),
    ).rejects.toThrow();
  });
  test('shared upload root is readable by both instances; divergent disk is reconciliation-required', async () => {
    const post = await postImage(),
      s0 = await drill.snapshot();
    await drill.restoreB(s0, true, false);
    for (const app of drill.apps) {
      const images = app.get<CommunityImageStorage>(CommunityImageStorage);
      expect(images.root).toBe(drill.root);
      await images.assertServeable(
        (post.body as { imageUrl: string }).imageUrl,
      );
    }
    const divergent = join(drill.root, 'divergent-instance');
    await mkdir(join(divergent, 'community'), { recursive: true });
    const report = await auditRestoreConsistency(
      drill.db,
      divergent,
      s0.manifest,
      { expectedTimelineId: B, writeMode: 'CLOSED' },
    );
    expect(report.findings).toContain('BROKEN_UPLOAD_REFERENCE');
    expect((await readTimelineControl(drill.db, 5000)).writeState).toBe(
      'CLOSED',
    );
  });
  test.each(['manifest', 'manifest-source', 'index'])(
    'read-only audit rejects incomplete %s evidence',
    async (fault) => {
      const s0 = await drill.snapshot();
      await drill.restoreB(s0, true, false);
      if (fault === 'manifest') s0.manifest.snapshotId = 'unverified';
      else if (fault === 'manifest-source') s0.manifest.sourceTimelineId = C;
      else await drill.db.db!.collection('users').dropIndex('email_1');
      const report = await audit(s0.manifest);
      expect(report.findings).toContain(
        fault === 'manifest'
          ? 'MANIFEST_UNVERIFIED'
          : fault === 'manifest-source'
            ? 'SOURCE_TIMELINE_MISMATCH'
            : 'EXPECTED_INDEX_MISSING',
      );
      expect(report.writesReopened).toBe(false);
      expect((await readTimelineControl(drill.db, 5000)).writeState).toBe(
        'CLOSED',
      );
    },
  );
  test('stale multipart A create is rejected before file allocation after S0 restore', async () => {
    const s0 = await drill.snapshot(),
      key = randomUUID();
    await postImage(key);
    await drill.restoreB(s0);
    const store = jest.spyOn(
      drill.apps[0].get<CommunityImageStorage>(CommunityImageStorage),
      'store',
    );
    await drill
      .call('post', '/community/posts', A, key)
      .field('learningLanguage', 'en')
      .attach('image', await image(), 'image.png')
      .expect(409);
    expect(store).not.toHaveBeenCalled();
    expect(await readdir(join(drill.root, 'community'))).toEqual([]);
  });

  test.each(repetitions)(
    'real snapshot transaction domain/receipt rollback when Mongo close wins before fence, repeat %i',
    async () => {
      const session = await drill.db.startSession({ defaultTimeoutMS: 5000 });
      session.startTransaction({
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
      });
      try {
        await readTimelineControl(drill.db, 5000, session);
        await drill.db
          .db!.collection('drilldomain')
          .insertOne({ operation: 'synthetic-A' }, { session });
        await drill.db
          .db!.collection('drillreceipts')
          .insertOne({ operation: 'synthetic-A' }, { session });
        await drill.transition('close');
        await expect(
          drill.apps[0]
            .get<TimelineWriteGate>(TimelineWriteGate)
            .assertAndTouchWriteFence(session, A),
        ).rejects.toMatchObject({ code: 'FENCE_CONFLICT' });
        expect(session.inTransaction()).toBe(false);
        expect(await rows('drilldomain')).toHaveLength(0);
        expect(await rows('drillreceipts')).toHaveLength(0);
      } finally {
        if (session.inTransaction()) await session.abortTransaction();
        await session.endSession();
      }
    },
  );
  test('actual AI clear aborts after transactional delete when external close begins; Mongo close then completes', async () => {
    await drill.send().expect(201);
    const before = await rows('chatmessages'),
      receipts = await rows('mutationreceipts'),
      barriers = await rows('chatbarriers');
    const messages = model<ChatMessage>(ChatMessage.name),
      original = messages.deleteMany.bind(
        messages,
      ) as typeof messages.deleteMany;
    const started = latch(),
      release = latch();
    jest
      .spyOn(messages, 'deleteMany')
      .mockImplementationOnce(
        (...args: Parameters<typeof messages.deleteMany>) => {
          const query = original(...args),
            exec = query.exec.bind(query) as typeof query.exec;
          jest.spyOn(query, 'exec').mockImplementationOnce(async () => {
            const value = await exec();
            started.resolve();
            await release.promise;
            return value;
          });
          return query;
        },
      );
    const pending = drill.clear().then((response) => response);
    await started.promise;
    for (const config of drill.configs) config.set('DATA_WRITE_MODE', 'CLOSED');
    const close = drill.transition('close');
    release.resolve();
    expect((await pending).status).toBe(503);
    await close;
    expect(await rows('chatmessages')).toEqual(before);
    expect(await rows('mutationreceipts')).toEqual(receipts);
    expect(await rows('chatbarriers')).toEqual(barriers);
  });
  test('provider already in flight may run once, but closing external latch prevents DB commit', async () => {
    const started = latch(),
      release = latch();
    provider.mockImplementationOnce(async () => {
      started.resolve();
      await release.promise;
      return result();
    });
    const pending = drill.send().then((response) => response);
    await started.promise;
    for (const config of drill.configs) config.set('DATA_WRITE_MODE', 'CLOSED');
    const close = drill.transition('close');
    release.resolve();
    expect((await pending).status).toBe(503);
    await close;
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await rows('chatmessages')).toHaveLength(0);
    expect(await rows('mutationreceipts')).toHaveLength(0);
    expect(await rows('chatbarriers')).toHaveLength(0);
  });
  test.each(repetitions)(
    'actual server image preparation crossing physical restore cannot adopt B, repeat %i',
    async () => {
      const s0 = await drill.snapshot(),
        started = latch(),
        release = latch();
      const images = drill.apps[0].get<CommunityImageStorage>(
          CommunityImageStorage,
        ),
        normalize = images.normalize.bind(images) as typeof images.normalize;
      jest.spyOn(images, 'normalize').mockImplementationOnce(async (file) => {
        started.resolve();
        await release.promise;
        return normalize(file);
      });
      const pending = drill
        .call('post', '/community/posts')
        .field('learningLanguage', 'en')
        .attach('image', await image(), 'image.png')
        .then((response) => response);
      await started.promise;
      await drill.restoreB(s0);
      release.resolve();
      expect((await pending).status).toBe(409);
      expect(await rows('communityposts')).toHaveLength(0);
      expect(await rows('mutationreceipts')).toHaveLength(0);
      expect(await readdir(join(drill.root, 'community'))).toEqual([]);
    },
  );

  test.each(repetitions)(
    'two real instances: stale A memory cannot write B and matching B scale-out is stable, repeat %i',
    async () => {
      const s0 = await drill.snapshot();
      await drill.restoreB(s0);
      drill.configs[1].set('DATA_TIMELINE_ID', A); // Already-running process, no reconstructed service.
      expect(
        drill.apps[1].get<ReadinessService>(ReadinessService).snapshot().status,
      ).toBe('ready');
      const freshGate = jest.spyOn(
        drill.apps[1].get<TimelineWriteGate>(TimelineWriteGate),
        'assertWritesPermitted',
      );
      await drill
        .call('patch', '/users/profile', A, randomUUID(), 1)
        .send({ name: 'cached-open-denied' })
        .expect(503);
      expect(freshGate).toHaveBeenCalled();
      await drill.refresh();
      await request(drill.apps[0].getHttpServer())
        .get('/health/ready')
        .expect(200);
      await request(drill.apps[1].getHttpServer())
        .get('/health/ready')
        .expect(503);
      await drill
        .call('patch', '/users/profile', A, randomUUID(), 1)
        .send({ name: 'stale' })
        .expect(503);
      drill.configs[1].set('DATA_TIMELINE_ID', B);
      await drill.refresh();
      for (const instance of [0, 1]) {
        const metadata = await request(drill.apps[instance].getHttpServer())
          .get('/compatibility')
          .expect(200);
        expect(metadata.body).toMatchObject({
          dataTimelineId: B,
          timelineWriteState: 'OPEN',
        });
        await drill
          .call('patch', '/users/profile', B, randomUUID(), instance)
          .send({ name: `instance-${instance}` })
          .expect(200);
      }
      expect((await readTimelineControl(drill.db, 5000)).dataTimelineId).toBe(
        B,
      );
      await drill.transition('close'); // No readiness refresh: cached OPEN cannot authorize.
      for (const instance of [0, 1])
        await drill
          .call('patch', '/users/profile', B, randomUUID(), instance)
          .send({ name: 'closed' })
          .expect(503);
    },
  );

  test.each([
    'missing',
    'duplicate',
    'malformed',
    'invalid-state',
    'unavailable',
  ])(
    'invalid/unavailable control %s fails closed without repair or cached admission',
    async (fault) => {
      const control = drill.db.db!.collection(CONTROL_COLLECTION);
      if (fault === 'missing') await control.deleteMany({});
      if (fault === 'duplicate')
        await control.insertOne(
          { _id: 'other' as unknown as mongo.ObjectId },
          { bypassDocumentValidation: true },
        );
      if (fault === 'malformed' || fault === 'invalid-state')
        await control.updateOne(
          {},
          {
            $set:
              fault === 'malformed'
                ? { dataTimelineId: 'invalid' }
                : { writeState: 'BROKEN' },
          },
          { bypassDocumentValidation: true },
        );
      if (fault === 'unavailable')
        await drill.apps[1].get<Connection>(getConnectionToken()).close();
      const before = await rows('users'),
        controlBefore = await rows(CONTROL_COLLECTION);
      const response = await drill
        .call(
          'patch',
          '/users/profile',
          A,
          randomUUID(),
          fault === 'unavailable' ? 1 : 0,
        )
        .send({ name: 'denied' })
        .expect(503);
      expect((response.body as { code: string }).code).toBe(
        'BACKEND_NOT_READY',
      );
      expect(await rows('users')).toEqual(before);
      expect(await rows(CONTROL_COLLECTION)).toEqual(controlBefore);
      if (fault === 'unavailable')
        await drill.apps[1]
          .get<Connection>(getConnectionToken())
          .openUri(drill.replica.getUri(drill.database), {
            monitorCommands: true,
          });
    },
  );
  test('operator rejects known timeline reuse, restarts retain B, matching timeline cannot bypass ownership', async () => {
    const post = await drill
      .call('post', '/community/posts')
      .send({ text: 'baseline', learningLanguage: 'en' })
      .expect(201);
    const s0 = await drill.snapshot();
    await drill.restoreB(s0);
    await drill.transition('close');
    await expect(drill.transition('install-timeline', A)).rejects.toMatchObject(
      { code: 'TIMELINE_ALREADY_USED' },
    );
    await drill.transition('open');
    const foreign = await drill.apps[0]
      .get<Model<mongo.Document>>(getModelToken('User'))
      .create({
        name: 'Other',
        email: 'other@example.invalid',
        passwordHash: 'fixture',
      });
    const jwt = drill.apps[0]
      .get<JwtService>(JwtService)
      .sign({ sub: String(foreign._id) });
    await drill
      .call(
        'delete',
        `/community/posts/${(post.body as { _id: string })._id}`,
        B,
      )
      .auth(jwt, { type: 'bearer' })
      .set('X-Resource-Revision', '0')
      .expect(403);
    for (let i = 0; i < 3; i++) await drill.refresh();
    expect((await readTimelineControl(drill.db, 5000)).dataTimelineId).toBe(B);
  });
  test('surviving A receipt prevents reuse of old operation ID on B; lost receipt is protected by old A header', async () => {
    const key = randomUUID();
    await drill.send(A, key).expect(201);
    const s0 = await drill.snapshot();
    await drill.restoreB(s0);
    const calls = provider.mock.calls.length;
    await drill.send(B, key).expect(409);
    await drill.send(A, key).expect(409);
    expect(provider).toHaveBeenCalledTimes(calls);
    await drill.send(B, randomUUID()).expect(201);
  });

  test.each(restoreReopeningMatrix)(
    'reopening matrix %s',
    async (
      _name,
      external,
      mode,
      mongoId,
      state,
      protocol,
      client,
      policy,
      expected,
    ) => {
      // Unmarked deployment fixture models transitional legacy behavior, not an
      // operator-installed restored B (which independently requires ENFORCE).
      await drill.db
        .db!.collection(CONTROL_COLLECTION)
        .updateOne(
          {},
          { $set: { dataTimelineId: mongoId, writeState: state } },
        );
      drill.configs[0].set('DATA_TIMELINE_ID', external);
      drill.configs[0].set('DATA_WRITE_MODE', mode);
      drill.configs[0].set('CLIENT_PROTOCOL_POLICY', policy);
      await drill.refresh();
      const before = await rows('users');
      const receipt = jest.spyOn(
        model<MutationReceipt>(MutationReceipt.name),
        'findOne',
      );
      await drill
        .call('delete', '/ai-coach/clear', client, randomUUID(), 0, protocol)
        .query({ targetLanguage: 'en' })
        .expect(expected);
      if (expected !== 200) {
        expect(await rows('users')).toEqual(before);
        expect(receipt).not.toHaveBeenCalled();
        expect(await rows('mutationreceipts')).toHaveLength(0);
        expect(await rows('chatbarriers')).toHaveLength(0);
      }
    },
  );
  test('known restored B refuses ALLOW_LEGACY even with a matching header', async () => {
    const s0 = await drill.snapshot();
    await drill.restoreB(s0);
    drill.configs[0].set('CLIENT_PROTOCOL_POLICY', 'ALLOW_LEGACY');
    await drill
      .call('patch', '/users/profile', B, randomUUID(), 0, '1')
      .send({ name: 'blocked' })
      .expect(503);
  });

  test.each([A, B])(
    'ordinary Nest restart/scale-out preserves timeline %s without allocating restore history',
    async (id) => {
      if (id === B) {
        const s0 = await drill.snapshot();
        await drill.restoreB(s0);
      }
      const before = await readTimelineControl(drill.db, 5000),
        events = await rows('timelinecontrolevents');
      await drill.restart(1);
      expect(await readTimelineControl(drill.db, 5000)).toEqual(before);
      expect(await rows('timelinecontrolevents')).toEqual(events);
      await drill
        .call('patch', '/users/profile', id, randomUUID(), 1)
        .send({ name: 'restarted' })
        .expect(200);
      expect((await readTimelineControl(drill.db, 5000)).dataTimelineId).toBe(
        id,
      );
    },
  );
  test('safe observability records mismatch, closed control, legacy admission and receipt conflict without payloads', async () => {
    const events = jest.spyOn(telemetry, 'emit');
    drill.configs[0].set('CLIENT_PROTOCOL_POLICY', 'ALLOW_LEGACY');
    await drill
      .call('patch', '/users/profile', null, randomUUID(), 0, '1')
      .send({ name: 'legacy' })
      .expect(200);
    drill.configs[0].set('CLIENT_PROTOCOL_POLICY', 'ENFORCE_MUTATIONS');
    const key = randomUUID();
    await drill.send(A, key).expect(201);
    const s0 = await drill.snapshot();
    await drill.restoreB(s0);
    await drill.send(A, key).expect(409);
    await drill.send(B, key).expect(409);
    drill.configs[0].set('DATA_WRITE_MODE', 'CLOSED');
    await drill.send(B).expect(503);
    await expect(
      drill.apps[0]
        .get<MutationTimeline>(MutationTimeline)
        .admit({ 'x-client-protocol': '2', 'x-data-timeline': B }),
    ).rejects.toMatchObject({ status: 503 });
    const names = events.mock.calls.map(([name]) => name);
    for (const name of [
      'legacy_timeline_write_admitted',
      'timeline_request_mismatch',
      'receipt_timeline_conflict',
      'timeline_write_blocked',
    ])
      expect(names).toContain(name);
    const output = JSON.stringify(events.mock.calls);
    expect(output).not.toContain(drill.token);
    expect(output).not.toContain('deterministic');
    expect(output).not.toContain('synthetic@example.invalid');
  });
  test.each([1, 4, 8, 16, 32])(
    'two-instance contention %i: commits are exact and bounded failures leave no effect',
    async (concurrency) => {
      const counters = jest.spyOn(telemetry, 'emit');
      const beforeFence = (await readTimelineControl(drill.db, 5000))
        .fenceVersion;
      const latencies: number[] = [];
      let writeConflicts = 0;
      const conflict = (event: mongo.CommandFailedEvent) => {
        if (
          event.failure instanceof mongo.MongoServerError &&
          event.failure.code === 112
        )
          writeConflicts++;
      };
      for (const app of drill.apps)
        app
          .get<Connection>(getConnectionToken())
          .getClient()
          .on('commandFailed', conflict);
      const outcomes = await Promise.allSettled(
        Array.from({ length: concurrency }, async (_, i) => {
          const started = performance.now(),
            app = drill.apps[i % 2],
            timeline = app.get<MutationTimeline>(MutationTimeline),
            connection = app.get<Connection>(getConnectionToken());
          const scope = await timeline.admit({
            'x-client-protocol': '2',
            'x-data-timeline': A,
          });
          await timeline.transaction(
            'drill-contention',
            async (session) => {
              await connection
                .db!.collection('drillcontention')
                .insertOne(
                  { _id: i as unknown as mongo.ObjectId, timeline: A },
                  { session },
                );
            },
            scope,
          );
          latencies.push(performance.now() - started);
        }),
      );
      latencies.sort((a, b) => a - b);
      const commits = outcomes.filter(
        (item) => item.status === 'fulfilled',
      ).length;
      const conflicts = counters.mock.calls.filter(
        ([event]) => event === 'timeline_fence_conflict',
      ).length;
      const failures = concurrency - commits;
      console.info(
        'RESTORE_CONTENTION ' +
          JSON.stringify({
            concurrency,
            commits,
            retries: conflicts,
            writeConflicts,
            failures,
            p50Ms: Math.round(
              latencies[Math.floor(latencies.length * 0.5)] ?? 0,
            ),
            p95Ms: Math.round(
              latencies[
                Math.min(
                  latencies.length - 1,
                  Math.floor(latencies.length * 0.95),
                )
              ] ?? 0,
            ),
          }),
      );
      for (const app of drill.apps)
        app
          .get<Connection>(getConnectionToken())
          .getClient()
          .off('commandFailed', conflict);
      if (concurrency <= 8) expect(failures).toBe(0);
      for (const [id, outcome] of outcomes.entries()) {
        if (outcome.status === 'rejected') {
          expect((outcome.reason as { getStatus(): number }).getStatus()).toBe(
            503,
          );
          expect(
            await drill.db
              .db!.collection('drillcontention')
              .countDocuments({ _id: id as unknown as mongo.ObjectId }),
          ).toBe(0);
        }
      }
      expect(await rows('drillcontention')).toHaveLength(commits);
      expect((await readTimelineControl(drill.db, 5000)).fenceVersion).toBe(
        beforeFence + commits,
      );
    },
  );
});
