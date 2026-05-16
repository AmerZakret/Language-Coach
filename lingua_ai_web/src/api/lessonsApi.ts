import apiClient from './apiClient';
import type { Lesson } from '../types/lesson';
import type { TargetLanguage } from '../types/language';

export const getLessons = async (targetLanguage: TargetLanguage): Promise<Lesson[]> => {
  const response = await apiClient.get<Lesson[]>(`/lessons?targetLanguage=${targetLanguage}`);
  return response.data;
};

export const getLessonById = async (id: string): Promise<Lesson> => {
  const response = await apiClient.get<Lesson>(`/lessons/${id}`);
  return response.data;
};
