import { mutationRequest } from './mutationRequest';
import { dataTimeline } from '../utils/dataTimeline';
import { targetLanguageCode } from '../utils/targetLanguage';
import apiClient from './apiClient';
import type { ProgressState } from '../types/progress';
import { getSessionRequestConfig } from '../utils/queueSession';
import { parseProgress, validProgressEpoch } from '../utils/progressStorage';

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

export const fetchProgress = async (userId: string, targetLanguage: string): Promise<ProgressState> => {
  const context = dataTimeline.context();
  const response = await apiClient.get<BackendProgressResponse>(`/progress/${userId}`, {
    ...getSessionRequestConfig(),
    params: { targetLanguage: targetLanguageCode(targetLanguage) }
  });
  const data = response.data;
  if (!data || !validProgressEpoch(data.progressEpoch) || !Array.isArray(data.completedLessons)) {
    throw new Error('Invalid progress response');
  }
  const progress = parseProgress({
    dataTimelineId: context.dataTimelineId,
    progressEpoch: data.progressEpoch,
    totalXp: data.stats?.totalXp,
    streak: data.stats?.streak,
    completedLessonIds: data.completedLessons.map((l) => l.lessonId),
    lessonScores: Object.fromEntries(data.completedLessons.filter(l => l.score !== undefined).map(l => [l.lessonId, l.score])),
    weeklyActivity: [0, 0, 0, 0, 0, 0, 0], // Default fallback
  });
  if (!progress) throw new Error('Invalid progress response');
  return progress;
};

export const saveProgressToBackend = async (userId: string, lessonId: string, score: number, progressEpoch: number, operation = dataTimeline.capture()): Promise<void> => {
  await apiClient.post(`/progress/${userId}/complete-lesson`, { lessonId, score, progressEpoch }, { ...getSessionRequestConfig(), ...operation });
};

export const resetProgressInBackend = async (userId: string, expectedEpoch: number, operationId: string): Promise<void> => {
  await mutationRequest(operationId, config => apiClient.delete(`/progress/${userId}`, { ...config, data: { expectedEpoch } }), `progress-reset:${userId}`);
};
