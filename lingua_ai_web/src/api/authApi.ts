import { targetLanguageCode } from '../utils/targetLanguage';
import apiClient from './apiClient';
import type { User } from '../types/auth';
import { getSessionRequestConfig } from '../utils/queueSession';
import type { QueueSession } from '../utils/queueSession';

export function parsePublicUser(value: unknown): User {
  const user = value as Partial<User> | null;
  if (!user || typeof user.id !== 'string' || !/^[a-f\d]{24}$/i.test(user.id)
    || typeof user.name !== 'string' || typeof user.email !== 'string'
    || typeof user.isGuest !== 'boolean' || typeof user.targetLanguage !== 'string') {
    throw new Error('The server returned an incomplete user profile.');
  }
  return user as User;
}

function parseSession(value: unknown): { access_token: string; user: User } {
  const data = value as { access_token?: unknown; user?: unknown } | null;
  if (!data || typeof data.access_token !== 'string' || !data.access_token.trim()) {
    throw new Error('Authentication returned an incomplete session.');
  }
  return { access_token: data.access_token, user: parsePublicUser(data.user) };
}

export const login = async (email: string, password: string): Promise<{ access_token: string, user: User }> => {
  const response = await apiClient.post('/auth/login', { email, password });
  return parseSession(response.data);
};

export const register = async (name: string, email: string, password: string): Promise<{ access_token: string, user: User }> => {
  const response = await apiClient.post('/auth/register', { name, email, password });
  return parseSession(response.data);
};

export const fetchMe = async (session?: QueueSession): Promise<User> => {
  const response = await apiClient.get<User>('/users/me', session ? { sessionSnapshot: session } : getSessionRequestConfig());
  return parsePublicUser(response.data);
};

export const updateProfile = async (profileData: { name?: string; targetLanguage?: string }): Promise<User> => {
  const response = await apiClient.patch<User>('/users/profile', { ...profileData, ...(profileData.targetLanguage !== undefined ? { targetLanguage: targetLanguageCode(profileData.targetLanguage) } : {}) }, getSessionRequestConfig());
  return parsePublicUser(response.data);
};
