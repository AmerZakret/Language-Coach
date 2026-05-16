import type { ProgressState } from '../types/progress';
import { DEFAULT_PROGRESS } from '../types/progress';
import type { TargetLanguage } from '../types/language';

export const getProgressStorageKey = (userKey: string, targetLanguage: TargetLanguage): string => {
  return `progress_${userKey}_${targetLanguage}`;
};

export const loadProgress = (userKey: string, targetLanguage: TargetLanguage): ProgressState => {
  const key = getProgressStorageKey(userKey, targetLanguage);
  const saved = localStorage.getItem(key);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      return { ...DEFAULT_PROGRESS, ...parsed };
    } catch (e) {
      console.error('Failed to parse progress data', e);
    }
  }
  return DEFAULT_PROGRESS;
};

export const saveProgress = (userKey: string, targetLanguage: TargetLanguage, progress: ProgressState): void => {
  const key = getProgressStorageKey(userKey, targetLanguage);
  localStorage.setItem(key, JSON.stringify(progress));
};

export const resetProgress = (userKey: string, targetLanguage: TargetLanguage): void => {
  const key = getProgressStorageKey(userKey, targetLanguage);
  localStorage.removeItem(key);
};
