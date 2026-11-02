import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Model } from 'mongoose';
import { allLessons } from './data';
import { LessonsService } from './lessons.service';
import { Lesson } from './schemas/lesson.schema';

describe('Lesson ID contract', () => {
  const findOne = jest.fn(({ id }) => ({
    lean: async () => allLessons.find(lesson => lesson.id === id) ?? null,
  }));
  const model = { findOne, find: jest.fn() };
  const service = new LessonsService(model as unknown as Model<Lesson>);

  beforeEach(() => jest.clearAllMocks());

  it.each(['en_b_1', 'de_1', 'es_1', 'fr_1', 'ar_1'])
  ('resolves canonical seed ID %s without altering the response', async id => {
    expect(await service.findOne(id)).toEqual(allLessons.find(lesson => lesson.id === id));
    expect(findOne).toHaveBeenCalledWith({ id });
  });

  it.each(['1', '01', '1garbage', '2', '54', 'en_1', 'missing'])
  ('does not resolve an absent ID or numeric prefix %s as another lesson', async id => {
    expect(await service.findOne(id)).toBeNull();
    expect(findOne).toHaveBeenCalledTimes(1);
    expect(model.find).not.toHaveBeenCalled();
  });

  const clients = [
    ['Flutter', 'lingua_ai/lib/data/dummy_data.dart', /Lesson\(id: '([^']+)', targetLanguage: '([^']+)'/g],
    ['web', 'lingua_ai_web/src/data/fallbackLessons.ts', /id: '([^']+)',\s*targetLanguage: '([^']+)'/g],
  ] as const;

  describe.each(clients)('%s fallback IDs against the actual seed export', (_client, file, pattern) => {
    const source = readFileSync(resolve(__dirname, '../../..', file), 'utf8');
    const lessons = [...source.matchAll(pattern)].map(match => ({ id: match[1], language: match[2] }));

    it.each(['en', 'de', 'es', 'fr', 'ar'])('%s fallback IDs exist and belong to that language', language => {
      const fallback = lessons.filter(lesson => lesson.language === language);
      expect(fallback).toHaveLength(6);
      expect(new Set(fallback.map(lesson => lesson.id)).size).toBe(fallback.length);
      for (const lesson of fallback) {
        expect(allLessons.find(seed => seed.id === lesson.id)?.targetLanguage).toBe(language);
      }
    });
  });
});
