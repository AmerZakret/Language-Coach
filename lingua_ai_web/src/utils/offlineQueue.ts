import { acknowledgeCompletion, resetOwnerProgress, saveProgress, loadProgress } from './progressStorage';
import type { ProgressState } from '../types/progress';
import type { TargetLanguage } from '../types/language';
import apiClient from '../api/apiClient';
import type { AxiosRequestConfig } from 'axios';
import { getOfflineQueueSession, isOfflineQueueSessionActive } from './queueSession';
import type { QueueSession } from './queueSession';

export interface OfflineAction {
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
}
const QUEUE_STORAGE_KEY = 'linguaai_offline_queue';
const QUARANTINE_STORAGE_KEY = `${QUEUE_STORAGE_KEY}_legacy_unowned`;
const ownerStorageKey = (owner: string) => `${QUEUE_STORAGE_KEY}_${encodeURIComponent(owner)}`;
const drainingOwners = new Set<string>();
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
  return state;
}

// Synchronous record mutations serialize within this JS runtime. localStorage
// does not provide cross-tab atomicity.
function writeState(state: QueueState): void {
  if (state.actions.some(a => a.ownerNamespace !== state.ownerNamespace)) throw new Error('Queue owner mismatch');
  localStorage.setItem(ownerStorageKey(state.ownerNamespace), JSON.stringify(state));
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
  saveProgress(owner, language, progress); return true;
};
export const getOfflineQueue = (): OfflineAction[] => readState(getOfflineQueueSession().ownerNamespace).actions;
export const isPendingBackendCard = (id: string, owner: string): boolean => {
  if (owner === 'local_guest') return false;
  const state = readState(owner);
  return Object.hasOwn(state.tempIds, id)
    || state.actions.some(a => a.type === 'create-flashcard' && a.payload.tempId === id);
};
export const pushToOfflineQueue = (type: OfflineAction['type'], payload: any, ownerNamespace: string): void => {
  const state = readState(ownerNamespace);
  if (type === 'reset-progress') {
    state.actions = state.actions.filter(a => a.type !== 'complete-lesson' && a.type !== 'reset-progress');
    // A durable reset barrier is visible before the cache is cleared. An old
    // in-flight completion is cancelled locally; the barrier runs after HTTP.
  }
  const id = cardId(payload);
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
  try {
    // New appends remain for the next drain; acknowledgements use the latest
    // stored state, never replace it with this starting snapshot.
    for (const scheduled of initial.actions) {
      if (!isOfflineQueueSessionActive(session)) return false;
      const state = readState(owner);
      const stored = state.actions.find(a => a.id === scheduled.id);
      if (!stored) continue;
      if (stored.ownerNamespace !== owner) return false;
      const action = { ...stored, payload: resolvePayload(state, stored.type, stored.payload) };
      if (action.type === 'create-flashcard' && action.payload.tempId && !state.startedCreates.includes(action.id)) state.startedCreates.push(action.id);
      state.actions = state.actions.map(a => a.id === action.id ? action : a);
      writeState(state);
      const config: AxiosRequestConfig & { offlineQueueSession: QueueSession } = {
        offlineQueueSession: session,
        headers: { 'X-Idempotency-Key': action.id },
      };
      let serverId: string | undefined;
      let completion: any;
      try {
        const payload = action.payload;
        const id = cardId(payload);
        if (dependent(action.type) && (!id || id.startsWith('local_'))) throw new Error('Pending card has no durable server mapping');
        switch (action.type) {
          case 'reset-progress':
            await apiClient.delete(`/progress/${session.userId}/reset`, config); break;
          case 'complete-lesson':
            if (!Number.isInteger(payload.score)) throw new Error('Completion has no recorded score');
            completion = (await apiClient.post(`/progress/${session.userId}/complete-lesson`, { lessonId: payload.lessonId, score: payload.score }, config)).data?.data;
            break;
          case 'create-flashcard': {
            const response = await apiClient.post('/flashcards', {
              userId: session.userId, targetWord: payload.targetWord, turkishTranslation: payload.turkishTranslation,
              targetLanguage: payload.targetLanguage, nativeLanguage: payload.nativeLanguage,
              nativeTranslation: payload.nativeTranslation, exampleSentence: payload.exampleSentence, note: payload.note,
            }, config);
            serverId = response.data?._id || response.data?.id;
            if (payload.tempId && (typeof serverId !== 'string' || !serverId || serverId.startsWith('local_'))) throw new Error('Create response has no server card ID');
            break;
          }
          case 'update-flashcard':
            await apiClient.put(`/flashcards/${id}`, { targetWord: payload.targetWord,
              turkishTranslation: payload.turkishTranslation, targetLanguage: payload.targetLanguage,
              exampleSentence: payload.exampleSentence, note: payload.note }, config); break;
          case 'delete-flashcard': await apiClient.delete(`/flashcards/${id}`, config); break;
          case 'review-flashcard': await apiClient.put(`/flashcards/${id}/review`, { score: payload.score }, config); break;
          default: throw new Error('Unsupported queued action');
        }
      } catch (error) {
        console.error('Offline action retained', error);
        return false; // Preserve FIFO and all unacknowledged successors.
      }
      if (!isOfflineQueueSessionActive(session)) return false;
      const latest = readState(owner);
      if (latest.actions.some(a => a.id === action.id) && action.type === 'complete-lesson') {
        acknowledgeCompletion(owner, action.payload, completion);
        latest.progressRevision = `ack_${action.id}`;
      }
      if (action.type === 'reset-progress') {
        resetOwnerProgress(owner, action.payload.legacyOwnerNamespace);
        latest.progressRevision = `ack_${action.id}`;
      }
      if (action.type === 'create-flashcard' && action.payload.tempId) latest.tempIds[action.payload.tempId] = serverId!;
      latest.actions = latest.actions.filter(a => a.id !== action.id)
        .map(a => ({ ...a, payload: resolvePayload(latest, a.type, a.payload) }));
      latest.startedCreates = latest.startedCreates.filter(id => id !== action.id);
      // Mapping, dependent rewrites, and acknowledgement commit in one write.
      writeState(latest);
    }
    return isOfflineQueueSessionActive(session);
  } finally { drainingOwners.delete(owner); drainWaiters.delete(owner); release(); }
};
