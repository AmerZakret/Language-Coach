import apiClient from './apiClient';
import type { User } from '../types/auth';

export const login = async (email: string, password: string): Promise<{ access_token: string, user: User }> => {
  const response = await apiClient.post('/auth/login', { email, password });
  return response.data;
};

export const register = async (name: string, email: string, password: string): Promise<{ access_token: string, user: User }> => {
  const response = await apiClient.post('/auth/register', { name, email, password });
  return response.data;
};

export const fetchMe = async (): Promise<User> => {
  const response = await apiClient.get<User>('/users/me');
  return response.data;
};

export const updateProfile = async (profileData: { name?: string; targetLanguage?: string }): Promise<User> => {
  const response = await apiClient.patch<User>('/users/profile', profileData);
  return response.data;
};
