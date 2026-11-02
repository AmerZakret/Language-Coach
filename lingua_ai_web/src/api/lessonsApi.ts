import apiClient from './apiClient';
import { isAxiosError } from 'axios';
import type { Lesson } from '../types/lesson';
import type { TargetLanguage } from '../types/language';
import { isLessonLanguageCode, lessonLanguageCode } from '../utils/lessonLanguage';

export class LessonNotFoundError extends Error {
  readonly id: string;

  constructor(id: string) {
    super(`Lesson not found: ${id}`);
    this.name = 'LessonNotFoundError';
    this.id = id;
  }
}

const parseLesson = (data: Lesson): Lesson => {
  if (!data || typeof data !== 'object' || 'error' in data ||
      typeof data.id !== 'string' || !data.id ||
      typeof data.title !== 'string' || !data.title ||
      !isLessonLanguageCode(data.targetLanguage)) {
    throw new Error('Invalid lesson response');
  }
  return data;
};

export const getLessons = async (targetLanguage: TargetLanguage): Promise<Lesson[]> => {
  const response = await apiClient.get<Lesson[]>(`/lessons?targetLanguage=${lessonLanguageCode(targetLanguage)}`);
  return response.data.map(parseLesson);
};

export const getLessonById = async (id: string): Promise<Lesson> => {
  try {
    const response = await apiClient.get<Lesson>(`/lessons/${id}`);
    const lesson = parseLesson(response.data);
    if (lesson.id !== id || !Array.isArray(lesson.questions)) {
      throw new Error('Invalid lesson details');
    }
    return lesson;
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) {
      throw new LessonNotFoundError(id);
    }
    throw error;
  }
};
