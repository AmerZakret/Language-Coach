import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { ProgressState } from '../types/progress';
import { DEFAULT_PROGRESS } from '../types/progress';
import { useAuth } from './AuthContext';
import { useNetwork } from './NetworkContext';
import { useTargetLanguage } from './TargetLanguageContext';
import { getUserProgressKey, getLegacyRegisteredProgressKey } from '../utils/userKey';
import { loadProgress, saveProgress, resetOwnerProgress, overlayPendingProgress } from '../utils/progressStorage';
import { fetchProgress } from '../api/progressApi';
import { getOfflineQueue, preparePendingProgress, getProgressQueueRevision, saveServerProgress, pushToOfflineQueue, processOfflineQueue } from '../utils/offlineQueue';
import { useSessionGuard } from '../utils/useSessionGuard';

interface ProgressContextType {
  progress: ProgressState;
  addXp: (amount: number) => void;
  completeLesson: (lessonId: string, xpReward: number, score: number) => void;
  reloadProgress: () => void;
  resetProgress: () => Promise<void>;
}
const ProgressContext = createContext<ProgressContextType | undefined>(undefined);

export const ProgressProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isGuest, token } = useAuth();
  const { targetLanguage } = useTargetLanguage();
  const { isOffline } = useNetwork();
  const [progress, setProgress] = useState<ProgressState>(DEFAULT_PROGRESS);
  const requestRevision = useRef(0);
  const userKey = getUserProgressKey(user, isGuest, token);
  const legacyUserKey = getLegacyRegisteredProgressKey(user?.email, isGuest);
  const captureContext = useSessionGuard(userKey, targetLanguage);
  const identifier = user?.id || user?.email;
  const backendSession = !!user && !!identifier && (!isGuest || !!token);

  const currentDisplay = useCallback(() => {
    const base = loadProgress(userKey, targetLanguage, legacyUserKey);
    preparePendingProgress(userKey);
    const actions = getOfflineQueue().filter(a => a.ownerNamespace === userKey);
    return overlayPendingProgress(base, actions.filter(a => a.type === 'complete-lesson'
      && a.payload.targetLanguage === targetLanguage).map(a => a.payload),
      actions.some(a => a.type === 'reset-progress'));
  }, [userKey, targetLanguage, legacyUserKey]);

  const loadCurrentProgress = useCallback(async () => {
    const isSessionCurrent = captureContext();
    const request = ++requestRevision.current;
    const isCurrent = () => isSessionCurrent() && request === requestRevision.current;
    if (!isCurrent()) return;
    setProgress(previous => isCurrent() ? currentDisplay() : previous);
    if (backendSession && !isOffline) {
      try {
        await processOfflineQueue(identifier!, true);
        if (!isCurrent()) return;
        const revision = getProgressQueueRevision(userKey);
        const backend = await fetchProgress(identifier!, targetLanguage);
        if (!isCurrent()) return;
        // A newer append/ack/reset while GET awaited must win over its snapshot.
        if (backend) saveServerProgress(userKey, targetLanguage, revision, backend);
      } catch (error) {
        if (!isCurrent()) return;
        console.error('Progress sync failed', error);
      }
    }
    if (isCurrent()) setProgress(previous => isCurrent() ? currentDisplay() : previous);
  }, [captureContext, currentDisplay, backendSession, identifier, isOffline, userKey, targetLanguage]);

  useEffect(() => { void loadCurrentProgress(); }, [loadCurrentProgress]);

  const addXp = (amount: number) => {
    const isCurrent = captureContext();
    if (!isCurrent()) return;
    const base = loadProgress(userKey, targetLanguage);
    saveProgress(userKey, targetLanguage, { ...base, totalXp: base.totalXp + amount });
    setProgress(previous => isCurrent() ? currentDisplay() : previous);
  };

  const completeLesson = async (lessonId: string, xpReward: number, score = 100) => {
    const isCurrent = captureContext();
    if (!isCurrent() || currentDisplay().completedLessonIds.includes(lessonId)) return;
    if (backendSession) {
      // Persist before any HTTP, including ordinary online completion. A retry
      // carries this exact score/action ID; no reconstruction from cached IDs.
      pushToOfflineQueue('complete-lesson', { lessonId, score, xpReward, targetLanguage }, userKey);
    } else {
      const base = loadProgress(userKey, targetLanguage);
      saveProgress(userKey, targetLanguage, { ...base, totalXp: base.totalXp + xpReward,
        completedLessonIds: [...base.completedLessonIds, lessonId] });
    }
    setProgress(previous => isCurrent() ? currentDisplay() : previous);
    if (backendSession && !isOffline && isCurrent()) await loadCurrentProgress();
  };

  const handleResetProgress = async () => {
    const isCurrent = captureContext();
    if (!isCurrent()) return;
    ++requestRevision.current;
    if (backendSession) pushToOfflineQueue('reset-progress', { legacyOwnerNamespace: legacyUserKey }, userKey);
    else resetOwnerProgress(userKey, legacyUserKey);
    setProgress(previous => isCurrent() ? DEFAULT_PROGRESS : previous);
    if (backendSession && !isOffline && isCurrent()) await loadCurrentProgress();
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
