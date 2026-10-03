import apiClient from '../api/apiClient';

export interface OfflineAction {
  id: string;
  type: 'complete-lesson' | 'create-flashcard' | 'update-flashcard' | 'delete-flashcard' | 'review-flashcard';
  payload: any;
}

const QUEUE_STORAGE_KEY = 'linguaai_offline_queue';

export const getOfflineQueue = (): OfflineAction[] => {
  const data = localStorage.getItem(QUEUE_STORAGE_KEY);
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch {
    return [];
  }
};

export const saveOfflineQueue = (queue: OfflineAction[]): void => {
  localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
};

export const pushToOfflineQueue = (type: OfflineAction['type'], payload: any): void => {
  const queue = getOfflineQueue();
  const action: OfflineAction = {
    id: `action_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    type,
    payload,
  };
  queue.push(action);
  saveOfflineQueue(queue);
};

export const clearOfflineQueue = (): void => {
  localStorage.removeItem(QUEUE_STORAGE_KEY);
};

export const processOfflineQueue = async (userId: string): Promise<boolean> => {
  const queue = getOfflineQueue();
  if (queue.length === 0) return true;

  console.log(`Processing offline queue containing ${queue.length} actions...`);
  
  const idMap = new Map<string, string>(); // Maps temporary local_... IDs to server-generated MongoDB _ids
  const remainingActions: OfflineAction[] = [];
  let success = true;

  for (const action of queue) {
    try {
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
          });
          break;

        case 'create-flashcard': {
          const response = await apiClient.post('/flashcards', {
            userId: payload.userId,
            targetWord: payload.targetWord,
            turkishTranslation: payload.turkishTranslation,
            targetLanguage: payload.targetLanguage,
            nativeLanguage: payload.nativeLanguage,
            nativeTranslation: payload.nativeTranslation,
            exampleSentence: payload.exampleSentence,
            note: payload.note,
          });
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
          });
          break;
        }

        case 'delete-flashcard': {
          const cardId = payload.cardId || payload.id;
          await apiClient.delete(`/flashcards/${cardId}`);
          break;
        }

        case 'review-flashcard': {
          const cardId = payload.cardId || payload.id;
          await apiClient.put(`/flashcards/${cardId}/review`, {
            score: payload.score,
          });
          break;
        }
      }
    } catch (error) {
      console.error(`Offline queue action failed: ${action.type}`, error);
      // Keep failed action in the queue for a retry later
      remainingActions.push(action);
      success = false;
    }
  }

  saveOfflineQueue(remainingActions);
  return success;
};
