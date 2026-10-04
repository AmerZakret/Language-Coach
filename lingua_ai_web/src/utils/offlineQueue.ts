import apiClient from '../api/apiClient';
import type { AxiosRequestConfig } from 'axios';
import { getOfflineQueueSession, isOfflineQueueSessionActive } from './queueSession';
import type { QueueSession } from './queueSession';

export interface OfflineAction {
  readonly id: string;
  readonly type: 'complete-lesson' | 'create-flashcard' | 'update-flashcard' | 'delete-flashcard' | 'review-flashcard';
  readonly ownerNamespace: string;
  readonly payload: any;
  readonly createdAt: string;
  readonly schemaVersion: 1;
}

const QUEUE_STORAGE_KEY = 'linguaai_offline_queue';
const QUARANTINE_STORAGE_KEY = 'linguaai_offline_queue_legacy_unowned';
const ownerStorageKey = (owner: string) => `${QUEUE_STORAGE_KEY}_${encodeURIComponent(owner)}`;

function quarantineLegacyQueue(): void {
  const legacy = localStorage.getItem(QUEUE_STORAGE_KEY);
  if (legacy === null) return;
  // Preserve raw snapshots, even malformed JSON. Ownership cannot be inferred
  // from old payloads, so no legacy action is assigned to the active account.
  const saved = localStorage.getItem(QUARANTINE_STORAGE_KEY);
  let snapshots: string[] = [];
  if (saved !== null) {
    try {
      const parsed = JSON.parse(saved);
      snapshots = Array.isArray(parsed) && parsed.every(item => typeof item === 'string')
        ? parsed : [saved];
    } catch {
      snapshots = [saved];
    }
  }
  if (!snapshots.includes(legacy)) snapshots.push(legacy);
  localStorage.setItem(QUARANTINE_STORAGE_KEY, JSON.stringify(snapshots));
  if (localStorage.getItem(QUEUE_STORAGE_KEY) === legacy) {
    localStorage.removeItem(QUEUE_STORAGE_KEY);
  }
}

export const getOfflineQueue = (): OfflineAction[] => {
  return readOwnerQueue(getOfflineQueueSession().ownerNamespace);
};

function readOwnerQueue(owner: string): OfflineAction[] {
  quarantineLegacyQueue();
  const data = localStorage.getItem(ownerStorageKey(owner));
  if (!data) return [];
  const actions = JSON.parse(data);
  if (!Array.isArray(actions) || actions.some(action => !action
    || action.schemaVersion !== 1 || typeof action.ownerNamespace !== 'string'
    || !action.ownerNamespace || typeof action.createdAt !== 'string'
    || !Number.isFinite(Date.parse(action.createdAt)))) {
    throw new Error('Offline queue has no supported ownership schema');
  }
  return actions;
}

function saveOwnerQueue(owner: string, queue: OfflineAction[]): void {
  if (queue.some(action => action.ownerNamespace !== owner)) {
    throw new Error('Cannot save actions in another owner queue');
  }
  localStorage.setItem(ownerStorageKey(owner), JSON.stringify(queue));
}

export const pushToOfflineQueue = (type: OfflineAction['type'], payload: any, ownerNamespace: string): void => {
  const queue = readOwnerQueue(ownerNamespace);
  const action: OfflineAction = Object.freeze({
    id: `action_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    type,
    ownerNamespace,
    payload: { ...payload },
    createdAt: new Date().toISOString(),
    schemaVersion: 1,
  });
  queue.push(action);
  saveOwnerQueue(ownerNamespace, queue);
};

export const clearOfflineQueue = (): void => {
  localStorage.removeItem(ownerStorageKey(getOfflineQueueSession().ownerNamespace));
};

export const processOfflineQueue = async (userId: string): Promise<boolean> => {
  const session = getOfflineQueueSession();
  const queue = readOwnerQueue(session.ownerNamespace);
  if (userId !== session.userId || !isOfflineQueueSessionActive(session)
    || queue.some(action => action.ownerNamespace !== session.ownerNamespace)) return false;
  if (queue.length === 0) return true;

  console.log(`Processing offline queue containing ${queue.length} actions...`);
  
  const idMap = new Map<string, string>(); // Maps temporary local_... IDs to server-generated MongoDB _ids
  const remainingActions: OfflineAction[] = [];
  let success = true;

  for (const action of queue) {
    if (!isOfflineQueueSessionActive(session) || action.ownerNamespace !== session.ownerNamespace) return false;
    try {
      const requestConfig: AxiosRequestConfig & { offlineQueueSession: QueueSession } = {
        offlineQueueSession: session,
      };
      // 1. Rewrite payload if it references a temporary card ID that was resolved earlier in this run
      let payload = { ...action.payload };

      if (action.type === 'update-flashcard' || action.type === 'delete-flashcard' || action.type === 'review-flashcard') {
        const cardId = payload.cardId || payload.id;
        if (cardId && idMap.has(cardId)) {
          const newId = idMap.get(cardId)!;
          if (payload.cardId) payload.cardId = newId;
          if (payload.id) payload.id = newId;
        }
      }

      // 2. Process action by calling the appropriate endpoint
      switch (action.type) {
        case 'complete-lesson':
          await apiClient.post(`/progress/${userId}/complete-lesson`, {
            lessonId: payload.lessonId,
            score: payload.score || 100,
          }, requestConfig);
          break;

        case 'create-flashcard': {
          const response = await apiClient.post('/flashcards', {
            userId: session.userId,
            targetWord: payload.targetWord,
            turkishTranslation: payload.turkishTranslation,
            targetLanguage: payload.targetLanguage,
            nativeLanguage: payload.nativeLanguage,
            nativeTranslation: payload.nativeTranslation,
            exampleSentence: payload.exampleSentence,
            note: payload.note,
          }, requestConfig);
          // Map the temporary local ID to the new server ID
          if (payload.tempId && response.data?._id) {
            idMap.set(payload.tempId, response.data._id);
          }
          break;
        }

        case 'update-flashcard': {
          const cardId = payload.cardId || payload.id;
          await apiClient.put(`/flashcards/${cardId}`, {
            targetWord: payload.targetWord,
            turkishTranslation: payload.turkishTranslation,
            targetLanguage: payload.targetLanguage,
            exampleSentence: payload.exampleSentence,
            note: payload.note,
          }, requestConfig);
          break;
        }

        case 'delete-flashcard': {
          const cardId = payload.cardId || payload.id;
          await apiClient.delete(`/flashcards/${cardId}`, requestConfig);
          break;
        }

        case 'review-flashcard': {
          const cardId = payload.cardId || payload.id;
          await apiClient.put(`/flashcards/${cardId}/review`, {
            score: payload.score,
          }, requestConfig);
          break;
        }
      }
      // A switched session must not acknowledge an in-flight action or advance
      // to the next one. Its original owner's stored queue stays intact.
      if (!isOfflineQueueSessionActive(session)) return false;
    } catch (error) {
      if (!isOfflineQueueSessionActive(session)) return false;
      console.error(`Offline queue action failed: ${action.type}`, error);
      // Keep failed action in the queue for a retry later
      remainingActions.push(action);
      success = false;
    }
  }

  if (!isOfflineQueueSessionActive(session)) return false;
  saveOwnerQueue(session.ownerNamespace, remainingActions);
  return success;
};
