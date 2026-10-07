import type { ProgressState } from '../types/progress';
import { DEFAULT_PROGRESS } from '../types/progress';
import type { TargetLanguage } from '../types/language';

export const validProgressEpoch = (epoch: unknown): epoch is number =>
  typeof epoch === 'number' && Number.isSafeInteger(epoch) && epoch >= 0;
const epochKey = (owner: string) => `progress_epoch_${owner}`;
export function getOwnerProgressEpoch(owner: string): number | undefined {
  if (owner === 'local_guest') return undefined;
  const raw = localStorage.getItem(epochKey(owner));
  if (raw === null || !/^(0|[1-9]\d*)$/.test(raw)) return undefined;
  const value = Number(raw);
  return validProgressEpoch(value) ? value : undefined;
}
// Called only under the existing session guard / synchronous queue mutation.
export function acknowledgeProgressEpoch(owner: string, epoch: unknown): boolean {
  if (owner === 'local_guest' || !validProgressEpoch(epoch)) return false;
  const current = getOwnerProgressEpoch(owner);
  if (current !== undefined && epoch < current) return false;
  if (current === epoch) return true;
  resetOwnerProgress(owner);
  localStorage.setItem(epochKey(owner), String(epoch));
  return true;
}

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

// This cache contains acknowledged server data, never pending XP. Pending
// completion payloads stay in the existing owner queue and are overlaid afresh.
export function overlayPendingProgress(base: ProgressState, payloads: any[], resetPending: boolean): ProgressState {
  const state = { ...(resetPending ? DEFAULT_PROGRESS : base),
    completedLessonIds: [...(resetPending ? [] : base.completedLessonIds)] };
  for (const payload of payloads) {
    if (!state.completedLessonIds.includes(payload.lessonId)) {
      state.completedLessonIds.push(payload.lessonId);
      state.totalXp += payload.xpReward ?? 0;
    }
  }
  return state;
}

export function acknowledgeCompletion(owner: string, payload: any, result: any): void {
  if (!payload.targetLanguage || typeof result?.newTotalXp !== 'number'
    || !acknowledgeProgressEpoch(owner, result?.progressEpoch)) return;
  const language = payload.targetLanguage as TargetLanguage;
  const base = loadProgress(owner, language);
  saveProgress(owner, language, { ...base, totalXp: result.newTotalXp,
    completedLessonIds: [...new Set([...base.completedLessonIds, payload.lessonId])] });
}

export function resetOwnerProgress(owner: string, legacyOwner?: string): void {
  for (const language of ['English', 'German', 'Spanish', 'French', 'Arabic'] as TargetLanguage[]) {
    resetProgress(owner, language);
    if (legacyOwner) resetProgress(legacyOwner, language);
  }
}
