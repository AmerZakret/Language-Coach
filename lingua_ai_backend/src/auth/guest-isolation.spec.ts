import { serializeUser } from '../users/user-response';
type AuthSession = {
  access_token: string;
  user: ReturnType<typeof serializeUser>;
};
import { MutationTimeline } from '../operations/mutation-timeline';
import { unitTimeline } from '../../test/timeline-fixture';
import { MutationReceipts } from '../common/mutation-receipt';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import { model, Types } from 'mongoose';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { User, UserSchema } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { UsersController } from '../users/users.controller';
import { ProgressController } from '../progress/progress.controller';
import { ProgressService } from '../progress/progress.service';
import { AiCoachController } from '../ai-coach/ai-coach.controller';
import { AiCoachService } from '../ai-coach/ai-coach.service';
import { FlashcardsController } from '../flashcards/flashcards.controller';
import { FlashcardsService } from '../flashcards/flashcards.service';
import { FlashcardIdempotencyService } from '../flashcards/flashcard-idempotency.service';
import { Flashcard } from '../flashcards/schemas/flashcard.schema';
import { SrsCalculatorService } from '../flashcards/services/srs-calculator.service';
import { AiContextService } from '../flashcards/services/ai-context.service';
import { CommunityController } from '../community/community.controller';
import { CommunityService } from '../community/community.service';
import { CommunityPost } from '../community/schemas/community-post.schema';

