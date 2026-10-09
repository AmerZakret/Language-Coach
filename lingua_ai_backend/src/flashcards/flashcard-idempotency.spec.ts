import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { User } from '../users/schemas/user.schema';
import { Lesson } from '../lessons/schemas/lesson.schema';
import { Progress } from '../progress/schemas/progress.schema';
import { ProgressModule } from '../progress/progress.module';
import { FlashcardsModule } from './flashcards.module';
import { FlashcardsController } from './flashcards.controller';
import { FlashcardsService } from './flashcards.service';
import { FlashcardIdempotencyService } from './flashcard-idempotency.service';
import { Flashcard } from './schemas/flashcard.schema';
import { FlashcardOperation } from './schemas/flashcard-operation.schema';
import { AiContextService } from './services/ai-context.service';

// Real MongoDB transactions/indexes in a disposable local replica set. Only
// authentication fixtures and external AI generation are replaced.
describe('Queued flashcard idempotency', () => {
  jest.setTimeout(120000);
  let replica: MongoMemoryReplSet;
  let app: INestApplication;
  let cards: Model<Flashcard>;
  let operations: Model<FlashcardOperation>;
  let users: Model<User>;
  let a: User;
  let b: User;
  let cardA: Flashcard;
  let cardB: Flashcard;
  const ai = { generateContext: jest.fn(async () => ({ sentences: ['example'], mnemonic: 'hint' })) };
  const body = { targetWord: 'word',
    turkishTranslation: 'translation', targetLanguage: 'English', note: 'original' };
  const review = (card = cardA, key = 'review-1', owner = a, score = 4) =>
    request(app.getHttpServer()).put(`/flashcards/${card._id}/review`)
      .auth(owner._id.toString(), { type: 'bearer' }).set('X-Idempotency-Key', key).send({ score });
  const create = (key = 'create-1', payload = body) => request(app.getHttpServer()).post('/flashcards')
    .auth(a._id.toString(), { type: 'bearer' }).set('X-Idempotency-Key', key).send(payload);
  const remove = (key = 'delete-1', owner = a) => request(app.getHttpServer()).delete(`/flashcards/${cardA._id}`)
    .auth(owner._id.toString(), { type: 'bearer' }).set('X-Idempotency-Key', key);

  beforeAll(async () => {
    replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const module = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(replica.getUri()), FlashcardsModule, ProgressModule],
    }).overrideProvider(AiContextService).useValue(ai)
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: async context => {
        const req = context.switchToHttp().getRequest();
        const id = req.headers.authorization?.replace(/^Bearer /, '');
        if (!id || !Types.ObjectId.isValid(id)) throw new UnauthorizedException();
        req.user = await users.findById(id);
        if (!req.user) throw new UnauthorizedException();
        return true;
      } }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    cards = module.get(getModelToken(Flashcard.name));
    operations = module.get(getModelToken(FlashcardOperation.name));
    users = module.get(getModelToken(User.name));
    await app.init();
    await Promise.all([cards.init(), users.init(), module.get<Model<Progress>>(getModelToken(Progress.name)).init()]);
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    ai.generateContext.mockClear();
    await Promise.all([cards.deleteMany({}), operations.deleteMany({}), users.deleteMany({}),
      app.get<Model<Progress>>(getModelToken(Progress.name)).deleteMany({}),
      app.get<Model<Lesson>>(getModelToken(Lesson.name)).deleteMany({})]);
    [a, b] = await users.create([
      { name: 'A', email: 'a@example.com', passwordHash: 'fixture' },
      { name: 'B', email: 'b@example.com', passwordHash: 'fixture' },
    ]);
    [cardA, cardB] = await cards.create([
      { ...body, userId: a._id, history: [] },
      { ...body, userId: b._id, history: [] },
    ]);
  });

  afterAll(async () => { await app?.close(); await replica?.stop(); });

  it('applies duplicate review once without changing SRS/history/date on retry', async () => {
    const first = await review().expect(200);
    const duplicate = await review().expect(200);
    expect(duplicate.body).toEqual(first.body);
    const saved = await cards.findById(cardA._id);
    expect(saved?.reviewCount).toBe(1);
    expect(saved?.history).toHaveLength(1);
    expect(await operations.countDocuments()).toBe(1);
  });

  it('lost-response retry remains single-review state after service restart', async () => {
    await review().expect(200); // Server commits; client discards this response.
    const before = (await cards.findById(cardA._id))!.toObject();
    const restarted = new FlashcardIdempotencyService(app.get<Connection>(getConnectionToken()), operations, cards);
    const controller = new FlashcardsController(app.get(FlashcardsService), restarted);
    await controller.review(cardA._id.toString(), { score: 4 }, { user: a }, 'review-1');
    expect((await cards.findById(cardA._id))!.toObject()).toEqual(before);
  });

  it('different operation IDs apply two legitimate reviews', async () => {
    await review().expect(200); await review(cardA, 'review-2').expect(200);
    const saved = await cards.findById(cardA._id);
    expect(saved?.reviewCount).toBe(2); expect(saved?.history).toHaveLength(2);
    expect(saved?.interval).toBe(6);
  });

  it('same operation ID is isolated by authenticated user', async () => {
    await review().expect(200); await review(cardB, 'review-1', b).expect(200);
    expect((await cards.findById(cardA._id))?.reviewCount).toBe(1);
    expect((await cards.findById(cardB._id))?.reviewCount).toBe(1);
    expect(await operations.countDocuments()).toBe(2);
  });

  it('concurrent same-ID reviews commit exactly once', async () => {
    const replies = await Promise.all(Array.from({ length: 6 }, () => review()));
    expect(replies.map(r => r.status)).toEqual(Array(6).fill(200));
    const saved = await cards.findById(cardA._id);
    expect(saved?.reviewCount).toBe(1); expect(saved?.history).toHaveLength(1);
    expect(await operations.countDocuments()).toBe(1);
  });

  it('concurrent distinct review IDs both apply using current SRS state', async () => {
    const replies = await Promise.all([review(), review(cardA, 'review-2')]);
    expect(replies.map(r => r.status)).toEqual([200, 200]);
    const saved = await cards.findById(cardA._id);
    expect(saved?.reviewCount).toBe(2); expect(saved?.history).toHaveLength(2);
    expect(saved?.interval).toBe(6);
  });

  it('rolls back the review when its durable receipt cannot be saved', async () => {
    jest.spyOn(operations, 'create').mockRejectedValueOnce(new Error('Receipt write interrupted') as never);
    await review().expect(500);
    expect((await cards.findById(cardA._id))?.reviewCount).toBe(0);
    expect(await operations.countDocuments()).toBe(0);
    await review().expect(200);
    expect((await cards.findById(cardA._id))?.reviewCount).toBe(1);
  });

  it('delete retry succeeds after the resource is gone, only for that operation', async () => {
    const first = await remove().expect(200);
    expect((await remove().expect(200)).body).toEqual(first.body);
    await remove('different-delete').expect(404);
    await remove('delete-1', b).expect(404);
    expect(await operations.countDocuments()).toBe(1);
  });

  it('create retry avoids a second logical card and AI regeneration', async () => {
    await cards.deleteMany({ userId: a._id });
    const first = await create().expect(201);
    const duplicate = await create().expect(201);
    expect(duplicate.body._id).toBe(first.body._id);
    expect(await cards.countDocuments({ userId: a._id })).toBe(1);
    expect(ai.generateContext).toHaveBeenCalledTimes(1);
  });

  it('concurrent duplicate creates claim the key before AI/business effects', async () => {
    await cards.deleteMany({ userId: a._id });
    const replies = await Promise.all(Array.from({ length: 4 }, () => create()));
    expect(replies.map(r => r.status)).toEqual(Array(4).fill(201));
    expect(new Set(replies.map(r => r.body._id)).size).toBe(1);
    expect(ai.generateContext).toHaveBeenCalledTimes(1);
    expect(await cards.countDocuments({ userId: a._id })).toBe(1);
  });

  it('aborts a saved create when final receipt reference persistence fails', async () => {
    await cards.deleteMany({ userId: a._id });
    jest.spyOn(operations, 'updateOne').mockImplementationOnce(() => ({
      exec: async () => { throw new Error('Receipt finalization interrupted'); },
    }) as any);
    await create().expect(500);
    expect(await cards.countDocuments({ userId: a._id })).toBe(0);
    expect(await operations.countDocuments()).toBe(0);
    await create().expect(201);
    expect(await cards.countDocuments({ userId: a._id })).toBe(1);
  });

  it('same word with a new operation still updates details legitimately', async () => {
    await create().expect(201);
    await create('create-2', { ...body, note: 'new note' }).expect(201);
    const oldRetry = await create().expect(201);
    expect(oldRetry.body.note).toBe('new note');
    expect(await cards.countDocuments({ userId: a._id })).toBe(1);
    expect(ai.generateContext).toHaveBeenCalledTimes(2);
  });

  it('old create retry cannot recreate a card after it was renamed or deleted', async () => {
    const created = await create().expect(201);
    await cards.updateOne({ _id: created.body._id }, { targetWord: 'renamed' });
    expect((await create().expect(201)).body.targetWord).toBe('renamed');
    await cards.deleteOne({ _id: created.body._id });
    expect((await create().expect(201)).body._id).toBe(created.body._id);
    expect(await cards.countDocuments({ userId: a._id })).toBe(0);
    expect(ai.generateContext).toHaveBeenCalledTimes(1);
  });

  it('old duplicate update cannot overwrite a newer acknowledged update', async () => {
    const update = (key, note) => request(app.getHttpServer()).put(`/flashcards/${cardA._id}`)
      .auth(a._id.toString(), { type: 'bearer' }).set('X-Idempotency-Key', key)
      .send({ targetWord: 'word', turkishTranslation: 'translation', note });
    await update('edit-1', 'first').expect(200);
    await update('edit-2', 'newest').expect(200);
    expect((await update('edit-1', 'first').expect(200)).body.note).toBe('newest');
    expect(ai.generateContext).toHaveBeenCalledTimes(2);
  });

  it('does not bypass ownership or JWT authentication with another user receipt', async () => {
    await review(cardB, 'shared-key', b).expect(200);
    await review(cardB, 'shared-key', a).expect(403);
    await request(app.getHttpServer()).put(`/flashcards/${cardB._id}`)
      .auth(a._id.toString(), { type: 'bearer' }).set('X-Idempotency-Key', 'shared-key')
      .send({ targetWord: 'changed', turkishTranslation: 'translation' }).expect(403);
    await request(app.getHttpServer()).delete(`/flashcards/${cardB._id}`)
      .auth(a._id.toString(), { type: 'bearer' }).set('X-Idempotency-Key', 'shared-key').expect(403);
    await request(app.getHttpServer()).put(`/flashcards/${cardB._id}/review`)
      .set('X-Idempotency-Key', 'shared-key').send({ score: 4 }).expect(401);
    expect((await cards.findById(cardB._id))?.reviewCount).toBe(1);
    expect(await operations.countDocuments()).toBe(1);
  });

  it('rejects changed payload/resource under an already completed key', async () => {
    await review().expect(200);
    await review(cardA, 'review-1', a, 5).expect(409);
    await review(cardB, 'review-1', a).expect(409);
    expect((await cards.findById(cardA._id))?.reviewCount).toBe(1);
    expect((await cards.findById(cardB._id))?.reviewCount).toBe(0);
  });

  it('invalid keys and missing resources never receive successful receipts', async () => {
    await review(cardA, 'bad key').expect(400);
    await review({ _id: new Types.ObjectId() } as Flashcard).expect(404);
    expect(await operations.countDocuments()).toBe(0);
  });

  it('acknowledges a committed review even if a later operation deleted its card', async () => {
    await review().expect(200); await remove().expect(200);
    expect((await review().expect(200)).body._id).toBe(cardA._id.toString());
    expect(await cards.findById(cardA._id)).toBeNull();
  });

  it('enforces a durable owner/type/key unique index without TTL expiration', async () => {
    await review().expect(200);
    const receipt = (await operations.findOne())!.toObject();
    delete receipt._id;
    await expect(operations.create(receipt)).rejects.toMatchObject({ code: 11000 });
    const indexes = await operations.collection.indexes();
    expect(indexes).toEqual(expect.arrayContaining([expect.objectContaining({
      key: { userId: 1, operationId: 1, operationType: 1 }, unique: true,
    })]));
    expect(indexes.some(index => index.expireAfterSeconds !== undefined)).toBe(false);
  });

  it('ordinary unkeyed review callers remain compatible', async () => {
    await request(app.getHttpServer()).put(`/flashcards/${cardA._id}/review`)
      .auth(a._id.toString(), { type: 'bearer' }).send({ score: 4 }).expect(200);
    expect((await cards.findById(cardA._id))?.reviewCount).toBe(1);
  });

  it('lesson completion natural key prevents duplicate XP on queued retries', async () => {
    await app.get<Model<Lesson>>(getModelToken(Lesson.name)).create({ id: 'lesson-1',
      targetLanguage: 'English', title: 'Lesson', description: 'Test', category: 'test',
      difficulty: 'easy', level: 'Beginner', order: 1, duration: 5, xpReward: 50 });
    const complete = () => request(app.getHttpServer()).post(`/progress/${a._id}/complete-lesson`)
      .auth(a._id.toString(), { type: 'bearer' }).set('X-Idempotency-Key', 'complete-1')
      .send({ lessonId: 'lesson-1', score: 90, progressEpoch: 0 });
    expect((await complete().expect(201)).body.data.xpEarned).toBe(50);
    expect((await complete().expect(201)).body.data.xpEarned).toBe(0);
    expect((await users.findById(a._id))?.totalXp).toBe(50);
    expect(await app.get<Model<Progress>>(getModelToken(Progress.name)).countDocuments()).toBe(1);
  });
});
