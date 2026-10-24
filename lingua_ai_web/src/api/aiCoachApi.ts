import { prepareOnlineIntent } from '../utils/onlineIntents';
import { getSessionRequestConfig, isSessionCurrent } from '../utils/queueSession';
import { durableMutation, recoverBeforeRead } from './intentRecovery';
import { targetLanguageCode } from '../utils/targetLanguage';
import apiClient from './apiClient';
import type { TargetLanguage, TargetLanguageCode, InterfaceLanguage } from '../types/language';

export interface ChatMessage {
  _id?: string;
  role: 'user' | 'assistant';
  message: string;
  createdAt?: string;
}

interface ChatRequest {
  message: string;
  language: InterfaceLanguage;
  targetLanguage: TargetLanguage | TargetLanguageCode;
}

interface ChatResponse {
  reply: string;
  correction?: string;
  userMessage?: ChatMessage;
  assistantMessage?: ChatMessage;
}

export const prepareSendMessage = (data: ChatRequest) => {
  const target = targetLanguageCode(data.targetLanguage);
  return prepareOnlineIntent('ai-send', target, { ...data, targetLanguage: target });
};

export const sendMessage = async (data: ChatRequest, operationId?: string): Promise<ChatResponse> => {
  const target = targetLanguageCode(data.targetLanguage);
  return durableMutation<ChatResponse>('ai-send', target, { ...data, targetLanguage: target }, operationId);
};

export const getChatHistory = async (targetLanguage: TargetLanguage | TargetLanguageCode): Promise<ChatMessage[]> => {
  const session = getSessionRequestConfig().sessionSnapshot;
  await recoverBeforeRead('ai', targetLanguageCode(targetLanguage));
  if (!isSessionCurrent(session)) throw new Error('Chat session changed');
  const response = await apiClient.get<ChatMessage[]>(`/ai-coach/history`, {
    ...{ sessionSnapshot: session },
    params: { targetLanguage: targetLanguageCode(targetLanguage) }
  });
  return response.data;
};

export const clearChatHistory = async (targetLanguage: TargetLanguage | TargetLanguageCode, operationId?: string): Promise<void> => {
  const target = targetLanguageCode(targetLanguage);
  await durableMutation('ai-clear', target, { targetLanguage: target }, operationId);
};

export interface WritingCorrectionRequest {
  topic: string;
  text: string;
  language: InterfaceLanguage;
  targetLanguage: TargetLanguage | TargetLanguageCode;
}

// Percentage scores (0-100) may include decimals.
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
  const response = await apiClient.post<WritingCorrectionResponse>('/ai-coach/writing-check', { ...data, targetLanguage: targetLanguageCode(data.targetLanguage) });
  const result = response.data;
  if (!result || ['grammarScore', 'vocabularyScore', 'clarityScore', 'overallScore'].some(field => {
    const value = result[field as keyof WritingCorrectionResponse];
    return typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100;
  }) || typeof result.feedback !== 'string' || typeof result.improvedVersion !== 'string'
      || !Array.isArray(result.corrections)
      || result.corrections.some(item => !item || ['original', 'correction', 'explanation']
          .some(field => typeof item[field as keyof typeof item] !== 'string'))) {
    throw new Error('The server returned an invalid writing evaluation.');
  }
  return result;
};
