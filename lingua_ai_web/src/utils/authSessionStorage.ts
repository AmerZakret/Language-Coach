import type { User } from '../types/auth';
import { coordinationAvailable, withBrowserLock } from './browserCoordination';

export const AUTH_SESSION_KEY = 'linguaai_session_v1';
const legacyKeys = ['linguaai_user', 'linguaai_token', 'linguaai_is_guest', 'linguaai_session_revision'];
export interface StoredSession {
  schemaVersion: 1;
  revision: string;
  user: User | null;
  token: string | null;
  isGuest: boolean;
  pendingVerification?: boolean;
}
export const localGuestUser: User = { id: 'guest', name: 'Guest User', email: 'guest@lingua.ai', isGuest: true };
const newRevision = () => `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const empty = (): StoredSession => ({ schemaVersion: 1, revision: 'absent', user: null, token: null, isGuest: false });
export function isBackendGuestUser(value: unknown): value is User {
  const guest = value as Partial<User> | null;
  return !!guest && guest.isGuest === true && typeof guest.id === 'string' && /^[a-f\d]{24}$/i.test(guest.id)
    && typeof guest.name === 'string' && typeof guest.email === 'string' && guest.email.toLowerCase().endsWith('@guest.lingua.local');
}
let invalidatedRevision: string | undefined;
export function readStoredSession(): StoredSession {
  const raw = localStorage.getItem(AUTH_SESSION_KEY);
  if (raw === null) return empty();
  try {
    const value = JSON.parse(raw) as StoredSession;
    if (value.schemaVersion !== 1 || typeof value.revision !== 'string' || !value.revision
      || typeof value.isGuest !== 'boolean' || (value.token !== null && typeof value.token !== 'string')) throw new Error();
    if (value.pendingVerification) {
      if (value.user !== null || !value.token) throw new Error();
    } else if (value.user) {
      if (typeof value.user.name !== 'string' || typeof value.user.email !== 'string') throw new Error();
      if (value.isGuest && !value.token) {
        if (value.user.id !== 'guest') throw new Error();
      } else if (!/^[a-f\d]{24}$/i.test(value.user.id) || value.user.isGuest !== value.isGuest
        || (value.isGuest && !isBackendGuestUser(value.user))) throw new Error();
    } else if (value.token || value.isGuest) throw new Error();
    return value.revision === invalidatedRevision ? { ...empty(), revision: `invalidated:${value.revision}` } : value;
  } catch { return { ...empty(), revision: `invalid:${raw}` }; }
}
const listeners = new Set<() => void>();
export function subscribeAuthSession(listener: () => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
function changed() { for (const listener of listeners) listener(); }
// Without exclusion, an asynchronous 401 must not overwrite another tab's login.
// Block this tab's expired session in memory; leave the atomic stored record intact.
export function invalidateStoredSessionLocally(expectedRevision: string): void {
  if (readStoredSession().revision !== expectedRevision) return;
  invalidatedRevision = expectedRevision;
  changed();
}
if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('storage', event => {
  if ((event.key === AUTH_SESSION_KEY || event.key === null) && (!event.storageArea || event.storageArea === localStorage)) changed();
});
function write(value: StoredSession) {
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(value));
  // Legacy fields are retired, never used as projections of the current session.
  for (const key of legacyKeys) localStorage.removeItem(key);
  changed();
}
// Explicit user login/logout is still an atomic replacement without Web Locks.
// Conditional asynchronous writes require Web Locks; there is no unsafe CAS fallback.
export async function replaceStoredSession(user: User | null, token: string | null, expectedRevision?: string, forceRevision = false): Promise<boolean> {
  const work = () => {
    const current = readStoredSession();
    if (expectedRevision !== undefined && current.revision !== expectedRevision) return false;
    const isGuest = user?.isGuest === true;
    if (isGuest && !token) user = localGuestUser;
    if (token && (!user || !/^[a-f\d]{24}$/i.test(user.id) || (isGuest && !isBackendGuestUser(user)))) throw new Error('Invalid session identity');
    const sameIdentity = !current.pendingVerification && current.user?.id === user?.id
      && current.token === (token || null) && current.isGuest === isGuest;
    write({ schemaVersion: 1, revision: sameIdentity && !forceRevision ? current.revision : newRevision(), user, token: token?.trim() ? token : null, isGuest });
    return true;
  };
  if (coordinationAvailable()) return withBrowserLock('linguaai:auth:session', work);
  return expectedRevision === undefined ? work() : false;
}
export async function initializeStoredSession(): Promise<void> {
  if (localStorage.getItem(AUTH_SESSION_KEY) !== null) return;
  // Migration must not compete with login in another context.
  if (!coordinationAvailable()) return;
  await withBrowserLock('linguaai:auth:session', () => {
    if (localStorage.getItem(AUTH_SESSION_KEY) !== null) return;
    if (legacyKeys.every(key => localStorage.getItem(key) === null)) return;
    let user: User | null = null;
    try { user = JSON.parse(localStorage.getItem('linguaai_user') || 'null'); } catch { /* Ambiguous legacy identity. */ }
    const token = localStorage.getItem('linguaai_token') || null;
    const guest = localStorage.getItem('linguaai_is_guest') === 'true';
    const localGuest = guest && (!token || !isBackendGuestUser(user));
    // Never pair independently persisted legacy user/token fields. Only /users/me
    // can bind a legacy token to an owner, including while the backend is offline.
    write({ schemaVersion: 1, revision: newRevision(), user: localGuest ? localGuestUser : null,
      token: localGuest ? null : token, isGuest: localGuest, ...(token && !localGuest ? { pendingVerification: true } : {}) });
  });
}
