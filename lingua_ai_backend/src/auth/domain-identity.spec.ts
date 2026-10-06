import { INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { AuthModule } from './auth.module';
import { User } from '../users/schemas/user.schema';
import { FlashcardsModule } from '../flashcards/flashcards.module';
import { FlashcardsService } from '../flashcards/flashcards.service';
import { Flashcard } from '../flashcards/schemas/flashcard.schema';
import { FlashcardOperation } from '../flashcards/schemas/flashcard-operation.schema';
import { AiContextService } from '../flashcards/services/ai-context.service';
import { ProgressModule } from '../progress/progress.module';
import { ProgressService } from '../progress/progress.service';
import { Progress } from '../progress/schemas/progress.schema';
import { Lesson } from '../lessons/schemas/lesson.schema';
import { AiCoachModule } from '../ai-coach/ai-coach.module';
import { AiCoachService } from '../ai-coach/ai-coach.service';
import { ChatMessage } from '../ai-coach/schemas/chat-message.schema';
import { PronunciationModule } from '../pronunciation/pronunciation.module';
import { PronunciationService } from '../pronunciation/pronunciation.service';

// Disposable local MongoDB, real JWT guard/controllers/domain services, no
// production database or external providers. All HTTP uses the real DTO pipe.
describe('Phase 5A JWT domain identity', () => {
  jest.setTimeout(120000);
  let replica: MongoMemoryReplSet;
  let app: INestApplication;
  let users: Model<User>;
  let cards: Model<Flashcard>;
  let progress: Model<Progress>;
  let messages: Model<ChatMessage>;
  let existing: User;
  let jwt: JwtService;
  let flashcards: FlashcardsService;
  let progressService: ProgressService;
  let coach: AiCoachService;
  const pronunciation = { assess: jest.fn(async (_file, dto) => ({ targetText: dto.targetText })) };
  const cardBody = { targetWord: 'word', turkishTranslation: 'translation', targetLanguage: 'en' };
  const chatBody = { message: 'Hello', language: 'en', targetLanguage: 'en' };
  const writingBody = { topic: 'Greetings', text: 'Hello, my name is Test.', language: 'en', targetLanguage: 'en' };

  beforeAll(async () => {
    replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MongooseModule.forRoot(replica.getUri()), AuthModule, FlashcardsModule,
        ProgressModule, AiCoachModule, PronunciationModule],
    }).overrideProvider(ConfigService).useValue(new ConfigService({
      JWT_SECRET: randomBytes(32).toString('hex'), GEMINI_API_KEY: 'test-only-key',
    })).overrideProvider(AiContextService).useValue({
      generateContext: async () => ({ sentences: ['example'], mnemonic: 'hint' }),
    }).overrideProvider(PronunciationService).useValue(pronunciation).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    users = module.get(getModelToken(User.name));
    cards = module.get(getModelToken(Flashcard.name));
    progress = module.get(getModelToken(Progress.name));
    messages = module.get(getModelToken(ChatMessage.name));
    jwt = module.get(JwtService);
    flashcards = module.get(FlashcardsService);
    progressService = module.get(ProgressService);
    coach = module.get(AiCoachService);
    await app.init();
    await Promise.all([users.init(), cards.init(), progress.init(), messages.init()]);
    await module.get<Model<Lesson>>(getModelToken(Lesson.name)).create({
      id: 'identity-lesson', targetLanguage: 'en', title: 'Fixture', description: 'Fixture',
      category: 'Grammar', difficulty: 'Beginner', level: 'Beginner', order: 1, duration: 5, xpReward: 25,
    });
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    pronunciation.assess.mockClear();
    await Promise.all([users.deleteMany({}), cards.deleteMany({}), progress.deleteMany({}),
      messages.deleteMany({}), app.get<Model<FlashcardOperation>>(getModelToken(FlashcardOperation.name)).deleteMany({})]);
    existing = await users.create({ name: 'Existing', email: 'existing@example.com', passwordHash: 'fixture' });
    jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(
        String(init?.body).includes('grammarScore')
          ? { grammarScore: 80, vocabularyScore: 80, clarityScore: 80, overallScore: 80,
              corrections: [], feedback: 'Good', improvedVersion: writingBody.text }
          : { reply: 'Hello back', correction: 'Hello' },
      ) }] } }] }),
    }) as Response);
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await app?.close(); await replica?.stop(); });

  const operations: [string, (id: string) => Promise<unknown>][] = [
    ['flashcard creation', id => flashcards.create(id, 'word', 'translation', 'en')],
    ['flashcard listing', id => flashcards.getAll(id, 'en')],
    ['due flashcards', id => flashcards.getDueCards(id, 'en')],
    ['progress reading', id => progressService.getUserProgress(id, 'en')],
    ['progress completion', id => progressService.completeLesson(id, 'identity-lesson', 73)],
    ['progress reset', id => progressService.resetProgress(id)],
    ['AI chat', id => coach.sendMessage(id, 'Hello', 'en', 'en')],
    ['AI writing', id => coach.checkWriting(id, writingBody.topic, writingBody.text, 'en', 'en')],
    ['AI history', id => coach.getHistory(id, 'en')],
    ['AI clearing', id => coach.clearHistory(id, 'en')],
  ];

  it.each(operations)('%s rejects emails, literal guests, and missing IDs without creating users', async (_name, operation) => {
    const lookup = jest.spyOn(users, 'findOne');
    const create = jest.spyOn(users, 'create');
    const byId = jest.spyOn(users, 'findById');
    for (const alias of [existing.email, 'guest', 'local_guest']) {
      await expect(operation(alias)).rejects.toBeInstanceOf(NotFoundException);
    }
    expect(byId).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    const missingId = new Types.ObjectId().toString();
    await expect(operation(missingId)).rejects.toThrow('Authenticated user not found');
    expect(byId).toHaveBeenCalledWith(missingId);
    // Mongoose findById delegates to findOne; its sole filter must be _id.
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup.mock.calls[0][0]).toEqual({ _id: missingId });
    expect(create).not.toHaveBeenCalled();
    expect(await users.countDocuments()).toBe(1);
    expect(await cards.countDocuments()).toBe(0);
    expect(await progress.countDocuments()).toBe(0);
    expect(await messages.countDocuments()).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('real backend guests use JWT MongoDB IDs across body-free identity contracts', async () => {
    const a = (await request(app.getHttpServer()).post('/auth/guest').expect(201)).body;
    const b = (await request(app.getHttpServer()).post('/auth/guest').expect(201)).body;
    const api = app.getHttpServer();
    expect(a.user.id).not.toBe(b.user.id);
    expect(jwt.verify(a.access_token).sub).toBe(a.user.id);
    const created = await request(api).post('/flashcards').send(cardBody)
      .set('X-Idempotency-Key', 'guest-create').auth(a.access_token, { type: 'bearer' }).expect(201);
    expect(created.body.userId).toBe(a.user.id);
    const retry = await request(api).post('/flashcards').send(cardBody)
      .set('X-Idempotency-Key', 'guest-create').auth(a.access_token, { type: 'bearer' }).expect(201);
    expect(retry.body._id).toBe(created.body._id);
    // Removing the request field must retain the pre-5A receipt hash: the
    // controller has always replaced client identity with JWT identity.
    const previousInput = { ...cardBody, userId: a.user.id };
    const previousHash = createHash('sha256').update(JSON.stringify(
      Object.fromEntries(Object.entries(previousInput).sort(([x], [y]) => x < y ? -1 : x > y ? 1 : 0)),
    )).digest('hex');
    const receipt = await app.get<Model<FlashcardOperation>>(getModelToken(FlashcardOperation.name))
      .findOne({ userId: a.user.id, operationId: 'guest-create' });
    expect(receipt?.requestHash).toBe(previousHash);
    const own = await request(api).get('/flashcards/all').query({ targetLanguage: 'en' })
      .auth(a.access_token, { type: 'bearer' }).expect(200);
    expect(own.body).toHaveLength(1);
    expect((await request(api).get('/flashcards/all')
      .auth(b.access_token, { type: 'bearer' }).expect(200)).body).toEqual([]);
    await request(api).post(`/progress/${b.user.id}/complete-lesson`)
      .send({ lessonId: 'identity-lesson', score: 73 }).auth(a.access_token, { type: 'bearer' }).expect(201);
    expect((await progress.findOne())?.userId.toString()).toBe(a.user.id);
    const chat = await request(api).post('/ai-coach/chat').send(chatBody)
      .auth(a.access_token, { type: 'bearer' }).expect(201);
    expect(chat.body.userMessage.userId).toBe(a.user.id);
    await request(api).post('/ai-coach/writing-check').send(writingBody)
      .auth(a.access_token, { type: 'bearer' }).expect(201);
    const history = await request(api).get('/ai-coach/history').query({ targetLanguage: 'en' })
      .auth(a.access_token, { type: 'bearer' }).expect(200);
    expect(history.body).toHaveLength(2);
    expect(history.body.every(message => message.userId === a.user.id)).toBe(true);
    await request(api).post('/pronunciation/assess').field('targetText', 'Hello').field('targetLanguage', 'en')
      .attach('audio', Buffer.from('fixture'), 'audio.wav').auth(a.access_token, { type: 'bearer' }).expect(201);
    expect(pronunciation.assess.mock.calls[0][1]).not.toHaveProperty('userId');
    expect(await users.countDocuments()).toBe(3);
  });

  it('clear remains authenticated and scoped, while the duplicate DELETE history route is absent', async () => {
    const a = existing._id.toString();
    const b = new Types.ObjectId().toString();
    const token = jwt.sign({ sub: a, email: 'irrelevant@example.com' });
    await messages.create([
      { userId: a, role: 'user', message: 'A English', targetLanguage: 'English' },
      { userId: a, role: 'user', message: 'A German', targetLanguage: 'German' },
      { userId: b, role: 'user', message: 'B English', targetLanguage: 'English' },
    ]);
    await request(app.getHttpServer()).delete('/ai-coach/clear').query({ targetLanguage: 'en' }).expect(401);
    const cleared = await request(app.getHttpServer()).delete('/ai-coach/clear')
      .query({ userId: b, targetLanguage: 'en' }).auth(token, { type: 'bearer' }).expect(200);
    expect(cleared.body.deletedCount).toBe(1);
    expect(await messages.countDocuments()).toBe(2);
    await request(app.getHttpServer()).delete('/ai-coach/history')
      .auth(token, { type: 'bearer' }).expect(404);
  });

  it.each(['guest', 'local_guest', 'existing@example.com', new Types.ObjectId().toString()])
  ('rejects JWT subject %s without resolving its email claim', async sub => {
    const token = jwt.sign({ sub, email: existing.email });
    await request(app.getHttpServer()).get('/flashcards/all')
      .auth(token, { type: 'bearer' }).expect(401);
    expect(await users.countDocuments()).toBe(1);
  });

  it('removes client body identity while preserving validation of domain fields', async () => {
    const token = jwt.sign({ sub: existing._id.toString(), email: existing.email });
    for (const [path, body] of [['/flashcards', cardBody], ['/ai-coach/chat', chatBody],
      ['/ai-coach/writing-check', writingBody]] as const) {
      await request(app.getHttpServer()).post(path).send({ ...body, userId: 'guest' })
        .auth(token, { type: 'bearer' }).expect(400);
      await request(app.getHttpServer()).post(path).send({})
        .auth(token, { type: 'bearer' }).expect(400);
    }
    await request(app.getHttpServer()).post('/pronunciation/assess')
      .field('targetText', 'Hello').field('targetLanguage', 'en').field('userId', 'guest')
      .attach('audio', Buffer.from('fixture'), 'audio.wav').auth(token, { type: 'bearer' }).expect(400);
    expect(pronunciation.assess).not.toHaveBeenCalled();
  });
});
