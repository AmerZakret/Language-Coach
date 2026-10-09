import { getUserProgressKey } from './userKey';
import { readStoredSession, replaceStoredSession, initializeStoredSession, subscribeAuthSession, invalidateStoredSessionLocally } from './authSessionStorage';
import { coordinationAvailable } from './browserCoordination';
import type { StoredSession } from './authSessionStorage';
import type { AxiosRequestConfig } from 'axios';

export interface QueueSession {
  readonly ownerNamespace: string;
  readonly userId: string;
  readonly token: string;
  readonly revision: string;
  readonly pendingVerification?: boolean;
}
const snapshot = (record: StoredSession): QueueSession => ({
  ownerNamespace: getUserProgressKey(record.user, record.isGuest, record.token),
  userId: record.user?.id || '', token: record.token || '', revision: record.revision,
  pendingVerification: record.pendingVerification,
});
// Intent belongs to the session rendered by this tab, not a new token stored
// elsewhere. Until AuthProvider commits that replacement, protected calls stop.
let renderedSession: QueueSession | undefined;
export function observeRenderedSession(record: StoredSession): void { renderedSession = snapshot(record); }
export function getOfflineQueueSession(): QueueSession { return snapshot(readStoredSession()); }
export function isSessionCurrent(session: QueueSession): boolean {
  const active = getOfflineQueueSession();
  return active.ownerNamespace === session.ownerNamespace && active.userId === session.userId
    && active.token === session.token && active.revision === session.revision;
}
export function getSessionRequestConfig(): AxiosRequestConfig & { sessionSnapshot: QueueSession } {
  const sessionSnapshot = renderedSession || getOfflineQueueSession();
  if (!isSessionCurrent(sessionSnapshot)) throw new Error('Session changed; wait for this tab to refresh');
  return { sessionSnapshot };
}
export function isOfflineQueueSessionActive(session: QueueSession): boolean {
  return !session.pendingVerification && session.ownerNamespace !== 'local_guest' && !!session.token.trim()
    && !!session.userId && isSessionCurrent(session);
}
export const ensureOfflineQueueSessionRevision = initializeStoredSession;
export async function advanceOfflineQueueSession(): Promise<void> {
  const current = readStoredSession();
  await replaceStoredSession(current.user, current.token, current.revision, true);
}
export const onSessionInvalidated = subscribeAuthSession;
export async function invalidateCurrentSession(session: QueueSession): Promise<void> {
  if (!session.token || (session.ownerNamespace === 'local_guest' && !session.pendingVerification) || !isSessionCurrent(session)) return;
  if (coordinationAvailable()) await replaceStoredSession(null, null, session.revision);
  else invalidateStoredSessionLocally(session.revision);
  // Owner queues/caches survive logout, invalidation, and account switches.
}
