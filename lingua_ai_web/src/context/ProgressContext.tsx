import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { ProgressState } from '../types/progress';
import { DEFAULT_PROGRESS } from '../types/progress';
import { useAuth } from './AuthContext';
import { useSync } from './SyncContext';
import { useNetwork } from './NetworkContext';
import { useTargetLanguage } from './TargetLanguageContext';
import { getUserProgressKey, getLegacyRegisteredProgressKey } from '../utils/userKey';
import { loadProgress, saveProgress, resetOwnerProgress, overlayPendingProgress, getOwnerProgressEpoch, validProgressEpoch, validLessonScore } from '../utils/progressStorage';
import { targetLanguageCode, tryTargetLanguageCode } from '../utils/targetLanguage';
import { classifySyncFailure } from '../utils/syncRetryPolicy';
import { fetchProgress } from '../api/progressApi';
import { epochForNewProgress, getProgressQueueActions, preparePendingProgress, getProgressQueueRevision, saveServerProgress, pushToOfflineQueue, processOfflineQueue } from '../utils/offlineQueue';
import { getOfflineQueueSession, isSessionCurrent } from '../utils/queueSession';
import { withOwnerStorage } from '../utils/browserCoordination';
import { useSessionGuard } from '../utils/useSessionGuard';

interface ProgressContextType {
  progress: ProgressState;
  completeLesson: (lessonId: string, xpReward: number, score: number, lessonLanguage: string) => Promise<void>;
  progressError: { category: string; terminal: boolean } | null;
  reloadProgress: () => void;
  resetProgress: () => Promise<void>;
}
const ProgressContext = createContext<ProgressContextType | undefined>(undefined);

export const ProgressProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isGuest, token } = useAuth();
  const { targetLanguage } = useTargetLanguage();
  const { isOffline } = useNetwork();
  const { syncRevision } = useSync();
  const [progress, setProgress] = useState<ProgressState>(DEFAULT_PROGRESS);
  const [progressError, setProgressError] = useState<{ category: string; terminal: boolean } | null>(null);
  const requestRevision = useRef(0);
  const userKey = getUserProgressKey(user, isGuest, token);
  const legacyUserKey = getLegacyRegisteredProgressKey(user?.email, isGuest);
  const captureContext = useSessionGuard(userKey, targetLanguage);
  const captureOwner = useSessionGuard(userKey);
  const identifier = user?.id || user?.email;
  const backendSession = !!user && !!identifier && (!isGuest || !!token);

  const currentDisplay = useCallback(() => {
    const base = loadProgress(userKey, targetLanguage);
    const actions = getProgressQueueActions().filter(a => a.ownerNamespace === userKey);
    const epoch = getOwnerProgressEpoch(userKey);
    return overlayPendingProgress(base, actions.filter(a => a.type === 'complete-lesson'
      && a.payload._lessonLanguageBound === true
      && tryTargetLanguageCode(a.payload.targetLanguage) === targetLanguageCode(targetLanguage)
      && validProgressEpoch(epoch) && a.payload.progressEpoch === epoch).map(a => a.payload),
      actions.some(a => a.type === 'reset-progress' && validProgressEpoch(epoch) && a.payload.expectedEpoch === epoch));
  }, [userKey, targetLanguage, legacyUserKey]);

  const loadCurrentProgress = useCallback(async () => {
    const isSessionCurrent = captureContext();
    const request = ++requestRevision.current;
    const isCurrent = () => isSessionCurrent() && request === requestRevision.current;
    if (!isCurrent()) return;
    setProgressError(null);
    try { await preparePendingProgress(userKey, legacyUserKey); }
    catch (error) { if (isCurrent()) setProgressError(classifySyncFailure(error)); }
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
        if (backend) await saveServerProgress(userKey, targetLanguage, revision, backend);
      } catch (error) {
        if (!isCurrent()) return;
        setProgressError(classifySyncFailure(error));
        console.error('Progress sync failed', error);
      }
    }
    if (isCurrent()) setProgress(previous => isCurrent() ? currentDisplay() : previous);
  }, [captureContext, currentDisplay, backendSession, identifier, isOffline, userKey, targetLanguage, legacyUserKey]);

  useEffect(() => { void loadCurrentProgress(); }, [loadCurrentProgress, syncRevision]);

  const completeLesson = async (lessonId: string, xpReward: number, score: number, lessonLanguage: string) => {
    const isCurrent = captureOwner();
    if (!isCurrent()) return;
    const language = targetLanguageCode(lessonLanguage);
    if (!validLessonScore(score)) throw new Error('Invalid completion score');
    if (backendSession) {
      // Persist before any HTTP, including ordinary online completion. A retry
      // carries this exact score/action ID; no reconstruction from cached IDs.
      await pushToOfflineQueue('complete-lesson', { lessonId, score, xpReward, targetLanguage: language,
        _lessonLanguageBound: true,
        progressEpoch: epochForNewProgress(userKey) }, userKey, true);
    } else {
      const session = getOfflineQueueSession();
      await withOwnerStorage(userKey, () => {
        if (!isCurrent() || !isSessionCurrent(session)) return;
        const base = loadProgress(userKey, language);
        if (base.available && base.lessonScores?.[lessonId] !== undefined && score <= base.lessonScores[lessonId]) return;
        saveProgress(userKey, language, { ...overlayPendingProgress(base, [{ lessonId, score, xpReward }], false), available: true });
      });
    }
    const displayCurrent = captureContext();
    setProgress(previous => displayCurrent() ? currentDisplay() : previous);
    if (backendSession && !isOffline && isCurrent()) await loadCurrentProgress();
  };

  const handleResetProgress = async () => {
    const isCurrent = captureContext();
    if (!isCurrent()) return;
    ++requestRevision.current;
    if (backendSession) await pushToOfflineQueue('reset-progress', { legacyOwnerNamespace: legacyUserKey,
      expectedEpoch: epochForNewProgress(userKey, true) }, userKey, true);
    else await withOwnerStorage(userKey, () => { if (isCurrent()) resetOwnerProgress(userKey, legacyUserKey); });
    setProgress(previous => isCurrent() ? DEFAULT_PROGRESS : previous);
    if (backendSession && !isOffline && isCurrent()) await loadCurrentProgress();
  };

  return (
    <ProgressContext.Provider value={{ progress, progressError, completeLesson, reloadProgress: loadCurrentProgress, resetProgress: handleResetProgress }}>
      {children}
    </ProgressContext.Provider>
  );
};
export const useProgress = () => {
  const context = useContext(ProgressContext);
  if (!context) throw new Error('useProgress must be used within ProgressProvider');
  return context;
};
