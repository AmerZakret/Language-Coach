import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ProgressState } from '../types/progress';
import { DEFAULT_PROGRESS } from '../types/progress';
import { useAuth } from './AuthContext';
import { useNetwork } from './NetworkContext';
import { useTargetLanguage } from './TargetLanguageContext';
import { getUserProgressKey } from '../utils/userKey';
import { loadProgress, saveProgress, resetProgress as resetLocalProgress } from '../utils/progressStorage';
import { fetchProgress, saveProgressToBackend, resetProgressInBackend } from '../api/progressApi';

interface ProgressContextType {
  progress: ProgressState;
  addXp: (amount: number) => void;
  completeLesson: (lessonId: string, xpReward: number, score: number) => void;
  reloadProgress: () => void;
  resetProgress: () => Promise<void>;
}

const ProgressContext = createContext<ProgressContextType | undefined>(undefined);

export const ProgressProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isGuest } = useAuth();
  const { targetLanguage } = useTargetLanguage();
  const { isOffline } = useNetwork();
  const [progress, setProgress] = useState<ProgressState>(DEFAULT_PROGRESS);

  const userKey = getUserProgressKey(user?.email, isGuest);

  const loadCurrentProgress = useCallback(async () => {
    // 1. Load local data (scoped by userKey + targetLanguage)
    let current = loadProgress(userKey, targetLanguage);

    // 2. If logged in and NOT guest, try to sync with backend
    const identifier = user?.id || user?.email;
    if (user && !isGuest && identifier) {
      try {
        const backendData = await fetchProgress(identifier, targetLanguage);
        if (backendData) {
          // Sync any offline progress to backend
          const backendLessonIds = backendData.completedLessonIds || [];
          const unsyncedLessonIds = current.completedLessonIds.filter(id => !backendLessonIds.includes(id));

          let syncedAny = false;
          for (const lessonId of unsyncedLessonIds) {
            try {
              await saveProgressToBackend(identifier, lessonId, 100);
              syncedAny = true;
              console.log(`Synced offline completion for lesson ${lessonId} to backend.`);
            } catch (e) {
              console.error(`Failed to sync offline lesson ${lessonId} to backend`, e);
            }
          }

          if (syncedAny) {
            // Refetch after sync
            const updatedBackendData = await fetchProgress(identifier, targetLanguage);
            if (updatedBackendData) {
              current = updatedBackendData;
            }
          } else {
            // Overwrite with backend data
            current = backendData;
          }
          saveProgress(userKey, targetLanguage, current);
        }
      } catch (e) {
        console.error('Failed to sync progress with backend', e);
      }
    }

    setProgress(current);
  }, [userKey, targetLanguage, user, isGuest]);

  useEffect(() => {
    loadCurrentProgress();
  }, [loadCurrentProgress, targetLanguage, userKey]); // Re-load when language or user changes

  useEffect(() => {
    if (!isOffline) {
      loadCurrentProgress();
    }
  }, [isOffline, loadCurrentProgress]);

  const addXp = (amount: number) => {
    setProgress(prev => {
      const updated = { ...prev, totalXp: prev.totalXp + amount };
      saveProgress(userKey, targetLanguage, updated);
      return updated;
    });
  };

  const completeLesson = async (lessonId: string, xpReward: number, score: number = 100) => {
    // Check if already completed in the current progress state
    if (progress.completedLessonIds.includes(lessonId)) {
       return;
    }

    // Sync to backend if logged in (also for guests with a token)
    const identifier = user?.id || user?.email;
    const hasToken = !!localStorage.getItem('linguaai_token');
    
    if (user && identifier && ((!isGuest) || hasToken)) {
      try {
        await saveProgressToBackend(identifier, lessonId, score);
        // Successful sync! Reload progress from backend to get official calculated XP and level
        const backendData = await fetchProgress(identifier, targetLanguage);
        if (backendData) {
          setProgress(backendData);
          saveProgress(userKey, targetLanguage, backendData);
        }
      } catch (e) {
        console.error('Failed to sync lesson completion to backend, falling back to local update', e);
        // If offline/error, fall back to local update
        const updated = {
          ...progress,
          totalXp: progress.totalXp + xpReward,
          completedLessonIds: [...progress.completedLessonIds, lessonId],
        };
        setProgress(updated);
        saveProgress(userKey, targetLanguage, updated);
      }
    } else {
      // Guest/offline without backend sync
      const updated = {
        ...progress,
        totalXp: progress.totalXp + xpReward,
        completedLessonIds: [...progress.completedLessonIds, lessonId],
      };
      setProgress(updated);
      saveProgress(userKey, targetLanguage, updated);
    }
  };

  const handleResetProgress = async () => {
    // 1. Clear local progress storage
    resetLocalProgress(userKey, targetLanguage);

    // 2. If logged in and NOT guest, notify backend
    const identifier = user?.id || user?.email;
    if (user && !isGuest && identifier) {
      try {
        await resetProgressInBackend(identifier);
      } catch (e) {
        console.error('Failed to reset progress in backend', e);
      }
    }

    // 3. Reset in-memory state
    setProgress(DEFAULT_PROGRESS);
  };

  return (
    <ProgressContext.Provider value={{ progress, addXp, completeLesson, reloadProgress: loadCurrentProgress, resetProgress: handleResetProgress }}>
      {children}
    </ProgressContext.Provider>
  );
};

export const useProgress = () => {
  const context = useContext(ProgressContext);
  if (!context) throw new Error('useProgress must be used within ProgressProvider');
  return context;
};
