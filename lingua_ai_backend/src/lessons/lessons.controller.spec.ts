import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { allLessons } from './data';
import { LessonsController } from './lessons.controller';
import { LessonsService } from './lessons.service';
import { Lesson } from './schemas/lesson.schema';

// Real HTTP/controller/service behavior with seed-backed reads; no database.
describe('Lesson HTTP contract', () => {
  let app: INestApplication;
  const model = {
    countDocuments: async () => allLessons.length,
    findOne: ({ id }: { id: string }) => ({
      lean: async () => allLessons.find(lesson => lesson.id === id) ?? null,
    }),
    find: (filter: { targetLanguage?: string }) => ({
      lean: async () => allLessons.filter(lesson => !filter.targetLanguage || lesson.targetLanguage === filter.targetLanguage),
    }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [LessonsController],
      providers: [LessonsService, { provide: getModelToken(Lesson.name), useValue: model }],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    await app.init();
  });
  afterAll(async () => app?.close());

  it.each(['en_b_1', 'de_1', 'es_1', 'fr_1', 'ar_1'])
  ('GET %s preserves the valid lesson detail and code language', async id => {
    const response = await request(app.getHttpServer()).get(`/lessons/${id}`).expect(200);
    expect(response.body).toEqual(allLessons.find(lesson => lesson.id === id));
    expect(response.body.questions.length).toBeGreaterThan(0);
    expect(['en', 'de', 'es', 'fr', 'ar']).toContain(response.body.targetLanguage);
  });

  it.each(['missing', 'en_1', '1', '01', '1garbage'])
  ('GET %s returns a normal Nest 404, never a success error object', async id => {
    const response = await request(app.getHttpServer()).get(`/lessons/${id}`).expect(404);
    expect(response.body).toEqual({ message: 'Lesson not found', error: 'Not Found', statusCode: 404 });
    expect(response.body).not.toHaveProperty('id');
  });

  it.each(['en', 'de', 'es', 'fr', 'ar'])('list summaries keep %s codes and omit questions', async language => {
    const response = await request(app.getHttpServer()).get('/lessons').query({ targetLanguage: language }).expect(200);
    expect(response.body.length).toBeGreaterThan(0);
    for (const lesson of response.body) {
      expect(lesson.targetLanguage).toBe(language);
      expect(lesson).not.toHaveProperty('questions');
    }
  });
});
