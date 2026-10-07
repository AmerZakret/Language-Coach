import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import { Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { AuthModule } from './auth.module';
import { User } from '../users/schemas/user.schema';
import { FlashcardsModule } from '../flashcards/flashcards.module';
import { Flashcard } from '../flashcards/schemas/flashcard.schema';
import { FlashcardOperation } from '../flashcards/schemas/flashcard-operation.schema';
import { AiContextService } from '../flashcards/services/ai-context.service';
import { CommunityModule } from '../community/community.module';
import { CommunityPost } from '../community/schemas/community-post.schema';
import { PronunciationModule } from '../pronunciation/pronunciation.module';
import { PronunciationService } from '../pronunciation/pronunciation.service';
import { AiCoachModule } from '../ai-coach/ai-coach.module';
import { ChatMessage } from '../ai-coach/schemas/chat-message.schema';
import { ProgressModule } from '../progress/progress.module';
import { ProgressService } from '../progress/progress.service';
import { Progress } from '../progress/schemas/progress.schema';
import { LessonsModule } from '../lessons/lessons.module';
import { TARGET_LANGUAGE_NAMES } from '../common/target-language';

// Actual DTO pipe, JWT guard, services, transactions and stored mutations.
// Only external providers are mocked; MongoDB is disposable local test data.
describe('Phase 5C validation and mutation contracts', () => {
  jest.setTimeout(120000);
  let replica: MongoMemoryReplSet;
  let app: INestApplication;
  let users: Model<User>;
  let cards: Model<Flashcard>;
  let operations: Model<FlashcardOperation>;
  let posts: Model<CommunityPost>;
  let owner: User;
  let card: Flashcard;
  let token: string;
  const ai = { generateContext: jest.fn(async () => ({ sentences: ['example'], mnemonic: 'hint' })) };
  const pronunciation = { assess: jest.fn(async (_file, dto) => ({ targetText: dto.targetText })) };
  const original = { targetWord: 'word', turkishTranslation: 'translation', targetLanguage: 'English',
    nativeLanguage: 'Turkish', nativeTranslation: 'native', exampleSentence: 'saved example', note: 'saved note' };
  const profile = (body: object) => request(app.getHttpServer()).patch('/users/profile').send(body).auth(token, { type: 'bearer' });
  const update = (body: object, key = 'update') => request(app.getHttpServer()).put(`/flashcards/${card._id}`)
    .send(body).auth(token, { type: 'bearer' }).set('X-Idempotency-Key', key);

  beforeAll(async () => {
    replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MongooseModule.forRoot(replica.getUri()), AuthModule, FlashcardsModule, CommunityModule, PronunciationModule,
        AiCoachModule, ProgressModule, LessonsModule],
    }).overrideProvider(ConfigService).useValue(new ConfigService({ JWT_SECRET: randomBytes(32).toString('hex') }))
      .overrideProvider(AiContextService).useValue(ai)
      .overrideProvider(PronunciationService).useValue(pronunciation).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    users = module.get(getModelToken(User.name));
    cards = module.get(getModelToken(Flashcard.name));
    operations = module.get(getModelToken(FlashcardOperation.name));
    posts = module.get(getModelToken(CommunityPost.name));
    await app.init();
    await Promise.all([users.init(), cards.init(), operations.init(), posts.init()]);
  });
  beforeEach(async () => {
    ai.generateContext.mockClear(); pronunciation.assess.mockClear();
    await Promise.all([users.deleteMany({}), cards.deleteMany({}), operations.deleteMany({}), posts.deleteMany({})]);
    await app.get<Model<Progress>>(getModelToken(Progress.name)).deleteMany({});
    await app.get<Model<ChatMessage>>(getModelToken(ChatMessage.name)).deleteMany({});
    owner = await users.create({ name: 'Original', email: 'owner@example.com', passwordHash: 'fixture' });
    token = app.get(JwtService).sign({ sub: owner._id.toString(), email: 'untrusted@example.com' });
    card = await cards.create({ userId: owner._id, ...original });
  });
  afterAll(async () => { await app?.close(); await replica?.stop(); });

  it.each(['name', 'targetLanguage'])('profile %s rejects invalid types including null', async field => {
    for (const value of [null, 12, false, [], {}, '']) await profile({ [field]: value }).expect(400);
    expect((await users.findById(owner._id))?.name).toBe('Original');
    expect((await users.findById(owner._id))?.targetLanguage).toBe('en');
  });
  it.each(['email', 'userId', 'isGuest', 'totalXp', 'unexpected'])('profile rejects unknown field %s', async field => {
    const response = await profile({ name: 'Changed', [field]: 'invalid' }).expect(400);
    expect(response.body.message).toEqual(expect.arrayContaining([`property ${field} should not exist`]));
    expect((await users.findById(owner._id))?.name).toBe('Original');
  });
  it('profile supports optional updates without changing identity, stats or omitted fields', async () => {
    await profile({ name: 'Changed' }).expect(200);
    const language = await profile({ targetLanguage: 'de' }).expect(200);
    expect(language.body).toMatchObject({ id: owner._id.toString(), name: 'Changed', targetLanguage: 'de', email: owner.email });
    await profile({}).expect(200);
    const saved = await users.findById(owner._id);
    expect(saved?.totalXp).toBe(0);
    expect(saved?.isGuest).toBe(false);
  });

  it.each([null, '4', 2.5, -1, 6, true, [], {}])('review rejects invalid score %p without effects or receipts', async score => {
    await request(app.getHttpServer()).put(`/flashcards/${card._id}/review`)
      .send({ score }).auth(token, { type: 'bearer' }).set('X-Idempotency-Key', 'invalid-review').expect(400);
    expect((await cards.findById(card._id))?.history).toHaveLength(0);
    expect(await operations.countDocuments()).toBe(0);
  });
  it('review rejects missing and unknown fields', async () => {
    for (const body of [{}, { score: 4, userId: 'guest' }]) {
      await request(app.getHttpServer()).put(`/flashcards/${card._id}/review`)
        .send(body).auth(token, { type: 'bearer' }).expect(400);
    }
  });
  it.each([0, 1, 2, 3, 4, 5])('review score %s remains valid and keyed retries apply once', async score => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await request(app.getHttpServer()).put(`/flashcards/${card._id}/review`).send({ score })
        .auth(token, { type: 'bearer' }).set('X-Idempotency-Key', 'valid-review').expect(200);
    }
    const saved = await cards.findById(card._id);
    expect(saved?.history).toHaveLength(1);
    expect(saved?.history[0].score).toBe(score);
  });

  it('word-only update preserves all omitted optional and native fields', async () => {
    await update({ targetWord: 'changed' }).expect(200);
    expect((await cards.findById(card._id))?.toObject()).toMatchObject({ ...original, targetWord: 'changed' });
  });
  it.each(['note', 'exampleSentence', 'nativeLanguage', 'nativeTranslation'])('explicit empty %s clears only that field', async field => {
    await update({ [field]: '' }).expect(200);
    expect((await cards.findById(card._id))?.toObject()).toMatchObject({ ...original, [field]: '' });
  });
  it.each(Object.keys(original))('update rejects explicit null %s', async field => {
    await update({ [field]: null }).expect(400);
    expect((await cards.findById(card._id))?.toObject()).toMatchObject(original);
    expect(await operations.countDocuments()).toBe(0);
  });
  it('empty required values and unknown update fields are rejected', async () => {
    for (const body of [{ targetWord: '' }, { turkishTranslation: '' }, { targetLanguage: '' }, { note: 12 }, { userId: 'guest' }]) {
      await update(body).expect(400);
    }
  });
  it('a delayed clear retry cannot overwrite a newer note', async () => {
    await update({ note: '' }, 'clear-once').expect(200);
    await update({ note: 'newer' }, 'later-note').expect(200);
    await update({ note: '' }, 'clear-once').expect(200);
    expect((await cards.findById(card._id))?.note).toBe('newer');
  });
  it('partial updates still enforce JWT ownership', async () => {
    const other = await users.create({ name: 'Other', email: 'other@example.com', passwordHash: 'fixture' });
    const otherToken = app.get(JwtService).sign({ sub: other._id.toString() });
    await request(app.getHttpServer()).put(`/flashcards/${card._id}`).send({ note: '' })
      .auth(otherToken, { type: 'bearer' }).expect(403);
    expect((await cards.findById(card._id))?.note).toBe(original.note);
  });

  it('community allows clearing text only when an image remains, and omission preserves text', async () => {
    const image = await posts.create({ userId: owner._id.toString(), userName: owner.name,
      learningLanguage: 'English', text: 'caption', imageUrl: '/uploads/community/fixture.png' });
    const path = `/community/posts/${image._id}`;
    await request(app.getHttpServer()).put(path).send({}).auth(token, { type: 'bearer' }).expect(200);
    expect((await posts.findById(image._id))?.text).toBe('caption');
    const cleared = await request(app.getHttpServer()).put(path).field('text', '').auth(token, { type: 'bearer' }).expect(200);
    expect(cleared.body.learningLanguage).toBe('en');
    expect((await posts.findById(image._id))?.text).toBe('');
    expect((await posts.findById(image._id))?.imageUrl).toBe(image.imageUrl);
    const textOnly = await posts.create({ userId: owner._id.toString(), userName: owner.name,
      learningLanguage: 'English', text: 'text only' });
    await request(app.getHttpServer()).put(`/community/posts/${textOnly._id}`)
      .field('text', '').auth(token, { type: 'bearer' }).expect(400);
    expect((await posts.findById(textOnly._id))?.text).toBe('text only');
  });
  it('pronunciation removes unused sourceId and retains active client metadata', async () => {
    await request(app.getHttpServer()).post('/pronunciation/assess').field('targetText', 'Hello')
      .field('targetLanguage', 'en').field('sourceId', 'unused').auth(token, { type: 'bearer' }).expect(400);
    expect(pronunciation.assess).not.toHaveBeenCalled();
    await request(app.getHttpServer()).post('/pronunciation/assess').field('targetText', 'Hello')
      .field('targetLanguage', 'en').field('sourceType', 'manual').field('nativeLanguage', 'tr')
      .field('nativeTranslation', 'Merhaba').attach('audio', Buffer.from('fixture'), 'audio.wav')
      .auth(token, { type: 'bearer' }).expect(201);
  });

  it.each(Object.entries(TARGET_LANGUAGE_NAMES))('Phase 5D: %s and legacy %s work at language API boundaries', async (code, name) => {
    for (const value of [code, name]) {
      const result = await profile({ targetLanguage: value }).expect(200);
      expect(result.body.targetLanguage).toBe(code);
      expect((await users.findById(owner._id))?.targetLanguage).toBe(code);
      const response = await request(app.getHttpServer()).post('/flashcards')
        .send({ targetWord: `${code}-${value}`, turkishTranslation: 'translation', targetLanguage: value })
        .auth(token, { type: 'bearer' }).set('X-Idempotency-Key', `language-${value}`).expect(201);
      expect(response.body.targetLanguage).toBe(code);
      expect((await cards.findById(response.body._id))?.targetLanguage).toBe(code);
      expect(ai.generateContext).toHaveBeenLastCalledWith(`${code}-${value}`, 'translation', code);
      const lessons = await request(app.getHttpServer()).get('/lessons').query({ targetLanguage: value }).expect(200);
      expect(lessons.body.length).toBeGreaterThan(0);
      expect(lessons.body.every(lesson => lesson.targetLanguage === code)).toBe(true);
      await request(app.getHttpServer()).post('/ai-coach/chat').send({ message: 'Hello', language: 'en', targetLanguage: value })
        .auth(token, { type: 'bearer' }).expect(201);
      await request(app.getHttpServer()).post('/ai-coach/writing-check')
        .send({ topic: 'Greeting', text: 'Hello', language: 'en', targetLanguage: value }).auth(token, { type: 'bearer' }).expect(503);
      await request(app.getHttpServer()).post('/pronunciation/assess').field('targetText', 'Hello')
        .field('targetLanguage', value).attach('audio', Buffer.from('fixture'), 'audio.wav').auth(token, { type: 'bearer' }).expect(201);
    }
  });

  it('Phase 5D: unsupported languages reject across validated bodies and query boundaries', async () => {
    await profile({ targetLanguage: 'Italian' }).expect(400);
    await update({ targetLanguage: 'Italian' }).expect(400);
    await request(app.getHttpServer()).post('/flashcards').send({ targetWord: 'word', turkishTranslation: 'translation', targetLanguage: 'Italian' })
      .auth(token, { type: 'bearer' }).expect(400);
    await request(app.getHttpServer()).post('/ai-coach/chat').send({ message: 'Hello', language: 'en', targetLanguage: 'Italian' })
      .auth(token, { type: 'bearer' }).expect(400);
    await request(app.getHttpServer()).post('/ai-coach/writing-check').send({ topic: 'Greeting', text: 'Hello', language: 'en', targetLanguage: 'Italian' })
      .auth(token, { type: 'bearer' }).expect(400);
    await request(app.getHttpServer()).post('/pronunciation/assess').field('targetText', 'Hello').field('targetLanguage', 'Italian')
      .auth(token, { type: 'bearer' }).expect(400);
    for (const value of ['Italian', '']) {
      for (const path of ['/lessons', '/flashcards/all', '/flashcards/due', '/ai-coach/history', `/progress/${owner._id}`]) {
        await request(app.getHttpServer()).get(path).query({ targetLanguage: value }).auth(token, { type: 'bearer' }).expect(400);
      }
    }
  });

  it('Phase 5D: legacy flashcards stay readable and create lookup reuses them without rewriting historical language', async () => {
    const response = await request(app.getHttpServer()).post('/flashcards')
      .send({ targetWord: original.targetWord, turkishTranslation: original.turkishTranslation, targetLanguage: 'en' })
      .auth(token, { type: 'bearer' }).expect(201);
    expect(response.body._id).toBe(card._id.toString());
    expect(response.body.targetLanguage).toBe('en');
    expect((await cards.findById(card._id))?.targetLanguage).toBe('English');
    expect(await cards.countDocuments()).toBe(1);
    const missing = await cards.collection.insertOne({ userId: owner._id, targetWord: 'old', turkishTranslation: 'translation', nextReviewDate: new Date(0) });
    for (const path of ['/flashcards/all', '/flashcards/due']) {
      const result = await request(app.getHttpServer()).get(path).query({ targetLanguage: 'English' }).auth(token, { type: 'bearer' }).expect(200);
      expect(result.body.map(card => card._id)).toContain(missing.insertedId.toString());
      expect(result.body.every(card => card.targetLanguage === 'en')).toBe(true);
    }
    expect((await cards.collection.findOne({ _id: missing.insertedId }))!.targetLanguage).toBeUndefined();
  });

  it('Phase 5D: same-language edits preserve legacy unique keys when a canonical duplicate already exists', async () => {
    const canonical = await cards.create({ ...original, targetLanguage: 'en', userId: owner._id });
    const result = await update({ targetLanguage: 'en', note: 'edited' }).expect(200);
    expect(result.body.targetLanguage).toBe('en');
    expect((await cards.findById(card._id))?.targetLanguage).toBe('English');
    expect((await cards.findById(canonical._id))?.note).toBe(original.note);
    expect(await cards.countDocuments()).toBe(2);
  });

  it('Phase 5D: legacy chat and community language queries preserve historical rows', async () => {
    const messages = app.get<Model<ChatMessage>>(getModelToken(ChatMessage.name));
    await messages.create([
      { userId: owner._id, role: 'user', message: 'old', targetLanguage: 'German' },
      { userId: owner._id, role: 'assistant', message: 'new', targetLanguage: 'de' },
      { userId: owner._id, role: 'user', message: 'other language', targetLanguage: 'fr' },
    ]);
    const history = await request(app.getHttpServer()).get('/ai-coach/history').query({ targetLanguage: 'de' }).auth(token, { type: 'bearer' }).expect(200);
    expect(history.body).toHaveLength(2);
    expect(history.body.every(message => message.targetLanguage === 'de')).toBe(true);
    await request(app.getHttpServer()).delete('/ai-coach/clear').query({ targetLanguage: 'German' }).auth(token, { type: 'bearer' }).expect(200);
    expect(await messages.countDocuments()).toBe(1);
    await posts.create({ userId: owner._id.toString(), userName: owner.name, learningLanguage: 'German', text: 'old' });
    const created = await request(app.getHttpServer()).post('/community/posts').field('learningLanguage', 'German').field('text', 'new')
      .auth(token, { type: 'bearer' }).expect(201);
    expect(created.body.learningLanguage).toBe('de');
    const feed = await request(app.getHttpServer()).get('/community/posts').query({ language: 'de' }).auth(token, { type: 'bearer' }).expect(200);
    expect(feed.body.items).toHaveLength(2);
    expect(feed.body.items.every(post => post.learningLanguage === 'de')).toBe(true);
  });

  it('Phase 5D: progress codes and full-name XP keys coexist without losing XP, levels or completion idempotency', async () => {
    const service = app.get(ProgressService);
    const progress = app.get<Model<Progress>>(getModelToken(Progress.name));
    await users.updateOne({ _id: owner._id }, { $set: { totalXp: 180, xpPerLanguage: { German: 170, de: 10 }, levelPerLanguage: { German: 'Beginner' } } });
    await progress.create({ userId: owner._id, lessonId: 'de_2', score: 73, targetLanguage: 'German' });
    await progress.collection.insertOne({ userId: owner._id, lessonId: 'de_3', score: 77, status: 'completed' });
    const old = await service.getUserProgress(owner._id.toString(), 'de');
    expect(old.stats.totalXp).toBe(180);
    expect(old.completedLessons.map(lesson => lesson.lessonId)).toEqual(expect.arrayContaining(['de_2', 'de_3']));
    const completed = await service.completeLesson(owner._id.toString(), 'de_1', 73);
    expect(completed?.data.newTotalXp).toBe(180 + completed!.data.xpEarned);
    expect((await progress.findOne({ lessonId: 'de_1' }))?.targetLanguage).toBe('de');
    const saved = (await users.findById(owner._id))!;
    expect(saved.xpPerLanguage.get('German')).toBe(170);
    expect(saved.xpPerLanguage.get('de')).toBe(10 + completed!.data.xpEarned);
    expect((await service.completeLesson(owner._id.toString(), 'de_1', 90))?.data.xpEarned).toBe(0);
    expect((await service.getUserProgress(owner._id.toString(), 'German')).stats.totalXp).toBe(saved.totalXp);
    expect((await progress.collection.findOne({ lessonId: 'de_3' }))!.targetLanguage).toBeUndefined();
  });
});
