import { getUserProgressKey } from './userKey';
import type { User } from '../types/auth';

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

export function isOfflineQueueSessionActive(session: QueueSession): boolean {
  const active = getOfflineQueueSession();
  return session.ownerNamespace !== 'local_guest' && !!session.token.trim()
    && !!session.userId && active.ownerNamespace === session.ownerNamespace
    && active.userId === session.userId && active.token === session.token
    && active.revision === session.revision;
}
