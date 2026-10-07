import { getUserProgressKey } from './userKey';
import type { User } from '../types/auth';
import type { AxiosRequestConfig } from 'axios';

const SESSION_REVISION_KEY = 'linguaai_session_revision';

export interface QueueSession {
  readonly ownerNamespace: string;
  readonly userId: string;
  readonly token: string;
  readonly revision: string;
}

export function advanceOfflineQueueSession(): void {
  localStorage.setItem(SESSION_REVISION_KEY, `${Date.now()}_${Math.random().toString(36).slice(2)}`);
}

export function ensureOfflineQueueSessionRevision(): void {
  if (!localStorage.getItem(SESSION_REVISION_KEY)) advanceOfflineQueueSession();
}

export function getOfflineQueueSession(): QueueSession {
  let user: User | null = null;
  try {
    user = JSON.parse(localStorage.getItem('linguaai_user') || 'null');
  } catch {
    // An incomplete session has no backend replay identity.
  }
  const token = localStorage.getItem('linguaai_token') || '';
  const isGuest = localStorage.getItem('linguaai_is_guest') === 'true';
  return {
    ownerNamespace: getUserProgressKey(user, isGuest, token),
    userId: user?.id || user?.email || '',
    token,
    revision: localStorage.getItem(SESSION_REVISION_KEY) || '',
  };
}

export function isSessionCurrent(session: QueueSession): boolean {
  const active = getOfflineQueueSession();
  return active.ownerNamespace === session.ownerNamespace
    && active.userId === session.userId && active.token === session.token
    && active.revision === session.revision;
}

export function getSessionRequestConfig(): AxiosRequestConfig & { sessionSnapshot: QueueSession } {
  return { sessionSnapshot: getOfflineQueueSession() };
}

export function isOfflineQueueSessionActive(session: QueueSession): boolean {
  return session.ownerNamespace !== 'local_guest' && !!session.token.trim()
    && !!session.userId && isSessionCurrent(session);
}

const invalidationListeners = new Set<() => void>();
export function onSessionInvalidated(listener: () => void): () => void {
  invalidationListeners.add(listener);
  return () => { invalidationListeners.delete(listener); };
}

export function invalidateCurrentSession(session: QueueSession): void {
  if (!session.token || session.ownerNamespace === 'local_guest' || !isSessionCurrent(session)) return;
  advanceOfflineQueueSession();
  for (const key of ['linguaai_user', 'linguaai_token', 'linguaai_is_guest']) localStorage.removeItem(key);
  // Owner-scoped queues and caches remain available for a later valid login.
  invalidationListeners.forEach(listener => listener());
}
