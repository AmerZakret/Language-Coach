import React, { createContext, useContext, useState, useEffect, useLayoutEffect, useRef } from 'react';
import type { User } from '../types/auth';
import { fetchMe } from '../api/authApi';
import { getOfflineQueueSession, getSessionRequestConfig, isSessionCurrent, observeRenderedSession, invalidateCurrentSession } from '../utils/queueSession';
import { readStoredSession, replaceStoredSession, initializeStoredSession, subscribeAuthSession, localGuestUser, isBackendGuestUser } from '../utils/authSessionStorage';
import { coordinationAvailable, CoordinationUnavailable } from '../utils/browserCoordination';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isGuest: boolean;
  loading: boolean;
  login: (user: User, token: string) => Promise<void>;
  updateUser: (user: User) => Promise<void>;
  loginAsGuest: () => Promise<void>;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthContextType | undefined>(undefined);
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [record, setRecord] = useState(readStoredSession());
  const [loading, setLoading] = useState(true);
  const lifecycle = useRef({ mounted: true, attempt: 0 });
  // Commit the request identity with the UI, never during an interruptible render.
  useLayoutEffect(() => observeRenderedSession(record), [record]);
  useEffect(() => {
    lifecycle.current.mounted = true;
    let cancelled = false;
    const unsubscribe = subscribeAuthSession(() => {
      if (!lifecycle.current.mounted) return;
      lifecycle.current.attempt++;
      setRecord(readStoredSession()); setLoading(false);
    });
    const initialize = async () => {
      await initializeStoredSession();
      if (cancelled) return;
      const current = readStoredSession();
      setRecord(current);
      if (current.token) {
        const session = getOfflineQueueSession();
        try {
          const me = await fetchMe(session);
          if (!cancelled && isSessionCurrent(session)) await replaceStoredSession(me, current.token, current.revision);
        } catch (error) {
          if (!cancelled && isSessionCurrent(session) && (error as { response?: { status?: number } }).response?.status === 401)
            await invalidateCurrentSession(session);
          // An unverified legacy token never inherits its separately stored owner.
        }
      }
      if (!cancelled) { setRecord(readStoredSession()); setLoading(false); }
    };
    void initialize();
    return () => { unsubscribe(); cancelled = true; lifecycle.current.mounted = false; lifecycle.current.attempt++; };
  }, []);
  const login = async (user: User, token: string) => {
    if (!lifecycle.current.mounted) return;
    const installed = await replaceStoredSession(user, token, coordinationAvailable() ? record.revision : undefined);
    if (!installed) throw new Error('Session changed before login completed');
  };
  const updateUser = async (user: User) => {
    if (!lifecycle.current.mounted) return;
    if (!coordinationAvailable()) throw new CoordinationUnavailable();
    if (user.id !== record.user?.id || user.isGuest !== record.isGuest || !record.token
      || !await replaceStoredSession(user, record.token, record.revision))
      throw new Error('Session changed before profile update completed');
  };
  const loginAsGuest = async () => {
    const session = getSessionRequestConfig().sessionSnapshot;
    const attempt = ++lifecycle.current.attempt;
    let user = localGuestUser;
    let token: string | null = null;
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/auth/guest`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      if (!response.ok) throw new Error('Guest login failed');
      const data = await response.json();
      if (!isBackendGuestUser(data.user) || typeof data.access_token !== 'string' || !data.access_token.trim()) throw new Error('Invalid guest session');
      user = data.user; token = data.access_token;
    } catch { /* Tokenless local guest when backend guest creation is unavailable. */ }
    if (!lifecycle.current.mounted || attempt !== lifecycle.current.attempt || !isSessionCurrent(session)) return;
    await replaceStoredSession(user, token, coordinationAvailable() ? session.revision : undefined);
  };
  const logout = async () => {
    if (!lifecycle.current.mounted) return;
    await replaceStoredSession(null, null, coordinationAvailable() ? record.revision : undefined);
  };
  return (
    <AuthContext.Provider value={{ user: record.user, token: record.token, isGuest: record.isGuest, loading, login, updateUser, loginAsGuest, logout }}>
      {/* Session changes remount old-session drafts and mutation closures. */}
      <React.Fragment key={record.revision}>{children}</React.Fragment>
    </AuthContext.Provider>
  );
};
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
