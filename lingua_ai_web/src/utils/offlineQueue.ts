import { targetLanguageCode } from './targetLanguage';
import { classifySyncFailure, retryDelay, withReplayTimeout, REPLAY_TIMEOUT_MS, InvalidQueuedPayload } from './syncRetryPolicy';
import type { RetryState } from './syncRetryPolicy';
import { acknowledgeCompletion, acknowledgeProgressEpoch, getOwnerProgressEpoch, validProgressEpoch, resetOwnerProgress, saveProgress, loadProgress } from './progressStorage';
import type { ProgressState } from '../types/progress';
import type { TargetLanguage } from '../types/language';
import apiClient from '../api/apiClient';
import type { AxiosRequestConfig } from 'axios';
import { getOfflineQueueSession, isOfflineQueueSessionActive, invalidateCurrentSession } from './queueSession';
import type { QueueSession } from './queueSession';
import { serializeFlashcardMutation } from './flashcardMutation';

export interface OfflineAction extends RetryState {
  readonly id: string;
  readonly type: 'reset-progress' | 'complete-lesson' | 'create-flashcard' | 'update-flashcard' | 'delete-flashcard' | 'review-flashcard';
  readonly ownerNamespace: string;
  readonly payload: any;
  readonly createdAt: string;
  readonly schemaVersion: 1;
}
interface QueueState {
  schemaVersion: 2;
  ownerNamespace: string;
  actions: OfflineAction[];
  tempIds: Record<string, string>;
  // Dispatched creates stay dependency-backed after restart/ambiguous failure;
  // only creates never dispatched may be edited in place or cancelled.
  startedCreates: string[];
  progressRevision?: string;
  failedActions?: OfflineAction[];
}
const QUEUE_STORAGE_KEY = 'linguaai_offline_queue';
const QUARANTINE_STORAGE_KEY = `${QUEUE_STORAGE_KEY}_legacy_unowned`;
const ownerStorageKey = (owner: string) => `${QUEUE_STORAGE_KEY}_${encodeURIComponent(owner)}`;
const drainingOwners = new Set<string>();
const queueListeners = new Set<() => void>();
export const subscribeOfflineQueue = (listener: () => void): (() => void) => {
  queueListeners.add(listener); return () => { queueListeners.delete(listener); };
};
const drainWaiters = new Map<string, Promise<void>>();

function quarantineLegacyQueue(): void {
  const legacy = localStorage.getItem(QUEUE_STORAGE_KEY);
  if (legacy === null) return;
  // Preserve raw ownerless data. No inferred ownership or temp-ID recovery.
  const saved = localStorage.getItem(QUARANTINE_STORAGE_KEY);
  let snapshots: string[] = [];
  if (saved !== null) {
    try {
      const parsed = JSON.parse(saved);
      snapshots = Array.isArray(parsed) && parsed.every(item => typeof item === 'string') ? parsed : [saved];
    } catch { snapshots = [saved]; }
  }
  if (!snapshots.includes(legacy)) snapshots.push(legacy);
  localStorage.setItem(QUARANTINE_STORAGE_KEY, JSON.stringify(snapshots));
  if (localStorage.getItem(QUEUE_STORAGE_KEY) === legacy) localStorage.removeItem(QUEUE_STORAGE_KEY);
}

