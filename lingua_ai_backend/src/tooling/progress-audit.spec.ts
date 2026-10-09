import { mongo } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, parseArgs } from './progress-audit-cli';
import {
  ProgressAuditTool,
  stateFingerprint,
  UserAudit,
} from './progress-audit';

describe('Legacy progress audit and deterministic repair (disposable replica only)', () => {
  jest.setTimeout(120000);
  let replica: MongoMemoryReplSet;
  let client: mongo.MongoClient;
  let db: mongo.Db;
  let tool: ProgressAuditTool;
  let a: mongo.ObjectId;
  let b: mongo.ObjectId;
  beforeAll(async () => {
    // Never read MONGODB_URI or application configuration to choose the test DB.
    replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = await new mongo.MongoClient(replica.getUri()).connect();
    db = client.db('phase6d_disposable');
    tool = new ProgressAuditTool(client, db);
  });
  beforeEach(async () => {
    jest.restoreAllMocks();
    await db.dropDatabase();
    a = new mongo.ObjectId();
    b = new mongo.ObjectId();
    await tool.users.insertMany([
      {
        _id: a,
        totalXp: 500,
        level: 'Beginner',
        xpPerLanguage: { en: 500 },
        levelPerLanguage: { en: 'Beginner' },
        progressEpoch: 0,
        progressWriteRevision: 3,
        email: 'private@example.com',
        passwordHash: 'PRIVATE_HASH',
      },
      {
        _id: b,
        totalXp: 50,
        level: 'Beginner',
        xpPerLanguage: { de: 50 },
        levelPerLanguage: { de: 'Beginner' },
        progressEpoch: 0,
      },
    ]);
    await tool.lessons.insertMany([
      { id: 'en-one', targetLanguage: 'en', xpReward: 9999 },
      { id: 'de-one', targetLanguage: 'de' },
    ]);
    await tool.progress.insertMany([
      {
        userId: a,
        lessonId: 'en-one',
        targetLanguage: 'en',
        score: 80,
        awardedXp: 500,
        progressEpoch: 0,
        status: 'completed',
        createdAt: new Date(),
      },
      {
        userId: b,
        lessonId: 'de-one',
        targetLanguage: 'de',
        score: 90,
        awardedXp: 50,
        progressEpoch: 0,
        status: 'completed',
        createdAt: new Date(),
      },
    ]);
  });
  afterAll(async () => {
    await client?.close();
    await replica?.stop();
  });
  const audit = async (id = a) =>
    tool.auditUser((await tool.users.findOne({ _id: id }))!);
  const category = (report: UserAudit, key: string) =>
    report.findings.filter((f) => f.category === key);
  const run = async (
    options = { userId: a.toHexString(), limit: 100, batchSize: 1 },
    apply = false,
  ) => {
    const records: any[] = [];
    const result = await tool.run(
      options,
      async (record) => {
        records.push(record);
      },
      apply,
    );
    return { records, result };
  };

  it('CLI defaults to dry-run with bounded execution and validates options before connecting', async () => {
    expect(parseArgs([])).toMatchObject({
      apply: false,
      limit: 100,
      batchSize: 100,
    });
    expect(parseArgs(['--all', '--batch-size', '2'])).toMatchObject({
      apply: false,
      limit: null,
      batchSize: 2,
    });
    for (const args of [
      ['--apply'],
      ['--repair'],
      ['--limit', 'NaN'],
      ['--batch-size', '501'],
      ['--user', 'email@example.com'],
      ['--all', '--limit', '2'],
      ['--rollback', a.toHexString()],
      ['--apply', '--apply'],
    ]) {
      expect(() => parseArgs(args)).toThrow();
    }
    await expect(main(['--apply'])).rejects.toThrow('Apply requires');
    expect(
      parseArgs([
        '--user',
        a.toHexString(),
        '--apply',
        '--output',
        'local-report.jsonl',
      ]).apply,
    ).toBe(true);
  });
  it('default run performs no writes, including receipt creation, and excludes credentials', async () => {
    const before = await tool.users.find().toArray();
    const write = jest.spyOn(tool.users, 'updateOne');
    const { records } = await run();
    expect(write).not.toHaveBeenCalled();
    expect(await tool.users.find().toArray()).toEqual(before);
    expect(await tool.receipts.countDocuments()).toBe(0);
    expect(JSON.stringify(records)).not.toMatch(
      /private@example|PRIVATE_HASH|passwordHash|email/,
    );
    expect(records.at(-1)).toMatchObject({ mode: 'dry-run', users: 1 });
  });
  it('both repair primitives refuse mutation without explicit apply', async () => {
    await expect(tool.apply(await audit(), { apply: false })).rejects.toThrow(
      'explicit --apply',
    );
    await expect(
      tool.rollback(new mongo.ObjectId().toHexString(), { apply: false }),
    ).rejects.toThrow('explicit --apply');
    expect(await tool.receipts.countDocuments()).toBe(0);
  });
  it('detects global and canonical language level drift deterministically', async () => {
    const report = await audit();
    expect(report.derivedGlobalLevel).toBe('Pre-Intermediate');
    expect(category(report, 'GLOBAL_LEVEL_DRIFT')[0].classification).toBe(
      'DETERMINISTIC_REPAIR',
    );
    expect(category(report, 'LANGUAGE_LEVEL_DRIFT')[0].classification).toBe(
      'DETERMINISTIC_REPAIR',
    );
    expect(report.deterministicRepairs.map((f) => f.path)).toEqual([
      'level',
      'levelPerLanguage.en',
    ]);
  });
  it('missing historical award is ambiguous and never inferred from current lesson rewards', async () => {
    await tool.progress.updateOne({ userId: a }, { $unset: { awardedXp: '' } });
    const report = await audit();
    expect(category(report, 'MISSING_AWARDED_XP')[0].classification).toBe(
      'AMBIGUOUS_REVIEW',
    );
    expect(report).toMatchObject({
      withoutAwardProvenance: 1,
      withAwardProvenance: 0,
      knownAwardedXp: 0,
      aggregateReconstructable: false,
    });
    await tool.apply(report, { apply: true });
    expect((await tool.progress.findOne({ userId: a }))!).not.toHaveProperty(
      'awardedXp',
    );
    expect((await tool.users.findOne({ _id: a }))!.totalXp).toBe(500);
  });
  it('reports partial-known total and ambiguous aggregate/language mismatch separately', async () => {
    await tool.progress.insertOne({
      userId: a,
      lessonId: 'unknown-old',
      score: 70,
      targetLanguage: 'en',
      progressEpoch: 0,
      status: 'completed',
    });
    await tool.users.updateOne(
      { _id: a },
      { $set: { totalXp: 750, 'xpPerLanguage.en': 750 } },
    );
    const report = await audit();
    expect(report).toMatchObject({
      knownAwardedXp: 500,
      aggregateReconstructable: false,
      completionCount: 2,
    });
    expect(category(report, 'PARTIAL_AWARD_PROVENANCE')[0].classification).toBe(
      'AMBIGUOUS_REVIEW',
    );
    expect(
      category(report, 'TOTAL_XP_MISMATCH')[0].evidence.completeRowEvidence,
    ).toBe(false);
    expect(
      category(report, 'LANGUAGE_XP_MISMATCH')[0].evidence.completeRowEvidence,
    ).toBe(false);
  });
  it('detects exact row aggregate mismatch without offering automatic XP repair', async () => {
    await tool.users.updateOne(
      { _id: a },
      { $set: { totalXp: 700, 'xpPerLanguage.en': 600 } },
    );
    const report = await audit();
    expect(report).toMatchObject({
      knownAwardedXp: 500,
      aggregateReconstructable: true,
      languageReconstructable: true,
    });
    expect(
      category(report, 'TOTAL_XP_MISMATCH')[0].evidence.completeRowEvidence,
    ).toBe(true);
    expect(category(report, 'LANGUAGE_XP_MISMATCH')[0].evidence).toMatchObject({
      effectiveXp: 600,
      knownAwardedXp: 500,
    });
    expect(
      report.deterministicRepairs.every(
        (f) => f.path === 'level' || f.path.startsWith('levelPerLanguage.'),
      ),
    ).toBe(true);
  });
  it.each([-1, 1.25, NaN, Infinity, '500', null, Number.MAX_SAFE_INTEGER + 1])(
    'invalid awarded XP %s remains untouched',
    async (awardedXp) => {
      await tool.progress.updateOne({ userId: a }, { $set: { awardedXp } });
      const report = await audit();
      expect(category(report, 'INVALID_AWARDED_XP')[0].classification).toBe(
        'AMBIGUOUS_REVIEW',
      );
      expect(report.aggregateReconstructable).toBe(false);
      expect(report.knownAwardedXp).toBe(0);
      await tool.apply(report, { apply: true });
      expect((await tool.progress.findOne({ userId: a }))!.awardedXp).toEqual(
        awardedXp,
      );
    },
  );
  it('mixed canonical/English/Turkish buckets use runtime additive reads without consolidation', async () => {
    await tool.users.updateOne(
      { _id: a },
      {
        $set: {
          xpPerLanguage: { en: 200, English: 100, İngilizce: 200 },
          levelPerLanguage: { en: 'Beginner', English: 'Beginner' },
        },
      },
    );
    const report = await audit();
    expect(report.languages.en.effectiveXp).toBe(500);
    expect(category(report, 'MIXED_LANGUAGE_BUCKETS')[0].classification).toBe(
      'AMBIGUOUS_REVIEW',
    );
    expect(category(report, 'LANGUAGE_BUCKET_ALIAS')).toHaveLength(2);
    expect(report.deterministicRepairs.map((f) => f.path)).toEqual(['level']);
    await tool.apply(report, { apply: true });
    const saved = (await tool.users.findOne({ _id: a }))!;
    expect(saved.xpPerLanguage).toEqual({
      en: 200,
      English: 100,
      İngilizce: 200,
    });
    expect(saved.levelPerLanguage).toEqual({
      en: 'Beginner',
      English: 'Beginner',
    });
  });
  it('one known alias is safe compatibility; canonical derived level does not alter its bucket', async () => {
    await tool.users.updateOne(
      { _id: a },
      { $set: { xpPerLanguage: { English: 500 }, levelPerLanguage: {} } },
    );
    const report = await audit();
    expect(category(report, 'LANGUAGE_BUCKET_ALIAS')[0].classification).toBe(
      'SAFE_COMPATIBILITY',
    );
    await tool.apply(report, { apply: true });
    expect((await tool.users.findOne({ _id: a }))!.xpPerLanguage).toEqual({
      English: 500,
    });
    expect((await tool.users.findOne({ _id: a }))!.levelPerLanguage).toEqual({
      en: 'Pre-Intermediate',
    });
  });
  it('orphan and malformed owners are dangerous, never reassigned or looked up by email', async () => {
    const orphan = new mongo.ObjectId();
    await tool.progress.insertMany([
      { userId: orphan, lessonId: 'en-one', awardedXp: 50 },
      { userId: 'private@example.com', lessonId: 'en-one', awardedXp: 50 },
      {
        userId: a.toHexString(),
        lessonId: 'legacy-string-owner',
        awardedXp: 50,
      },
    ]);
    const { records, result } = await run(
      { limit: null, batchSize: 1 } as any,
      true,
    );
    expect(result.dangerousRows).toBe(3);
    expect(
      records
        .filter((r) => r.type === 'ownership')
        .every((r) => r.classification === 'DANGEROUS_OWNERSHIP'),
    ).toBe(true);
    expect((await tool.progress.findOne({ userId: orphan }))!.userId).toEqual(
      orphan,
    );
    expect((await tool.users.findOne({ _id: a }))!.level).toBe('Beginner');
    expect(await tool.receipts.countDocuments()).toBe(0);
  });
  it('unknown/legacy lesson IDs, invalid language, score and status are distinct findings, never remapped', async () => {
    await tool.progress.updateOne(
      { userId: a },
      {
        $set: {
          lessonId: '123-old',
          score: '80',
          status: 'started',
          targetLanguage: 'Klingon',
        },
      },
    );
    const report = await audit();
    for (const key of [
      'UNKNOWN_LESSON_ID',
      'INVALID_SCORE',
      'NON_COMPLETED_STATUS',
      'INVALID_COMPLETION_LANGUAGE',
    ]) {
      expect(category(report, key)[0].classification).toBe('AMBIGUOUS_REVIEW');
    }
    expect(
      category(report, 'NON_COMPLETED_STATUS')[0].evidence
        .currentReadIncludesRow,
    ).toBe(true);
    await tool.apply(report, { apply: true });
    expect((await tool.progress.findOne({ userId: a }))!).toMatchObject({
      lessonId: '123-old',
      score: '80',
      status: 'started',
      targetLanguage: 'Klingon',
    });
  });
  it('duplicate rows disqualify exact reconstruction without deleting evidence', async () => {
    await tool.progress.insertOne({
      userId: a,
      lessonId: 'en-one',
      awardedXp: 500,
      targetLanguage: 'en',
      score: 80,
      status: 'completed',
      progressEpoch: 0,
    });
    const report = await audit();
    expect(category(report, 'DUPLICATE_COMPLETION')[0].evidence).toEqual({
      lessonId: 'en-one',
      count: 2,
    });
    expect(report.aggregateReconstructable).toBe(false);
    await tool.apply(report, { apply: true });
    expect(await tool.progress.countDocuments({ userId: a })).toBe(2);
  });
  it('missing legacy epoch defaults to zero, while stale/future/invalid row epochs are distinct evidence', async () => {
    await tool.users.updateOne({ _id: a }, { $unset: { progressEpoch: '' } });
    await tool.progress.updateOne(
      { userId: a },
      { $unset: { progressEpoch: '' } },
    );
    const legacy = await audit();
    expect(legacy.progressEpoch).toBe(0);
    expect(category(legacy, 'MISSING_OWNER_EPOCH')[0].classification).toBe(
      'SAFE_COMPATIBILITY',
    );
    expect(category(legacy, 'MISSING_ROW_EPOCH')[0].classification).toBe(
      'SAFE_COMPATIBILITY',
    );
    expect(legacy.aggregateReconstructable).toBe(true);
    await tool.users.updateOne({ _id: a }, { $set: { progressEpoch: 2 } });
    for (const rowEpoch of [undefined, 1, 3, -1, 1.2]) {
      await tool.progress.updateOne(
        { userId: a },
        rowEpoch === undefined
          ? { $unset: { progressEpoch: '' } }
          : { $set: { progressEpoch: rowEpoch } },
      );
      const report = await audit();
      expect(category(report, 'ROW_EPOCH_MISMATCH')).toHaveLength(1);
      expect(report.aggregateReconstructable).toBe(false);
    }
  });
  it('apply changes only canonical derived fields, records exact before/after and preserves epochs/XP/rows', async () => {
    const before = (await tool.users.findOne({ _id: a }))!;
    const rowsBefore = await tool.progress.find().toArray();
    const receipt = (await tool.apply(await audit(), { apply: true }))!;
    const saved = (await tool.users.findOne({ _id: a }))!;
    expect(saved).toEqual({
      ...before,
      level: 'Pre-Intermediate',
      levelPerLanguage: { en: 'Pre-Intermediate' },
    });
    expect(await tool.progress.find().toArray()).toEqual(rowsBefore);
    expect(receipt).toMatchObject({
      userId: a,
      progressEpoch: 0,
      progressWriteRevision: 3,
      beforeFingerprint: stateFingerprint(before),
      afterFingerprint: stateFingerprint(saved),
      status: 'applied',
    });
    expect(receipt.fields).toEqual([
      {
        path: 'level',
        beforeExists: true,
        before: 'Beginner',
        after: 'Pre-Intermediate',
      },
      {
        path: 'levelPerLanguage.en',
        beforeExists: true,
        before: 'Beginner',
        after: 'Pre-Intermediate',
      },
    ]);
    expect(await tool.receipts.findOne({ _id: receipt._id })).toEqual(receipt);
    expect(JSON.stringify(receipt)).not.toMatch(
      /PRIVATE_HASH|private@example|passwordHash/,
    );
  });
  it('apply recomputes proposals inside transaction rather than trusting caller-supplied mutations', async () => {
    const report = await audit();
    report.deterministicRepairs.push({
      path: 'totalXp',
      beforeExists: true,
      before: 500,
      after: '99999',
    });
    await tool.apply(report, { apply: true });
    expect((await tool.users.findOne({ _id: a }))!.totalXp).toBe(500);
  });
  it('rechecks state and refuses stale repair after a reset or any other user edit', async () => {
    const report = await audit();
    await tool.users.updateOne(
      { _id: a },
      { $set: { progressEpoch: 1, totalXp: 0, level: 'Beginner' } },
    );
    await expect(tool.apply(report, { apply: true })).rejects.toThrow(
      'State changed since audit',
    );
    expect(await tool.receipts.countDocuments()).toBe(0);
    const refreshed = await audit();
    await tool.users.updateOne(
      { _id: a },
      { $set: { name: 'Changed profile' } },
    );
    await expect(tool.apply(refreshed, { apply: true })).rejects.toThrow(
      'State changed since audit',
    );
  });
  it('real concurrent write during transaction causes retry and stale-repair refusal', async () => {
    const report = await audit();
    const original = tool.users.updateOne.bind(tool.users);
    jest.spyOn(tool.users, 'updateOne').mockImplementationOnce((async (
      ...args: any[]
    ) => {
      await original(
        { _id: a },
        { $inc: { totalXp: 1, progressWriteRevision: 1 } },
      );
      return (original as any)(...args);
    }) as any);
    await expect(tool.apply(report, { apply: true })).rejects.toThrow(
      'State changed since audit',
    );
    expect((await tool.users.findOne({ _id: a }))!).toMatchObject({
      totalXp: 501,
      level: 'Beginner',
      progressWriteRevision: 4,
    });
    expect(await tool.receipts.countDocuments()).toBe(0);
  });
  it('receipt write failure rolls back derived changes atomically', async () => {
    const before = (await tool.users.findOne({ _id: a }))!;
    jest
      .spyOn(tool.receipts, 'insertOne')
      .mockRejectedValueOnce(new Error('Receipt unavailable'));
    await expect(tool.apply(await audit(), { apply: true })).rejects.toThrow(
      'Receipt unavailable',
    );
    expect(await tool.users.findOne({ _id: a })).toEqual(before);
  });
  it('rollback restores exactly only recorded fields, and refuses any changed owner state', async () => {
    const before = (await tool.users.findOne({ _id: a }))!;
    const receipt = (await tool.apply(await audit(), { apply: true }))!;
    await tool.rollback(receipt._id.toHexString(), { apply: true });
    expect(await tool.users.findOne({ _id: a })).toEqual(before);
    expect((await tool.receipts.findOne({ _id: receipt._id }))!.status).toBe(
      'rolled-back',
    );
    const next = (await tool.apply(await audit(), { apply: true }))!;
    await tool.users.updateOne({ _id: a }, { $inc: { totalXp: 1 } });
    await expect(
      tool.rollback(next._id.toHexString(), { apply: true }),
    ).rejects.toThrow('State changed since repair');
    expect((await tool.users.findOne({ _id: a }))!.totalXp).toBe(501);
  });
  it('rollback restores missing fields and a missing parent map without fabricating historical state', async () => {
    await tool.users.updateOne(
      { _id: a },
      { $unset: { level: '', levelPerLanguage: '' } },
    );
    const before = (await tool.users.findOne({ _id: a }))!;
    const receipt = (await tool.apply(await audit(), { apply: true }))!;
    expect(receipt.fields.every((f: any) => f.beforeExists === false)).toBe(
      true,
    );
    await tool.rollback(receipt._id.toHexString(), { apply: true });
    expect(await tool.users.findOne({ _id: a })).toEqual(before);
  });
  it('batching, limits and pagination preserve owner boundaries', async () => {
    const sorted = [a, b].sort((x, y) =>
      x.toHexString().localeCompare(y.toHexString()),
    );
    const first = await run({ limit: 1, batchSize: 1 } as any);
    expect(
      first.records.filter((r) => r.type === 'user').map((r) => r.userId),
    ).toEqual([sorted[0].toHexString()]);
    const second = await run({
      after: sorted[0].toHexString(),
      limit: 1,
      batchSize: 1,
    } as any);
    expect(
      second.records.filter((r) => r.type === 'user').map((r) => r.userId),
    ).toEqual([sorted[1].toHexString()]);
    await run({ userId: a.toHexString(), limit: 1, batchSize: 1 }, true);
    expect((await tool.users.findOne({ _id: b }))!).toMatchObject({
      totalXp: 50,
      level: 'Beginner',
      levelPerLanguage: { de: 'Beginner' },
    });
    expect((await tool.progress.findOne({ userId: b }))!.awardedXp).toBe(50);
  });
  it('one user failure does not cross owners or expose raw driver errors', async () => {
    jest
      .spyOn(tool, 'auditUser')
      .mockRejectedValueOnce(new Error('mongodb://SECRET@HOST PRIVATE_HASH'));
    const { records, result } = await run({ limit: null, batchSize: 1 } as any);
    expect(result).toMatchObject({ users: 2, failedUsers: 1 });
    expect(records.filter((r) => r.type === 'user')).toHaveLength(1);
    expect(JSON.stringify(records)).not.toMatch(/SECRET|HOST|PRIVATE_HASH/);
  });
  it('finding samples are capped while counters retain all evidence categories', async () => {
    await tool.progress.insertMany(
      Array.from({ length: 210 }, (_, i) => ({
        userId: a,
        lessonId: `old-${i}`,
      })),
    );
    const report = await audit();
    expect(report.findings).toHaveLength(200);
    expect(report.omittedFindings).toBeGreaterThan(0);
    expect(report.findingCounts.MISSING_AWARDED_XP).toBe(210);
    expect(report.withoutAwardProvenance).toBe(210);
  });
  it('CLI produces dry-run JSONL using only an explicitly supplied disposable URI', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phase6d-audit-'));
    const output = join(directory, 'report.jsonl');
    const previousUri = process.env.MONGODB_URI;
    process.env.MONGODB_URI = replica.getUri('phase6d_disposable');
    try {
      const before = (await tool.users.findOne({ _id: a }))!;
      await main([
        '--user',
        a.toHexString(),
        '--output',
        output,
        '--batch-size',
        '1',
      ]);
      const records = (await readFile(output, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => mongo.BSON.EJSON.parse(line));
      expect(records[0]).toMatchObject({ type: 'header', mode: 'dry-run' });
      expect(records.at(-1)).toMatchObject({
        type: 'summary',
        users: 1,
        mode: 'dry-run',
      });
      expect(await tool.users.findOne({ _id: a })).toEqual(before);
      expect(await tool.receipts.countDocuments()).toBe(0);
      expect(await readFile(output, 'utf8')).not.toMatch(
        /PRIVATE_HASH|private@example/,
      );
      const connect = jest.spyOn(mongo.MongoClient.prototype, 'connect');
      await expect(main(['--output', output])).rejects.toThrow();
      expect(connect).not.toHaveBeenCalled();
    } finally {
      if (previousUri === undefined) delete process.env.MONGODB_URI;
      else process.env.MONGODB_URI = previousUri;
      await unlink(output);
      await rmdir(directory);
    }
  });
  it('CLI apply and rollback require explicit flags and preserve durable EJSON before/after evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phase6d-apply-'));
    const output = join(directory, 'apply.jsonl'),
      rollbackOutput = join(directory, 'rollback.jsonl');
    const previousUri = process.env.MONGODB_URI;
    process.env.MONGODB_URI = replica.getUri('phase6d_disposable');
    try {
      const before = (await tool.users.findOne({ _id: a }))!;
      await main(['--user', a.toHexString(), '--apply', '--output', output]);
      const records = (await readFile(output, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => mongo.BSON.EJSON.parse(line));
      const receipt = records.find((r) => r.type === 'repair');
      expect(receipt).toBeDefined();
      expect(receipt.fields).toHaveLength(2);
      expect(receipt.appliedAt).toBeInstanceOf(Date);
      expect(receipt.userId).toEqual(a);
      await main([
        '--rollback',
        receipt._id.toHexString(),
        '--apply',
        '--output',
        rollbackOutput,
      ]);
      expect(await tool.users.findOne({ _id: a })).toEqual(before);
      expect(
        JSON.parse(
          (await readFile(rollbackOutput, 'utf8')).trim().split('\n').at(-1)!,
        ),
      ).toMatchObject({ type: 'rollback', userId: a.toHexString() });
    } finally {
      if (previousUri === undefined) delete process.env.MONGODB_URI;
      else process.env.MONGODB_URI = previousUri;
      for (const path of [output, rollbackOutput])
        await unlink(path).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      await rmdir(directory);
    }
  });
  it('invalid XP maps are unavailable, not invented zero values or repair candidates', async () => {
    await tool.users.updateOne(
      { _id: a },
      {
        $set: {
          totalXp: -1,
          xpPerLanguage: ['invalid'],
          levelPerLanguage: { en: 'Advanced' },
        },
      },
    );
    const report = await audit();
    expect(report.derivedGlobalLevel).toBeNull();
    expect(report.languages.en.effectiveXp).toBeNull();
    expect(report.deterministicRepairs).toEqual([]);
    expect(
      category(report, 'LANGUAGE_XP_MISMATCH')[0].evidence.effectiveXp,
    ).toBeNull();
  });
  it('malformed raw user IDs and invalid epochs disable all repair proposals', async () => {
    await tool.users.insertOne({
      _id: 'legacy-owner',
      totalXp: 500,
      level: 'Beginner',
    } as any);
    const legacy = await tool.auditUser(
      (await tool.users.findOne({ _id: 'legacy-owner' } as any))!,
    );
    expect(category(legacy, 'MALFORMED_USER_ID')[0].classification).toBe(
      'DANGEROUS_OWNERSHIP',
    );
    expect(legacy.deterministicRepairs).toEqual([]);
    await tool.users.updateOne({ _id: a }, { $set: { progressEpoch: -1 } });
    const invalid = await audit();
    expect(category(invalid, 'INVALID_OWNER_EPOCH')).toHaveLength(1);
    expect(invalid.deterministicRepairs).toEqual([]);
  });
  it('orphan reporting keeps separate missing-award/language/score/status/lesson/epoch findings', async () => {
    const orphan = new mongo.ObjectId();
    await tool.progress.insertMany([
      { userId: orphan, lessonId: 'retired-lesson', progressEpoch: -1 },
      { userId: orphan, lessonId: 'retired-lesson', progressEpoch: -1 },
    ]);
    const { records } = await run({ limit: null, batchSize: 1 } as any);
    const rows = records.filter((r) => r.type === 'ownership');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      category: 'ORPHAN_OWNER',
      classification: 'DANGEROUS_OWNERSHIP',
      provenance: { awardedXpPresent: false, progressEpoch: -1 },
    });
    expect(rows[0].findings.map((f: any) => f.category)).toEqual(
      expect.arrayContaining([
        'MISSING_AWARDED_XP',
        'INVALID_COMPLETION_LANGUAGE',
        'INVALID_SCORE',
        'NON_COMPLETED_STATUS',
        'UNKNOWN_LESSON_ID',
        'INVALID_ROW_EPOCH',
        'DUPLICATE_COMPLETION',
      ]),
    );
    expect(await tool.progress.countDocuments({ userId: orphan })).toBe(2);
  });
});
