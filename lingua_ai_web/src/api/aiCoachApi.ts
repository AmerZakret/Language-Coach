import apiClient from './apiClient';
import type { TargetLanguage, InterfaceLanguage } from '../types/language';

export interface ChatMessage {
  role: 'user' | 'assistant';
  message: string;
  createdAt?: string;
}

interface ChatRequest {
  message: string;
  language: InterfaceLanguage;
  targetLanguage: TargetLanguage;
}

interface ChatResponse {
  reply: string;
  correction?: string;
  userMessage?: ChatMessage;
  assistantMessage?: ChatMessage;
}

export const sendMessage = async (data: ChatRequest): Promise<ChatResponse> => {
  const response = await apiClient.post<ChatResponse>('/ai-coach/chat', data);
  return response.data;
};

export const getChatHistory = async (targetLanguage: TargetLanguage): Promise<ChatMessage[]> => {
  const response = await apiClient.get<ChatMessage[]>(`/ai-coach/history`, {
    params: { targetLanguage }
  });
  return response.data;
};

export const clearChatHistory = async (targetLanguage: TargetLanguage): Promise<void> => {
  await apiClient.delete(`/ai-coach/clear`, {
    params: { targetLanguage }
  });
};

export interface WritingCorrectionRequest {
  topic: string;
  text: string;
  language: InterfaceLanguage;
  targetLanguage: TargetLanguage;
}

export interface WritingCorrectionResponse {
  grammarScore: number;
  vocabularyScore: number;
  clarityScore: number;
  overallScore: number;
  corrections: { original: string; correction: string; explanation: string }[];
  feedback: string;
  improvedVersion: string;
}

export const checkWriting = async (data: WritingCorrectionRequest): Promise<WritingCorrectionResponse> => {
  const response = await apiClient.post<WritingCorrectionResponse>('/ai-coach/writing-check', data);
  return response.data;
};
