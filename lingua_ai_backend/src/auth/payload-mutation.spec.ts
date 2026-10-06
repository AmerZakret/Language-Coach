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
        MongooseModule.forRoot(replica.getUri()), AuthModule, FlashcardsModule, CommunityModule, PronunciationModule],
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
    owner = await users.create({ name: 'Original', email: 'owner@example.com', passwordHash: 'fixture' });
    token = app.get(JwtService).sign({ sub: owner._id.toString(), email: 'untrusted@example.com' });
    card = await cards.create({ userId: owner._id, ...original });
  });
  afterAll(async () => { await app?.close(); await replica?.stop(); });

  it.each(['name', 'targetLanguage'])('profile %s rejects invalid types including null', async field => {
    for (const value of [null, 12, false, [], {}, '']) await profile({ [field]: value }).expect(400);
    expect((await users.findById(owner._id))?.name).toBe('Original');
    expect((await users.findById(owner._id))?.targetLanguage).toBe('English');
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
    await request(app.getHttpServer()).put(path).field('text', '').auth(token, { type: 'bearer' }).expect(200);
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
});
