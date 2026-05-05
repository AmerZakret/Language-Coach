import { apiClient } from './apiClient';

export interface ProgressStats {
  totalXp: number;
  streak: number;
  completedLessonsCount: number;
}

export interface CompletedLesson {
  lessonId: string;
  score: number;
  completedAt: string;
}

export interface Progress {
  userId: string;
  stats: ProgressStats;
  completedLessons: CompletedLesson[];
  level: string;
}

export const progressApi = {
  getUserProgress: async (userId: string) => {
    try {
      const response = await apiClient.get<Progress>(`/progress/${userId}`);
      return response.data;
    } catch (error) {
      console.error(`progressApi.getUserProgress(${userId}) error:`, error);
      throw error;
    }
  },
  completeLesson: async (userId: string, lessonId: string, score: number) => {
    try {
      const response = await apiClient.post(`/progress/${userId}/complete-lesson`, { lessonId, score });
      return response.data;
    } catch (error) {
      console.error("progressApi.completeLesson error:", error);
      throw error;
    }
  }
};
