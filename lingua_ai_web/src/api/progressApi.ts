import apiClient from './apiClient';
import type { ProgressState } from '../types/progress';

export const fetchProgress = async (userId: string): Promise<ProgressState | null> => {
  try {
    const response = await apiClient.get<ProgressState>(`/progress/${userId}`);
    return response.data;
  } catch (e) {
    return null;
  }
};

export const saveProgressToBackend = async (userId: string, lessonId: string, score: number = 100): Promise<void> => {
  await apiClient.post(`/progress/${userId}/complete-lesson`, { lessonId, score });
};

export const resetProgressInBackend = async (userId: string): Promise<void> => {
  await apiClient.delete(`/progress/${userId}`);
};