function readState(owner: string): QueueState {
  quarantineLegacyQueue();
  const raw = localStorage.getItem(ownerStorageKey(owner));
  if (!raw) return { schemaVersion: 2, ownerNamespace: owner, actions: [], tempIds: {}, startedCreates: [] };
  const parsed = JSON.parse(raw);
  // Phase 4A actions migrate without changing IDs, owners, payloads, or order.
  const state: QueueState = Array.isArray(parsed)
    ? { schemaVersion: 2, ownerNamespace: owner, actions: parsed, tempIds: {}, startedCreates: [] } : parsed;
  if (!state || state.schemaVersion !== 2 || state.ownerNamespace !== owner
    || !state.tempIds || typeof state.tempIds !== 'object' || Array.isArray(state.tempIds)
    || Object.values(state.tempIds).some(id => typeof id !== 'string' || !id || id.startsWith('local_'))
    || !Array.isArray(state.startedCreates) || state.startedCreates.some(id => typeof id !== 'string')
    || !Array.isArray(state.actions) || state.actions.some(action => !action
      || action.schemaVersion !== 1 || typeof action.ownerNamespace !== 'string' || !action.ownerNamespace
      || typeof action.createdAt !== 'string' || !Number.isFinite(Date.parse(action.createdAt)))) throw new Error('Offline queue has no supported ownership schema');
  state.failedActions ??= [];
  if (!Array.isArray(state.failedActions) || state.failedActions.some(a => a.ownerNamespace !== owner)) throw new Error('Failed queue owner mismatch');
  return state;
}

// Synchronous record mutations serialize within this JS runtime. localStorage
// does not provide cross-tab atomicity.
function writeState(state: QueueState): void {
  if (state.actions.some(a => a.ownerNamespace !== state.ownerNamespace)) throw new Error('Queue owner mismatch');
  if (state.failedActions?.some(a => a.ownerNamespace !== state.ownerNamespace)) throw new Error('Failed queue owner mismatch');
  localStorage.setItem(ownerStorageKey(state.ownerNamespace), JSON.stringify(state));
  for (const listener of queueListeners) listener();
}
const dependent = (type: string) => ['update-flashcard', 'delete-flashcard', 'review-flashcard'].includes(type);
const cardId = (payload: any): string | undefined => payload.cardId ?? payload.id;
function resolvePayload(state: QueueState, type: string, payload: any): any {
  const value = { ...payload };
  const id = cardId(value);
  const mapped = id && Object.hasOwn(state.tempIds, id) ? state.tempIds[id] : undefined;
  if (dependent(type) && mapped) {
    if ('cardId' in value) value.cardId = mapped;
    if ('id' in value) value.id = mapped;
  }
  return value;
}

// Enrich existing owned completion actions only from recorded lesson metadata
// or a uniquely attributable owner cache. Never invent a score or an owner.
export function preparePendingProgress(owner: string): void {
  const state = readState(owner);
  let changed = false;
  state.actions = state.actions.map(action => {
    if (action.ownerNamespace !== owner || action.type !== 'complete-lesson' || action.payload.targetLanguage) return action;
    const matches: { language: TargetLanguage; reward?: number }[] = [];
    for (const language of ['English', 'German', 'Spanish', 'French', 'Arabic'] as TargetLanguage[]) {
      let catalog: any[] = [];
      try { catalog = JSON.parse(localStorage.getItem(`linguaai_lessons_${language}`) || '[]'); } catch { /* Unusable catalog stays untouched. */ }
      const lesson = Array.isArray(catalog) ? catalog.find(row => row.id === action.payload.lessonId) : undefined;
      if (lesson || loadProgress(owner, language).completedLessonIds.includes(action.payload.lessonId)) {
        matches.push({ language, reward: lesson?.xpReward });
      }
    }
    if (matches.length !== 1) return action; // Unknown/ambiguous context remains retained.
    changed = true;
    return { ...action, payload: { ...action.payload, targetLanguage: matches[0].language,
      ...(typeof matches[0].reward === 'number' ? { xpReward: matches[0].reward } : {}) } };
  });
  if (changed) { state.progressRevision = `migration_${Date.now()}_${Math.random()}`; writeState(state); }
}

