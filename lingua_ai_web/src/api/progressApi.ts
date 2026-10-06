import apiClient from './apiClient';
import type { ProgressState } from '../types/progress';
import { getSessionRequestConfig } from '../utils/queueSession';

interface BackendProgressResponse {
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
      params: { targetLanguage }
    });
    const data = response.data;
    if (!data) return null;
    return {
      totalXp: data.stats?.totalXp ?? 0,
      streak: data.stats?.streak ?? 0,
      completedLessonIds: (data.completedLessons || []).map((l) => l.lessonId),
      weeklyActivity: [0, 0, 0, 0, 0, 0, 0], // Default fallback
    };
  } catch (e) {
    return null;
  }
};

export const saveProgressToBackend = async (userId: string, lessonId: string, score: number = 100): Promise<void> => {
  await apiClient.post(`/progress/${userId}/complete-lesson`, { lessonId, score }, getSessionRequestConfig());
};

export const resetProgressInBackend = async (userId: string): Promise<void> => {
  await apiClient.delete(`/progress/${userId}`, getSessionRequestConfig());
};