// Only in-memory models and fixtures are used: no MongoDB, Gemini, or uploads.
describe('Guest session isolation', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let guestA: AuthSession;
  let guestB: AuthSession;
  let cardB: {
    _id: Types.ObjectId;
    userId: string;
    targetWord: string;
    save: jest.Mock;
    toObject: () => { _id: Types.ObjectId; userId: string; targetWord: string };
  };
  const users = new Map<string, User>();
  const UserModel = model<User>('GuestIsolationTestUser', UserSchema);
  const flashcardModel = {
    findById: jest.fn(),
    find: jest.fn(),
    deleteOne: jest.fn(),
  };
  const postModel = { findById: jest.fn(), findByIdAndDelete: jest.fn() };
  const progress = { getUserProgress: jest.fn(), resetProgress: jest.fn() };
  const coach = { getHistory: jest.fn(), sendMessage: jest.fn() };

  beforeAll(async () => {
    jest.spyOn(UserModel.prototype, 'save').mockImplementation(async function (
      this: User,
    ) {
      await this.validate();
      if ([...users.values()].some((user) => user.email === this.email)) {
        throw new Error('Duplicate fixture email');
      }
      users.set(this._id.toString(), this);
      return this;
    });
    jest.spyOn(UserModel, 'findById').mockImplementation((id: unknown) => {
      const query = {
        exec: () => Promise.resolve(users.get(String(id)) ?? null),
        session: () => query,
      };
      return query as unknown as ReturnType<typeof UserModel.findById>;
    });
    jest.spyOn(UserModel, 'findOne').mockImplementation((query: unknown) => {
      const lookup = query as {
        $or?: Array<{ email?: string; _id?: string }>;
        email?: string;
        _id?: string;
      };
      const matches =
        [...users.values()].find((user) =>
          (lookup.$or ?? [lookup]).some(
            (filter) =>
              (filter.email !== undefined && filter.email === user.email) ||
              (filter._id !== undefined &&
                String(filter._id) === user._id.toString()),
          ),
        ) ?? null;
      return { exec: () => Promise.resolve(matches) } as unknown as ReturnType<
        typeof UserModel.findOne
      >;
    });

    const secret = randomBytes(32).toString('hex');
    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret })],
      controllers: [
        AuthController,
        UsersController,
        ProgressController,
        AiCoachController,
        FlashcardsController,
        CommunityController,
      ],
      providers: [
        { provide: MutationTimeline, useValue: unitTimeline },
        AuthService,
        UsersService,
        JwtStrategy,
        FlashcardsService,
        CommunityService,
        {
          provide: MutationReceipts,
          useValue: {
            scoped: <T>(work: () => T): T => work(),
            execute: <T>(
              _user: unknown,
              _key: unknown,
              _type: unknown,
              _input: unknown,
              work: (session: undefined) => T,
            ): T => work(undefined),
          },
        },
        {
          provide: ConfigService,
          useValue: new ConfigService({ JWT_SECRET: secret }),
        },
        { provide: getModelToken(User.name), useValue: UserModel },
        { provide: getModelToken(Flashcard.name), useValue: flashcardModel },
        { provide: getModelToken(CommunityPost.name), useValue: postModel },
        { provide: SrsCalculatorService, useValue: {} },
        { provide: AiContextService, useValue: {} },
        {
          provide: FlashcardIdempotencyService,
          useValue: {
            execute: (_user, _key, _type, _input, work) => work(),
          },
        },
        { provide: ProgressService, useValue: progress },
        { provide: AiCoachService, useValue: coach },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    // Avoid the unrelated flashcard migration lifecycle hook in this isolated app.
    jest
      .spyOn(module.get(FlashcardsService), 'onModuleInit')
      .mockResolvedValue(undefined);
    jwt = module.get(JwtService);
    await app.init();
  });

  beforeEach(async () => {
    users.clear();
    jest.clearAllMocks();
    guestA = (
      await request(app.getHttpServer() as import('node:http').Server)
        .post('/auth/guest')
        .expect(201)
    ).body as AuthSession;
    guestB = (
      await request(app.getHttpServer() as import('node:http').Server)
        .post('/auth/guest')
        .expect(201)
    ).body as AuthSession;
    cardB = {
      _id: new Types.ObjectId(),
      userId: guestB.user.id,
      targetWord: 'private',
      save: jest.fn(),
      toObject: () => ({
        _id: cardB._id,
        userId: cardB.userId,
        targetWord: cardB.targetWord,
      }),
    };
    flashcardModel.findById.mockImplementation(() =>
      Object.assign(Promise.resolve(cardB), {
        session: () => Promise.resolve(cardB),
      }),
    );
    flashcardModel.find.mockImplementation((query: { userId: string }) => ({
      exec: () =>
        Promise.resolve(query.userId === guestB.user.id ? [cardB] : []),
    }));
    progress.getUserProgress.mockImplementation((userId: string) =>
      Promise.resolve({ userId }),
    );
    progress.resetProgress.mockImplementation((userId: string) =>
      Promise.resolve({ userId }),
    );
    coach.getHistory.mockImplementation((userId: string) =>
      Promise.resolve([{ userId }]),
    );
    coach.sendMessage.mockImplementation((userId: string) =>
      Promise.resolve({ userId }),
    );
    const exec = () =>
      Promise.resolve({
        userId: guestB.user.id,
        text: 'Guest B post',
        save: jest.fn(),
      });
    postModel.findById.mockReturnValue({ session: () => ({ exec }), exec });
  });

  afterAll(async () => {
    await app?.close();
    jest.restoreAllMocks();
  });

  it('creates distinct guest users and JWT subjects from server-generated UUIDs', () => {
    expect(guestA.user.id).not.toBe(guestB.user.id);
    expect(guestA.user.email).not.toBe(guestB.user.email);
    for (const guest of [guestA, guestB]) {
      expect(guest.user.email).toMatch(
        /^guest-[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}@guest\.lingua\.local$/,
      );
      expect(guest.user.isGuest).toBe(true);
      expect(users.get(guest.user.id)?.isGuest).toBe(true);
      expect(jwt.verify<{ sub: string }>(guest.access_token).sub).toBe(
        guest.user.id,
      );
    }
    expect(jwt.verify<{ sub: string }>(guestA.access_token).sub).not.toBe(
      jwt.verify<{ sub: string }>(guestB.access_token).sub,
    );
  });

  it('resolves each bearer token to its corresponding MongoDB user', async () => {
    for (const guest of [guestA, guestB]) {
      const me = await request(
        app.getHttpServer() as import('node:http').Server,
      )
        .get('/users/me')
        .auth(guest.access_token, { type: 'bearer' })
        .expect(200);
      expect(me.body.id).toBe(guest.user.id);
      expect(me.body.email).toBe(guest.user.email);
    }
  });

  it('ignores client-supplied guest identity when creating a session', async () => {
    const next = await request(
      app.getHttpServer() as import('node:http').Server,
    )
      .post('/auth/guest')
      .send({ userId: guestB.user.id, email: guestB.user.email })
      .expect(201);
    expect(next.body.user.id).not.toBe(guestB.user.id);
    expect(next.body.user.email).not.toBe(guestB.user.email);
  });

  it('uses Guest A identity for progress even with Guest B in the URL', async () => {
    const result = await request(
      app.getHttpServer() as import('node:http').Server,
    )
      .get(`/progress/${guestB.user.id}`)
      .auth(guestA.access_token, { type: 'bearer' })
      .expect(200);
    expect(result.body.userId).toBe(guestA.user.id);
  });

  it('existing reset route uses JWT ownership even with Guest B in the URL', async () => {
    const result = await request(
      app.getHttpServer() as import('node:http').Server,
    )
      .delete(`/progress/${guestB.user.id}`)
      .auth(guestA.access_token, { type: 'bearer' })
      .set('X-Idempotency-Key', 'guest-reset')
      .send({ expectedEpoch: 0 })
      .expect(200);
    expect(result.body.userId).toBe(guestA.user.id);
    expect(progress.resetProgress).toHaveBeenCalledWith(
      guestA.user.id,
      0,
      'guest-reset',
    );
    await request(app.getHttpServer() as import('node:http').Server)
      .delete(`/progress/${guestA.user.id}`)
      .expect(401);
    expect(progress.resetProgress).toHaveBeenCalledTimes(1);
  });

  it('uses Guest A identity for AI history even with a Guest B query parameter', async () => {
    const result = await request(
      app.getHttpServer() as import('node:http').Server,
    )
      .get('/ai-coach/history')
      .query({ userId: guestB.user.id, targetLanguage: 'English' })
      .auth(guestA.access_token, { type: 'bearer' })
      .expect(200);
    expect(result.body).toEqual([{ userId: guestA.user.id }]);
  });

  it('does not list Guest B flashcards for Guest A', async () => {
    const result = await request(
      app.getHttpServer() as import('node:http').Server,
    )
      .get('/flashcards/all')
      .query({ userId: guestB.user.id })
      .auth(guestA.access_token, { type: 'bearer' })
      .expect(200);
    expect(result.body).toEqual([]);
    const own = await request(app.getHttpServer() as import('node:http').Server)
      .get('/flashcards/all')
      .auth(guestB.access_token, { type: 'bearer' })
      .expect(200);
    expect(own.body[0].userId).toBe(guestB.user.id);
  });

  it('ignores client guest aliases and preserves historical users only by MongoDB ID', async () => {
    const legacy = await app
      .get(UsersService)
      .create('Legacy Guest', 'guest@lingua.ai', 'placeholder-hash');
    const historicalCard = {
      userId: legacy._id.toString(),
      targetWord: 'historical',
    };
    flashcardModel.find.mockImplementation((query: { userId: string }) => ({
      exec: () =>
        Promise.resolve(
          query.userId === legacy._id.toString()
            ? [{ ...historicalCard, toObject: () => historicalCard }]
            : [],
        ),
    }));
    const result = await request(
      app.getHttpServer() as import('node:http').Server,
    )
      .get('/flashcards/all')
      .query({ userId: 'guest' })
      .auth(guestA.access_token, { type: 'bearer' })
      .expect(200);
    expect(result.body).toEqual([]);
    expect(flashcardModel.find).toHaveBeenLastCalledWith({
      userId: guestA.user.id,
    });
    await expect(app.get(FlashcardsService).getAll('guest')).rejects.toThrow(
      'Authenticated user not found',
    );
    await expect(
      app.get(FlashcardsService).getAll('guest@lingua.ai'),
    ).rejects.toThrow('Authenticated user not found');
    expect(
      await app.get(FlashcardsService).getAll(legacy._id.toString()),
    ).toEqual([{ ...historicalCard, targetLanguage: 'en' }]);
    expect(users.get(legacy._id.toString())).toBe(legacy);
  });

  it('forbids Guest A from editing, deleting, or reviewing Guest B flashcards', async () => {
    const path = `/flashcards/${cardB._id.toString()}`;
    const server = app.getHttpServer() as import('node:http').Server;
    await request(server)
      .put(path)
      .send({ targetWord: 'changed', turkishTranslation: 'test' })
      .auth(guestA.access_token, { type: 'bearer' })
      .expect(403);
    await request(server)
      .delete(path)
      .auth(guestA.access_token, { type: 'bearer' })
      .expect(403);
    await request(server)
      .put(`${path}/review`)
      .send({ score: 5 })
      .auth(guestA.access_token, { type: 'bearer' })
      .expect(403);
    expect(cardB.save).not.toHaveBeenCalled();
    expect(flashcardModel.deleteOne).not.toHaveBeenCalled();
  });

  it('forbids Guest A from editing or deleting Guest B community posts', async () => {
    const path = `/community/posts/${new Types.ObjectId()}`;
    await request(app.getHttpServer() as import('node:http').Server)
      .put(path)
      .set('X-Idempotency-Key', 'guest-edit')
      .send({ text: 'changed', expectedRevision: 0 })
      .auth(guestA.access_token, { type: 'bearer' })
      .expect(403);
    await request(app.getHttpServer() as import('node:http').Server)
      .delete(path)
      .set('X-Idempotency-Key', 'guest-delete')
      .set('X-Resource-Revision', '0')
      .auth(guestA.access_token, { type: 'bearer' })
      .expect(403);
    expect(postModel.findByIdAndDelete).not.toHaveBeenCalled();
  });

  it.each(['placeholder-hash', '!guest-no-password!', 'any-password'])(
    'rejects guest password login with %s',
    async (password) => {
      await request(app.getHttpServer() as import('node:http').Server)
        .post('/auth/login')
        .send({
          email: guestA.user.email,
          password,
        })
        .expect(401);
    },
  );

  it('rejects marked guest login even outside the reserved email namespace', async () => {
    const email = 'marked-guest@example.com';
    const password = 'test-only-passphrase';
    await app
      .get(UsersService)
      .create('Guest', email, await bcrypt.hash(password, 4), true);
    await request(app.getHttpServer() as import('node:http').Server)
      .post('/auth/login')
      .send({ email, password })
      .expect(401);
  });

  it.each(['new@guest.lingua.local', 'new@GUEST.LINGUA.LOCAL'])(
    'rejects registration in the reserved namespace: %s',
    async (email) => {
      await request(app.getHttpServer() as import('node:http').Server)
        .post('/auth/register')
        .send({ name: 'Normal User', email, password: 'test-only-passphrase' })
        .expect(400);
      expect(users.size).toBe(2);
    },
  );

  it('keeps normal registration and correct-password login working', async () => {
    const email = 'normal@example.com';
    const password = 'test-only-passphrase';
    const registered = await request(
      app.getHttpServer() as import('node:http').Server,
    )
      .post('/auth/register')
      .send({ name: 'Normal User', email, password })
      .expect(201);
    expect(users.get((registered.body as AuthSession).user.id)?.isGuest).toBe(
      false,
    );
    await request(app.getHttpServer() as import('node:http').Server)
      .post('/auth/login')
      .send({ email, password: 'wrong-password' })
      .expect(401);
    const loggedIn = await request(
      app.getHttpServer() as import('node:http').Server,
    )
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    expect((loggedIn.body as AuthSession).user.id).toBe(
      (registered.body as AuthSession).user.id,
    );
    expect(
      jwt.verify<{ sub: string }>((loggedIn.body as AuthSession).access_token)
        .sub,
    ).toBe((registered.body as AuthSession).user.id);
  });

  it('defaults existing users without a guest marker to false without a migration', () => {
    const existing = UserModel.hydrate({
      _id: new Types.ObjectId(),
      name: 'Existing',
      email: 'existing@example.com',
      passwordHash: 'fixture',
    });
    expect(existing.isGuest).toBe(false);
  });

  it('does not reuse or delete the historical shared guest record', async () => {
    const legacy = await app
      .get(UsersService)
      .create('Legacy Guest', 'guest@lingua.ai', 'placeholder-hash');
    const next = await request(
      app.getHttpServer() as import('node:http').Server,
    )
      .post('/auth/guest')
      .expect(201);
    expect(next.body.user.id).not.toBe(legacy._id.toString());
    expect(users.get(legacy._id.toString())).toBe(legacy);
  });
});
