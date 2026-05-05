import { apiClient } from './apiClient';

export interface ChatRequest {
  userId: string;
  message: string;
  language: string;
}

export interface ChatResponse {
  reply: string;
  correction: string;
  saved: boolean;
}

export const aiCoachApi = {
  chat: async (request: ChatRequest) => {
    try {
      const response = await apiClient.post<ChatResponse>('/ai-coach/chat', request);
      return response.data;
    } catch (error) {
      console.error("aiCoachApi.chat error:", error);
      throw error;
    }
  }
};
