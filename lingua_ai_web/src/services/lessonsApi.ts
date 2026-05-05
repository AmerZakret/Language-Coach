import { apiClient } from './apiClient';

export interface Question {
  id: string;
  text: string;
  options: string[];
  correctAnswer: string;
}

export interface Lesson {
  id: string;
  title: string;
  description: string;
  level: string;
  type: string;
  durationMinutes: number;
  xpReward: number;
  questions?: Question[];
}

export const lessonsApi = {
  getLessons: async () => {
    try {
      const response = await apiClient.get<Lesson[]>('/lessons');
      return response.data;
    } catch (error) {
      console.error("lessonsApi.getLessons error:", error);
      throw error;
    }
  },
  getLessonById: async (id: string) => {
    try {
      const response = await apiClient.get<Lesson>(`/lessons/${id}`);
      return response.data;
    } catch (error) {
      console.error(`lessonsApi.getLessonById(${id}) error:`, error);
      throw error;
    }
  }
};
