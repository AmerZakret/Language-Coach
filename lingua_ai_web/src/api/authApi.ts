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