export const getProgressQueueRevision = (owner: string): string => readState(owner).progressRevision || '';
export const saveServerProgress = (owner: string, language: TargetLanguage, revision: string, progress: ProgressState): boolean => {
  if (getProgressQueueRevision(owner) !== revision) return false;
  if (!acknowledgeProgressEpoch(owner, progress.progressEpoch)) return false;
  saveProgress(owner, language, progress); return true;
};
export const getFailedOfflineActions = (): OfflineAction[] => readState(getOfflineQueueSession().ownerNamespace).failedActions || [];
export const getProgressQueueActions = (): OfflineAction[] => [...getOfflineQueue(), ...getFailedOfflineActions()];
export function epochForNewProgress(owner: string, forReset = false): number {
  const state = readState(owner);
  if (!forReset && [...state.actions, ...(state.failedActions || [])].some(a => a.type === 'reset-progress'))
    throw new Error('Wait for progress reset acknowledgement before submitting new progress');
  const epoch = getOwnerProgressEpoch(owner);
  if (epoch === undefined) throw new Error('Connect to acknowledge server progress before submitting progress');
  return epoch;
}
export const getOfflineQueue = (): OfflineAction[] => readState(getOfflineQueueSession().ownerNamespace).actions;
export const isPendingBackendCard = (id: string, owner: string): boolean => {
  if (owner === 'local_guest') return false;
  const state = readState(owner);
  return Object.hasOwn(state.tempIds, id)
    || [...state.actions, ...(state.failedActions || [])].some(a => a.type === 'create-flashcard' && a.payload.tempId === id);
};
export const pushToOfflineQueue = (type: OfflineAction['type'], payload: any, ownerNamespace: string): void => {
  const state = readState(ownerNamespace);
  if (type === 'reset-progress') {
    state.actions = state.actions.filter(a => a.type !== 'complete-lesson' && a.type !== 'reset-progress');
    state.failedActions = state.failedActions?.filter(a => a.type !== 'complete-lesson' && a.type !== 'reset-progress');
    // A durable reset barrier is visible before the cache is cleared. An old
    // in-flight completion is cancelled locally; the barrier runs after HTTP.
  }
  const id = cardId(payload);
  if (type === 'delete-flashcard' && state.failedActions?.some(a => a.type === 'create-flashcard' && a.payload.tempId === id)) {
    state.failedActions = state.failedActions.filter(a => !(a.type === 'create-flashcard' && a.payload.tempId === id) && !(dependent(a.type) && cardId(a.payload) === id));
    state.actions = state.actions.filter(a => !(dependent(a.type) && cardId(a.payload) === id));
    writeState(state); return;
  }
  const create = id && state.actions.find(a => a.type === 'create-flashcard' && a.payload.tempId === id);
  if (dependent(type) && create && !state.startedCreates.includes(create.id)) {
    if (type === 'delete-flashcard') {
      state.actions = state.actions.filter(a => a.id !== create.id && !(dependent(a.type) && cardId(a.payload) === id));
      writeState(state); return;
    }
    if (type === 'update-flashcard') {
      // Carry forward separate edits from migrated Phase 4A queues before
      // applying the latest fields and replacing those edits with one create.
      const fields: Record<string, unknown> = {};
      for (const action of state.actions) {
        if (action.type === 'update-flashcard' && cardId(action.payload) === id) Object.assign(fields, action.payload);
      }
      Object.assign(fields, payload);
      delete fields.cardId; delete fields.id; delete fields.tempId; delete fields.userId;
      state.actions = state.actions.filter(a => !(a.type === 'update-flashcard' && cardId(a.payload) === id))
        .map(a => a.id === create.id ? { ...a, payload: { ...a.payload, ...fields } } : a);
      writeState(state); return;
    }
  }
  state.actions.push({ id: `action_${Date.now()}_${Math.random().toString(36).slice(2)}`, type,
    ownerNamespace, payload: resolvePayload(state, type, payload), createdAt: new Date().toISOString(), schemaVersion: 1 });
  if (type === 'complete-lesson' || type === 'reset-progress') state.progressRevision = state.actions.at(-1)!.id;
  writeState(state);
  if (type === 'reset-progress') resetOwnerProgress(ownerNamespace, payload.legacyOwnerNamespace);
};
export const clearOfflineQueue = (): void => {
  const state = readState(getOfflineQueueSession().ownerNamespace);
  state.actions = []; state.startedCreates = [];
  writeState(state); // Keep mappings for cached local IDs.
};

