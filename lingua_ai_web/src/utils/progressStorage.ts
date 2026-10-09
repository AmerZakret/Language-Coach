import type { ProgressState } from '../types/progress';
import { DEFAULT_PROGRESS } from '../types/progress';
import type { TargetLanguage } from '../types/language';
import { targetLanguageName, targetLanguageCode, TARGET_LANGUAGE_NAMES, tryTargetLanguageCode } from './targetLanguage';

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

export const getProgressStorageKey = (userKey: string, targetLanguage: string): string => {
  return `progress_${userKey}_${targetLanguageName(targetLanguage)}`;
};

export const validLessonScore = (score: unknown): score is number =>
  typeof score === 'number' && Number.isInteger(score) && score >= 0 && score <= 100;
export function parseProgress(value: any): ProgressState | undefined {
  if (!value || !validProgressEpoch(value.totalXp) || !validProgressEpoch(value.streak)
    || !Array.isArray(value.completedLessonIds) || value.completedLessonIds.some((id: any) => typeof id !== 'string' || !id)
    || !Array.isArray(value.weeklyActivity) || value.weeklyActivity.some((n: any) => typeof n !== 'number' || !Number.isFinite(n) || n < 0)
    || (value.progressEpoch !== undefined && !validProgressEpoch(value.progressEpoch))
    || value.available === false) return undefined;
  const scores = value.lessonScores ?? {};
  if (!scores || Array.isArray(scores) || typeof scores !== 'object' || Object.entries(scores).some(([id, score]) =>
    !value.completedLessonIds.includes(id) || !validLessonScore(score))) return undefined;
  return { ...value, available: true, completedLessonIds: [...new Set<string>(value.completedLessonIds)],
    weeklyActivity: [...value.weeklyActivity], lessonScores: { ...scores } };
}

export const loadProgress = (userKey: string, targetLanguage: string, legacyRegisteredKey?: string): ProgressState => {
  const key = getProgressStorageKey(userKey, targetLanguage);
  let saved = localStorage.getItem(key);
  if (saved === null) saved = localStorage.getItem(`progress_${userKey}_${targetLanguageCode(targetLanguage)}`);
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
      const progress = parseProgress(parsed);
      const epoch = getOwnerProgressEpoch(userKey);
      if (progress && (epoch === undefined || progress.progressEpoch === undefined || progress.progressEpoch === epoch)) return progress;
    } catch (e) {
      console.error('Failed to parse progress data', e);
    }
  }
  return DEFAULT_PROGRESS;
};

export const saveProgress = (userKey: string, targetLanguage: string, progress: ProgressState): void => {
  const parsed = parseProgress(progress);
  if (!parsed) throw new Error('Unavailable or invalid progress cannot be acknowledged');
  const key = getProgressStorageKey(userKey, targetLanguage);
  localStorage.setItem(key, JSON.stringify(parsed));
};

export const resetProgress = (userKey: string, targetLanguage: TargetLanguage): void => {
  const key = getProgressStorageKey(userKey, targetLanguage);
  localStorage.removeItem(key);
};

// This cache contains acknowledged server data, never pending XP. Pending
// completion payloads stay in the existing owner queue and are overlaid afresh.
export function overlayPendingProgress(base: ProgressState, payloads: any[], resetPending: boolean): ProgressState {
  const state = { ...(resetPending ? DEFAULT_PROGRESS : base),
    completedLessonIds: [...(resetPending ? [] : base.completedLessonIds)],
    lessonScores: { ...(resetPending ? {} : base.lessonScores) } };
  for (const payload of payloads) {
    if (typeof payload.lessonId !== 'string' || !payload.lessonId ||
      (payload.xpReward !== undefined && !validProgressEpoch(payload.xpReward))) continue;
    if (!state.completedLessonIds.includes(payload.lessonId)) {
      const nextXp = state.totalXp + (payload.xpReward ?? 0);
      if (!validProgressEpoch(nextXp)) continue;
      state.completedLessonIds.push(payload.lessonId);
      state.totalXp = nextXp;
    }
    if (validLessonScore(payload.score) && payload.score > (state.lessonScores[payload.lessonId] ?? -1)) {
      state.lessonScores[payload.lessonId] = payload.score;
    }
  }
  return state;
}

export function acknowledgeCompletion(owner: string, payload: any, result: any): void {
  if (result?.newTotalXp === undefined) return; // Receipt only; no resource to cache.
  if (!validProgressEpoch(result.newTotalXp) ||
      (result.score !== undefined && !validLessonScore(result.score))) throw new Error('Invalid completion acknowledgement');
  const actualLanguage = result.targetLanguage ?? (payload._lessonLanguageBound === true ? payload.targetLanguage : undefined);
  if (!tryTargetLanguageCode(actualLanguage)) return;
  if (!acknowledgeProgressEpoch(owner, result?.progressEpoch)) return;
  const language = targetLanguageName(actualLanguage);
  const base = loadProgress(owner, language);
  saveProgress(owner, language, { ...base, available: true, progressEpoch: result.progressEpoch, totalXp: result.newTotalXp,
    lessonScores: { ...base.lessonScores, ...(validLessonScore(result.score) ? { [payload.lessonId]: result.score } : {}) },
    completedLessonIds: [...new Set([...base.completedLessonIds, payload.lessonId])] });
}

export function resetOwnerProgress(owner: string, legacyOwner?: string): void {
  for (const namespace of [owner, legacyOwner].filter((value): value is string => !!value)) {
    const prefix = `progress_${namespace}_`;
    const knownKeys = [...Object.keys(TARGET_LANGUAGE_NAMES), ...Object.values(TARGET_LANGUAGE_NAMES)].map(language => `${prefix}${language}`);
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix) && tryTargetLanguageCode(key.slice(prefix.length))) knownKeys.push(key);
    }
    for (const key of knownKeys) localStorage.removeItem(key);
  }
}
