import type { ProgressState } from '../types/progress';
import { DEFAULT_PROGRESS } from '../types/progress';
import type { TargetLanguage } from '../types/language';

export const getProgressStorageKey = (userKey: string, targetLanguage: TargetLanguage): string => {
  return `progress_${userKey}_${targetLanguage}`;
};

export const loadProgress = (userKey: string, targetLanguage: TargetLanguage, legacyRegisteredKey?: string): ProgressState => {
  const key = getProgressStorageKey(userKey, targetLanguage);
  let saved = localStorage.getItem(key);
  // Migrate only a registered user's attributable email cache, never shared guest data.
  if (legacyRegisteredKey) {
    const legacyKey = getProgressStorageKey(legacyRegisteredKey, targetLanguage);
    if (saved === null) {
      saved = localStorage.getItem(legacyKey);
      if (saved !== null) localStorage.setItem(key, saved);
    }
    // Retire the legacy key so resetting progress cannot resurrect the old cache.
    if (saved !== null) localStorage.removeItem(legacyKey);
  }
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
