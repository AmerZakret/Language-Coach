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

export const saveProgressToBackend = async (userId: string, lessonId: string, xpReward: number): Promise<void> => {
  await apiClient.post(`/progress/${userId}/complete-lesson`, { lessonId, xpReward });
};
