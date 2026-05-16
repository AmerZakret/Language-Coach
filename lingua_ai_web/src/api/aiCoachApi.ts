import apiClient from './apiClient';
import type { TargetLanguage, InterfaceLanguage } from '../types/language';

export interface ChatMessage {
  role: 'user' | 'assistant';
  message: string;
  createdAt?: string;
}

interface ChatRequest {
  userId: string;
  message: string;
  language: InterfaceLanguage;
  targetLanguage: TargetLanguage;
}

interface ChatResponse {
  reply: string;
  correction?: string;
}

export const sendMessage = async (data: ChatRequest): Promise<ChatResponse> => {
  const response = await apiClient.post<ChatResponse>('/ai-coach/chat', data);
  return response.data;
};

export const getChatHistory = async (userId: string, targetLanguage: TargetLanguage): Promise<ChatMessage[]> => {
  const response = await apiClient.get<ChatMessage[]>(`/ai-coach/history`, {
    params: { userId, targetLanguage }
  });
  return response.data;
};

export const clearChatHistory = async (userId: string, targetLanguage: TargetLanguage): Promise<void> => {
  await apiClient.delete(`/ai-coach/clear`, {
    params: { userId, targetLanguage }
  });
};
