import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ProgressModule } from './progress.module';
import { ProgressService } from './progress.service';
import { Progress } from './schemas/progress.schema';
import { User } from '../users/schemas/user.schema';
import { Lesson } from '../lessons/schemas/lesson.schema';

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
    await complete(); await complete('one', 91); await complete('one', 20, 0);
    expect((await progress.findOne({ lessonId: 'one' }))?.score).toBe(91);
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
