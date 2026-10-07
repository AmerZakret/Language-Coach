import { targetLanguageCode } from '../utils/targetLanguage';
import apiClient from './apiClient';
import type { ProgressState } from '../types/progress';
import { getSessionRequestConfig } from '../utils/queueSession';

interface BackendProgressResponse {
  progressEpoch: number;
  userId: string;
  stats: {
    totalXp: number;
    streak: number;
    completedLessonsCount: number;
  };
  completedLessons: {
    lessonId: string;
    score: number;
    completedAt: string;
  }[];
  level: string;
}

export const fetchProgress = async (userId: string, targetLanguage: string): Promise<ProgressState | null> => {
  try {
    const response = await apiClient.get<BackendProgressResponse>(`/progress/${userId}`, {
      ...getSessionRequestConfig(),
      params: { targetLanguage: targetLanguageCode(targetLanguage) }
    });
    const data = response.data;
    if (!data) return null;
    return {
      progressEpoch: data.progressEpoch,
      totalXp: data.stats?.totalXp ?? 0,
      streak: data.stats?.streak ?? 0,
      completedLessonIds: (data.completedLessons || []).map((l) => l.lessonId),
      weeklyActivity: [0, 0, 0, 0, 0, 0, 0], // Default fallback
    };
  } catch (e) {
    return null;
  }
};

export const saveProgressToBackend = async (userId: string, lessonId: string, score: number, progressEpoch: number): Promise<void> => {
  await apiClient.post(`/progress/${userId}/complete-lesson`, { lessonId, score, progressEpoch }, getSessionRequestConfig());
};

export const resetProgressInBackend = async (userId: string, expectedEpoch: number, operationId: string): Promise<void> => {
  await apiClient.delete(`/progress/${userId}`, { ...getSessionRequestConfig(),
    data: { expectedEpoch }, headers: { 'X-Idempotency-Key': operationId } });
};
