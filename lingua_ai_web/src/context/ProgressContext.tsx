import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ProgressState } from '../types/progress';
import { DEFAULT_PROGRESS } from '../types/progress';
import { useAuth } from './AuthContext';
import { useTargetLanguage } from './TargetLanguageContext';
import { getUserProgressKey } from '../utils/userKey';
import { loadProgress, saveProgress } from '../utils/progressStorage';
import { fetchProgress, saveProgressToBackend } from '../api/progressApi';

interface ProgressContextType {
  progress: ProgressState;
  addXp: (amount: number) => void;
  completeLesson: (lessonId: string, xpReward: number) => void;
  reloadProgress: () => void;
}

const ProgressContext = createContext<ProgressContextType | undefined>(undefined);

export const ProgressProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isGuest } = useAuth();
  const { targetLanguage } = useTargetLanguage();
  const [progress, setProgress] = useState<ProgressState>(DEFAULT_PROGRESS);

  const userKey = getUserProgressKey(user?.email, isGuest);

  const loadCurrentProgress = useCallback(async () => {
    // 1. Load local data (scoped by userKey + targetLanguage)
    let current = loadProgress(userKey, targetLanguage);

    // 2. If logged in and NOT guest, try to sync with backend
    if (user && !isGuest && user.email) {
      const backendData = await fetchProgress(user.email);
      if (backendData) {
        // Simple merge: remote wins for simplicity or higher XP wins
        current = {
          ...current,
          totalXp: Math.max(current.totalXp, backendData.totalXp || 0),
          streak: Math.max(current.streak, backendData.streak || 0),
          completedLessonIds: Array.from(new Set([...current.completedLessonIds, ...(backendData.completedLessonIds || [])]))
        };
      }
    }

    setProgress(current);
  }, [userKey, targetLanguage, user, isGuest]);

  useEffect(() => {
    loadCurrentProgress();
  }, [loadCurrentProgress, targetLanguage, userKey]); // Re-load when language or user changes

  const addXp = (amount: number) => {
    setProgress(prev => {
      const updated = { ...prev, totalXp: prev.totalXp + amount };
      saveProgress(userKey, targetLanguage, updated);
      return updated;
    });
  };

  const completeLesson = async (lessonId: string, xpReward: number) => {
    // Check if already completed in the current progress state
    if (progress.completedLessonIds.includes(lessonId)) {
       // Optional: Still allow XP if we want, but instructions say mark as completed
       return;
    }

    const updated = {
      ...progress,
      totalXp: progress.totalXp + xpReward,
      completedLessonIds: [...progress.completedLessonIds, lessonId],
    };

    setProgress(updated);
    saveProgress(userKey, targetLanguage, updated);

    // Sync to backend if logged in
    if (user && !isGuest && user.email) {
      try {
        await saveProgressToBackend(user.email, lessonId, xpReward);
      } catch (e) {
        console.error('Failed to sync lesson completion to backend', e);
      }
    }
  };

  return (
    <ProgressContext.Provider value={{ progress, addXp, completeLesson, reloadProgress: loadCurrentProgress }}>
      {children}
    </ProgressContext.Provider>
  );
};

export const useProgress = () => {
  const context = useContext(ProgressContext);
  if (!context) throw new Error('useProgress must be used within ProgressProvider');
  return context;
};
