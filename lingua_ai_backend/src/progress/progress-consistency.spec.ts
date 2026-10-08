import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ProgressModule } from './progress.module';
import { ProgressService } from './progress.service';
import { Progress } from './schemas/progress.schema';
import { User } from '../users/schemas/user.schema';
import { Lesson } from '../lessons/schemas/lesson.schema';
import { serializeUser } from '../users/user-response';

describe('Completion and XP consistency (real disposable transactions)', () => {
  jest.setTimeout(120000);
  let replica: MongoMemoryReplSet;
  let module: TestingModule;
  let service: ProgressService;
  let users: Model<User>;
  let lessons: Model<Lesson>;
  let progress: Model<Progress>;
  let user: User;
  beforeAll(async () => {
    replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    module = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(replica.getUri()), ProgressModule],
    }).compile();
    await module.init();
    service = module.get(ProgressService);
    users = module.get(getModelToken(User.name));
    lessons = module.get(getModelToken(Lesson.name));
    progress = module.get(getModelToken(Progress.name));
    await Promise.all([users.init(), lessons.init(), progress.init()]);
  });
  beforeEach(async () => {
    jest.restoreAllMocks();
    await Promise.all([users.deleteMany({}), lessons.deleteMany({}), progress.deleteMany({})]);
    user = await users.create({ name: 'A', email: 'a@example.com', passwordHash: 'fixture' });
    await lessons.create(['one', 'two', 'german'].map((id, i) => ({
      id, targetLanguage: id === 'german' ? 'de' : 'English', title: id,
      description: 'fixture', category: 'Grammar', difficulty: 'Easy', level: 'Beginner',
      order: i, duration: 5, xpReward: id === 'two' ? 80 : 50,
    })));
  });
  afterAll(async () => { await module?.close(); await replica?.stop(); });
  const complete = (lesson = 'one', score = 73) => service.completeLesson(user._id.toString(), lesson, score, 0);

  it('preserves 73, awards first completion once, and safely retries a lost response', async () => {
    expect((await complete())?.data.xpEarned).toBe(50);
    expect((await complete())?.data.xpEarned).toBe(0);
    expect((await progress.findOne({ lessonId: 'one' }))?.score).toBe(73);
    expect(await progress.countDocuments()).toBe(1);
    expect((await users.findById(user._id))?.totalXp).toBe(50);
  });
  it('higher score improves without XP; lower retry cannot reduce score', async () => {
    await complete(); await complete('one', 91); await complete('one', 20);
    expect((await progress.findOne({ lessonId: 'one' }))?.score).toBe(91);
    expect((await progress.findOne({ lessonId: 'one' }))?.awardedXp).toBe(50);
    expect((await users.findById(user._id))?.totalXp).toBe(50);
  });
  it('XP write failure rolls back the completion; retry can award XP', async () => {
    jest.spyOn(users, 'findOneAndUpdate').mockImplementationOnce(() => { throw new Error('XP save failed'); });
    await expect(complete()).rejects.toThrow('XP save failed');
    expect(await progress.countDocuments()).toBe(0);
    expect((await users.findById(user._id))?.totalXp).toBe(0);
    await complete(); expect((await users.findById(user._id))?.totalXp).toBe(50);
  });
  it('level write failure also rolls back completion and XP', async () => {
    jest.spyOn(users, 'updateOne').mockImplementationOnce(() => { throw new Error('level write failed'); });
    await expect(complete()).rejects.toThrow('level write failed');
    expect(await progress.countDocuments()).toBe(0);
    expect((await users.findById(user._id))?.totalXp).toBe(0);
  });
  it('deterministically overlapping different lessons retain both XP awards', async () => {
    // Both insertions reach the XP boundary before either is allowed to award.
    const create = progress.create.bind(progress);
    let arrivals = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    jest.spyOn(progress, 'create').mockImplementation((async (...args: any[]) => {
      const result = await (create as any)(...args);
      if (++arrivals <= 2) { if (arrivals === 2) release(); await gate; }
      return result;
    }) as any);
    await Promise.all([complete('one'), complete('two')]);
    const saved = (await users.findById(user._id))!;
    expect(saved.totalXp).toBe(130); expect(saved.xpPerLanguage.get('en')).toBe(130);
    expect(saved.level).toBe('Beginner'); expect(saved.levelPerLanguage.get('en')).toBe('Beginner');
    expect((await progress.find()).map(row => row.awardedXp).sort()).toEqual([50, 80]);
    expect(await progress.countDocuments()).toBe(2);
  });
  it('concurrent same-lesson attempts award exactly once', async () => {
    await Promise.all(Array.from({ length: 6 }, () => complete()));
    expect(await progress.countDocuments()).toBe(1);
    expect((await users.findById(user._id))?.totalXp).toBe(50);
  });
  it('different languages and users keep independent aggregates and unchanged thresholds', async () => {
    await Promise.all([complete('one'), complete('german')]);
    const b = await users.create({ name: 'B', email: 'b@example.com', passwordHash: 'fixture' });
    await service.completeLesson(b._id.toString(), 'one', 20, 0);
    const saved = (await users.findById(user._id))!;
    expect(saved.totalXp).toBe(100);
    expect(saved.xpPerLanguage.get('en')).toBe(50); expect(saved.xpPerLanguage.get('de')).toBe(50);
    expect((await service.getUserProgress(b._id.toString(), 'English')).stats.totalXp).toBe(50);
    await lessons.updateOne({ id: 'two' }, { $set: { xpReward: 150 } });
    await complete('two'); expect((await users.findById(user._id))?.levelPerLanguage.get('en')).toBe('Elementary');
  });
  it('reset rolls back on failure and atomically clears completions and all XP on success', async () => {
    await complete();
    jest.spyOn(users, 'updateOne').mockImplementationOnce(() => { throw new Error('reset failed'); });
    await expect(service.resetProgress(user._id.toString(), 0, 'reset-test')).rejects.toThrow('reset failed');
    expect(await progress.countDocuments()).toBe(1); expect((await users.findById(user._id))?.totalXp).toBe(50);
    await service.resetProgress(user._id.toString(), 0, 'reset-test');
    expect(await progress.countDocuments()).toBe(0); expect((await users.findById(user._id))?.totalXp).toBe(0);
  });
  it('GET reads XP and completion IDs from the same snapshot during a concurrent award', async () => {
    const find = progress.find.bind(progress);
    let started!: () => void;
    let release!: () => void;
    const reached = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    jest.spyOn(progress, 'find').mockImplementationOnce(((...args: any[]) => {
      const query = (find as any)(...args);
      const exec = query.exec.bind(query);
      query.exec = async () => { started(); await gate; return exec(); };
      return query;
    }) as any);
    const reading = service.getUserProgress(user._id.toString(), 'English');
    await reached; await complete(); release();
    const snapshot = await reading;
    expect(snapshot.stats.totalXp).toBe(0); expect(snapshot.completedLessons).toHaveLength(0);
    const current = await service.getUserProgress(user._id.toString(), 'English');
    expect(current.stats.totalXp).toBe(50); expect(current.completedLessons).toHaveLength(1);
  });

  it('6B: an award atomically derives global and language levels from their own XP and stores provenance', async () => {
    await users.updateOne({ _id: user._id }, { $set: {
      totalXp: 900, level: 'Advanced', xpPerLanguage: { en: 170, de: 730 },
      levelPerLanguage: { en: 'Advanced', de: 'Pre-Intermediate' },
    } });
    await complete();
    const saved = (await users.findById(user._id))!;
    expect(saved.totalXp).toBe(950); expect(saved.level).toBe('Intermediate');
    expect(saved.xpPerLanguage.get('en')).toBe(220);
    expect(saved.levelPerLanguage.get('en')).toBe('Elementary');
    expect(saved.xpPerLanguage.get('de')).toBe(730);
    const row = (await progress.findOne({ lessonId: 'one' }))!;
    expect(row.toObject()).toMatchObject({ awardedXp: 50, targetLanguage: 'en', progressEpoch: 0 });
    expect((await complete('one', 91))?.data).toMatchObject({ targetLanguage: 'en', score: 91, xpEarned: 0 });
    expect((await service.getUserProgress(user._id.toString())).level).toBe('Intermediate');
    expect((await service.getUserProgress(user._id.toString(), 'en')).level).toBe('Elementary');
    await lessons.updateOne({ id: 'one' }, { $set: { xpReward: 999 } });
    await complete('one', 95);
    expect((await progress.findOne({ lessonId: 'one' }))?.awardedXp).toBe(50);
    expect((await users.findById(user._id))?.totalXp).toBe(950);
  });
  it.each([-1, 1.5, NaN, Infinity, '50', Number.MAX_SAFE_INTEGER + 1])(
    '6B: malformed authoritative lesson reward %s cannot persist an award', async xpReward => {
      // Bypass model validation to exercise corrupt historical lesson data.
      await lessons.collection.updateOne({ id: 'one' }, { $set: { xpReward } });
      await expect(complete()).rejects.toMatchObject({ status: 500 });
      expect(await progress.countDocuments()).toBe(0);
      const saved = (await users.findById(user._id))!;
      expect(saved.totalXp).toBe(0); expect(saved.xpPerLanguage.size).toBe(0);
      expect(saved.progressWriteRevision).toBe(0);
    },
  );
  it('6B: aggregate overflow or invalid language XP rolls back without creating a completion', async () => {
    await users.updateOne({ _id: user._id }, { $set: { totalXp: Number.MAX_SAFE_INTEGER } });
    await expect(complete()).rejects.toMatchObject({ status: 500 });
    expect(await progress.countDocuments()).toBe(0);
    await users.updateOne({ _id: user._id }, { $set: { totalXp: 0, xpPerLanguage: { en: -1 } } });
    await expect(complete()).rejects.toMatchObject({ status: 500 });
    expect(await progress.countDocuments()).toBe(0);
    expect((await users.findById(user._id))?.totalXp).toBe(0);
  });
  it.each([-1, 1.5, NaN, Infinity])('6B: invalid existing aggregate %s is rejected rather than propagated', async totalXp => {
    await users.collection.updateOne({ _id: user._id }, { $set: { totalXp } });
    await expect(complete()).rejects.toMatchObject({ status: 500 });
    expect(await progress.countDocuments()).toBe(0);
    expect((await users.findById(user._id))?.xpPerLanguage.size).toBe(0);
  });
  it('6B: a zero reward is valid and does not fabricate XP', async () => {
    await lessons.updateOne({ id: 'one' }, { $set: { xpReward: 0 } });
    await users.updateOne({ _id: user._id }, { $set: { level: 'Advanced' } });
    expect((await complete())?.data.xpEarned).toBe(0);
    expect((await progress.findOne())?.awardedXp).toBe(0);
    const saved = (await users.findById(user._id))!;
    expect(saved.totalXp).toBe(0); expect(saved.level).toBe('Beginner');
    expect(saved.levelPerLanguage.get('en')).toBe('Beginner');
  });
  it('6B: historical rows remain readable without invented awards; derived reads never repair stored levels', async () => {
    await users.updateOne({ _id: user._id }, { $set: {
      totalXp: 500, level: 'Advanced', xpPerLanguage: { English: 200 }, levelPerLanguage: { English: 'Advanced' },
    } });
    await progress.collection.insertOne({ userId: user._id, lessonId: 'one', score: 60, status: 'completed' } as any);
    const snapshot = await service.getUserProgress(user._id.toString());
    expect(snapshot.level).toBe('Pre-Intermediate');
    expect(snapshot.completedLessons[0]).not.toHaveProperty('awardedXp');
    expect(snapshot.completedLessons[0]).not.toHaveProperty('progressEpoch');
    expect((await service.getUserProgress(user._id.toString(), 'en')).level).toBe('Elementary');
    const saved = (await users.findById(user._id))!;
    expect(serializeUser(saved).level).toBe('Pre-Intermediate');
    expect(saved.level).toBe('Advanced'); expect(saved.levelPerLanguage.get('English')).toBe('Advanced');
    await complete('one', 90);
    expect((await progress.findOne({ lessonId: 'one' }))?.awardedXp).toBeUndefined();
    expect((await users.findById(user._id))?.totalXp).toBe(500);
  });
  it('6B: historical alias buckets stay intact while each new award goes to the canonical key once', async () => {
    await users.updateOne({ _id: user._id }, { $set: {
      totalXp: 180, xpPerLanguage: { English: 170, en: 10 }, levelPerLanguage: { English: 'Beginner' },
    } });
    await complete(); await complete();
    const saved = (await users.findById(user._id))!;
    expect(saved.totalXp).toBe(230);
    expect(saved.xpPerLanguage.get('English')).toBe(170);
    expect(saved.xpPerLanguage.get('en')).toBe(60);
    expect(saved.levelPerLanguage.get('English')).toBe('Beginner');
    expect(saved.levelPerLanguage.get('en')).toBe('Elementary');
    expect((await service.getUserProgress(user._id.toString(), 'English')).stats.totalXp).toBe(230);
  });
  it('6B: concurrent awards crossing a threshold retain derived levels and durable provenance', async () => {
    await users.updateOne({ _id: user._id }, { $set: { totalXp: 400, xpPerLanguage: { en: 400 } } });
    await Promise.all([complete('one'), complete('two')]);
    const saved = (await users.findById(user._id))!;
    expect(saved.totalXp).toBe(530); expect(saved.xpPerLanguage.get('en')).toBe(530);
    expect(saved.level).toBe('Pre-Intermediate'); expect(saved.levelPerLanguage.get('en')).toBe('Pre-Intermediate');
    expect((await progress.find()).reduce((sum, row) => sum + row.awardedXp!, 0)).toBe(130);
  });

  it('6A: missing epoch is zero; stale/future/epoch-less completions cannot repopulate reset progress', async () => {
    await users.collection.updateOne({ _id: user._id }, { $unset: { progressEpoch: '' } });
    expect((await service.getUserProgress(user._id.toString())).progressEpoch).toBe(0);
    await complete();
    const reset = await service.resetProgress(user._id.toString(), 0, 'device-b');
    expect(reset?.progressEpoch).toBe(1);
    await expect(complete('two')).rejects.toMatchObject({ status: 409 });
    await expect(service.completeLesson(user._id.toString(), 'two', 90, 2)).rejects.toMatchObject({ status: 409 });
    await expect(service.completeLesson(user._id.toString(), 'two', 90, undefined as any)).rejects.toMatchObject({ status: 400 });
    expect(await progress.countDocuments()).toBe(0);
    expect((await users.findById(user._id))?.totalXp).toBe(0);
    expect((await service.completeLesson(user._id.toString(), 'two', 90, 1))?.data.progressEpoch).toBe(1);
  });
  it('6A: concurrent/lost reset acknowledgements increment once and cannot delete newer work', async () => {
    await complete();
    const resets = await Promise.all(Array.from({ length: 5 }, () => service.resetProgress(user._id.toString(), 0, 'lost-ack')));
    expect(resets.every(r => r?.progressEpoch === 1)).toBe(true);
    await service.completeLesson(user._id.toString(), 'two', 90, 1);
    expect((await service.resetProgress(user._id.toString(), 0, 'lost-ack'))?.progressEpoch).toBe(1);
    expect((await users.findById(user._id))?.totalXp).toBe(80);
    expect((await progress.findOne({ lessonId: 'two' }))?.toObject()).toMatchObject({ awardedXp: 80, progressEpoch: 1 });
    expect(await progress.countDocuments()).toBe(1);
    await expect(service.resetProgress(user._id.toString(), 1, 'lost-ack')).rejects.toMatchObject({ status: 409 });
    await expect(service.resetProgress(user._id.toString(), 0, 'new-stale')).rejects.toMatchObject({ status: 409 });
    const b = await users.create({ name: 'B', email: 'b-reset@example.com', passwordHash: 'fixture', isGuest: true });
    expect((await service.resetProgress(b._id.toString(), 0, 'lost-ack'))?.progressEpoch).toBe(1);
    expect((await users.findById(user._id))?.progressEpoch).toBe(1);
  });
  it('6A: failed reset receipt rolls back and completion/reset overlap cannot resurrect old work', async () => {
    const original = users.updateOne.bind(users);
    let reached!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    jest.spyOn(users, 'updateOne').mockImplementationOnce(((...args: any[]) => {
      const query = (original as any)(...args);
      const exec = query.exec.bind(query);
      query.exec = async () => { reached(); await gate; return exec(); };
      return query;
    }) as any);
    const completion = complete();
    await started;
    const reset = service.resetProgress(user._id.toString(), 0, 'racing');
    release();
    const outcomes = await Promise.allSettled([completion, reset]);
    expect(outcomes[1].status).toBe('fulfilled');
    expect(await progress.countDocuments()).toBe(0);
    expect((await users.findById(user._id))?.totalXp).toBe(0);
  });
});