export const processOfflineQueue = async (userId: string, waitForActive = false): Promise<boolean> => {
  const session = getOfflineQueueSession();
  const owner = session.ownerNamespace;
  if (waitForActive && drainWaiters.has(owner)) {
    await drainWaiters.get(owner);
    if (!isOfflineQueueSessionActive(session)) return false;
    return processOfflineQueue(userId, true);
  }
  const initial = readState(owner);
  if (userId !== session.userId || !isOfflineQueueSessionActive(session)
    || initial.actions.some(a => a.ownerNamespace !== owner) || drainingOwners.has(owner)) return false;
  drainingOwners.add(owner);
  let release!: () => void;
  drainWaiters.set(owner, new Promise<void>(resolve => { release = resolve; }));
  let hadFailure = false;
  try {
    // New appends remain for the next drain; acknowledgements use the latest
    // stored state, never replace it with this starting snapshot.
    for (const scheduled of initial.actions) {
      if (!isOfflineQueueSessionActive(session)) return false;
      const state = readState(owner);
      const stored = state.actions.find(a => a.id === scheduled.id);
      if (!stored) continue;
      if (stored.ownerNamespace !== owner) return false;
      if (stored.nextAttemptAt && Date.parse(stored.nextAttemptAt) > Date.now()) return false;
      const action = { ...stored, attemptCount: (stored.attemptCount || 0) + 1,
        lastAttemptAt: new Date().toISOString(), payload: resolvePayload(state, stored.type, stored.payload) };
      // Preserve the wire shape of previously dispatched legacy updates.
      if (action.type === 'update-flashcard' && !stored.attemptCount) {
        action.payload = { ...action.payload, _mutationContract: 2 };
      }
      if (['create-flashcard', 'update-flashcard'].includes(action.type) && !stored.attemptCount) {
        action.payload = { ...action.payload, _languageContract: 1 };
      }
      if (action.type === 'create-flashcard' && action.payload.tempId && !state.startedCreates.includes(action.id)) state.startedCreates.push(action.id);
      state.actions = state.actions.map(a => a.id === action.id ? action : a);
      writeState(state);
      const config: AxiosRequestConfig & { offlineQueueSession: QueueSession } = {
        offlineQueueSession: session,
        timeout: REPLAY_TIMEOUT_MS,
        headers: { 'X-Idempotency-Key': action.id },
      };
      let serverId: string | undefined;
      let completion: any;
      let resetResult: any;
      try {
        const payload = action.payload;
        const id = cardId(payload);
        if (action.type === 'complete-lesson' && state.failedActions?.some(a => a.type === 'reset-progress')) throw new InvalidQueuedPayload('Blocked by failed reset');
        if (dependent(action.type) && (!id || id.startsWith('local_'))) throw new InvalidQueuedPayload('Pending card has no durable server mapping');
        await withReplayTimeout(async signal => {
        config.signal = signal;
        switch (action.type) {
          case 'reset-progress':
            if (!validProgressEpoch(payload.expectedEpoch)) throw new InvalidQueuedPayload('Reset has no acknowledged epoch');
            resetResult = (await apiClient.delete(`/progress/${session.userId}`, { ...config, data: { expectedEpoch: payload.expectedEpoch } })).data;
            if (resetResult?.progressEpoch !== payload.expectedEpoch + 1) throw new InvalidQueuedPayload('Invalid reset acknowledgement');
            break;
          case 'complete-lesson':
            if (!Number.isInteger(payload.score)) throw new InvalidQueuedPayload('Completion has no recorded score');
            if (!validProgressEpoch(payload.progressEpoch)) throw new InvalidQueuedPayload('Completion has no acknowledged epoch');
            completion = (await apiClient.post(`/progress/${session.userId}/complete-lesson`, { lessonId: payload.lessonId, score: payload.score, progressEpoch: payload.progressEpoch }, config)).data?.data;
            if (completion?.progressEpoch !== payload.progressEpoch) throw new InvalidQueuedPayload('Invalid completion acknowledgement');
            break;
          case 'create-flashcard': {
            const response = await apiClient.post('/flashcards', {
              targetWord: payload.targetWord, turkishTranslation: payload.turkishTranslation,
              targetLanguage: payload._languageContract === 1 ? targetLanguageCode(payload.targetLanguage) : payload.targetLanguage, nativeLanguage: payload.nativeLanguage,
              nativeTranslation: payload.nativeTranslation, exampleSentence: payload.exampleSentence, note: payload.note,
            }, config);
            serverId = response.data?._id || response.data?.id;
            if (payload.tempId && (typeof serverId !== 'string' || !serverId || serverId.startsWith('local_'))) throw new Error('Create response has no server card ID');
            break;
          }
          case 'update-flashcard':
            await apiClient.put(`/flashcards/${id}`, serializeFlashcardMutation({ ...payload,
              ...(payload._mutationContract !== 2 ? { nativeLanguage: undefined, nativeTranslation: undefined } : {}),
            }, payload._languageContract === 1), config); break;
          case 'delete-flashcard': await apiClient.delete(`/flashcards/${id}`, config); break;
          case 'review-flashcard': await apiClient.put(`/flashcards/${id}/review`, { score: payload.score }, config); break;
          default: throw new InvalidQueuedPayload('Unsupported queued action');
        }
        });
      } catch (error) {
        if (!isOfflineQueueSessionActive(session)) return false;
        const failure = classifySyncFailure(error);
        const latest = readState(owner);
        const current = latest.actions.find(a => a.id === action.id);
        if (!current) continue; // Reset/cancellation won while HTTP awaited.
        const failed = { ...current, lastErrorCategory: failure.category,
          ...(failure.terminal ? { failedAt: new Date().toISOString(), nextAttemptAt: undefined }
            : { nextAttemptAt: new Date(Date.now() + retryDelay(action.attemptCount)).toISOString() }) };
        if (failure.terminal) {
          const blocked = (a: OfflineAction) => a.id === action.id
            || (action.type === 'create-flashcard' && action.payload.tempId && dependent(a.type) && cardId(a.payload) === action.payload.tempId)
            || (action.type === 'reset-progress' && a.type === 'complete-lesson');
          latest.failedActions = [...(latest.failedActions || []), ...latest.actions.filter(blocked).map(a => a.id === action.id ? failed
            : { ...a, lastErrorCategory: 'dependency', failedAt: new Date().toISOString() })];
          latest.actions = latest.actions.filter(a => !blocked(a));
          if (action.type === 'complete-lesson' || action.type === 'reset-progress') latest.progressRevision = `failed_${action.id}`;
        } else latest.actions = latest.actions.map(a => a.id === action.id ? failed : a);
        writeState(latest);
        if (failure.category === 'authentication') invalidateCurrentSession(session);
        hadFailure = true;
        if (!failure.terminal) return false; // FIFO also protects reset/review dependencies.
        continue; // Unrelated later work can proceed after durable quarantine.
      }
      if (!isOfflineQueueSessionActive(session)) return false;
      const latest = readState(owner);
      if (latest.actions.some(a => a.id === action.id) && action.type === 'complete-lesson') {
        acknowledgeCompletion(owner, action.payload, completion);
        latest.progressRevision = `ack_${action.id}`;
      }
      if (action.type === 'reset-progress') {
        acknowledgeProgressEpoch(owner, resetResult.progressEpoch);
        if (action.payload.legacyOwnerNamespace) resetOwnerProgress(action.payload.legacyOwnerNamespace);
        latest.progressRevision = `ack_${action.id}`;
      }
      if (action.type === 'create-flashcard' && action.payload.tempId) latest.tempIds[action.payload.tempId] = serverId!;
      latest.actions = latest.actions.filter(a => a.id !== action.id)
        .map(a => ({ ...a, payload: resolvePayload(latest, a.type, a.payload) }));
      latest.startedCreates = latest.startedCreates.filter(id => id !== action.id);
      // Mapping, dependent rewrites, and acknowledgement commit in one write.
      writeState(latest);
    }
    return !hadFailure && isOfflineQueueSessionActive(session);
  } finally { drainingOwners.delete(owner); drainWaiters.delete(owner); release(); }
};
