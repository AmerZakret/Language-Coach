import React, { createContext, useContext, useState, useEffect } from 'react';
import type { User } from '../types/auth';
import { fetchMe } from '../api/authApi';
import { advanceOfflineQueueSession, ensureOfflineQueueSessionRevision, getOfflineQueueSession } from '../utils/queueSession';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isGuest: boolean;
  loading: boolean;
  login: (user: User, token: string) => void;
  loginAsGuest: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const localGuestUser: User = {
  id: 'guest', name: 'Guest User', email: 'guest@lingua.ai', isGuest: true,
};

function isBackendGuestUser(value: unknown): value is User {
  if (!value || typeof value !== 'object') return false;
  const guest = value as Partial<User>;
  return typeof guest.id === 'string' && /^[a-f\d]{24}$/i.test(guest.id)
    && typeof guest.name === 'string' && typeof guest.email === 'string'
    && guest.email.toLowerCase().endsWith('@guest.lingua.local');
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const initializeAuth = async () => {
      ensureOfflineQueueSessionRevision();
      const storedUser = localStorage.getItem('linguaai_user');
      const storedToken = localStorage.getItem('linguaai_token');
      const storedIsGuest = localStorage.getItem('linguaai_is_guest') === 'true';
      const revision = getOfflineQueueSession().revision;
      const sessionUnchanged = () => getOfflineQueueSession().revision === revision
        && localStorage.getItem('linguaai_token') === storedToken;

      if (storedIsGuest) {
        setIsGuest(true);
        let restoredGuest: unknown = null;
        try {
          restoredGuest = storedUser ? JSON.parse(storedUser) : null;
        } catch {
          // Incomplete guest state must never retain backend authorization.
        }
        if (storedToken?.trim() && isBackendGuestUser(restoredGuest)) {
          setUser({ ...restoredGuest, isGuest: true });
          setToken(storedToken);
        } else {
          localStorage.removeItem('linguaai_token');
          localStorage.setItem('linguaai_user', JSON.stringify(localGuestUser));
          setUser(localGuestUser);
          setToken(null);
        }
      } else if (storedToken) {
        setToken(storedToken);
        try {
          const me = await fetchMe();
          // Never pair an old profile's owner ID with the new session's token.
          if (!sessionUnchanged()) { setLoading(false); return; }
          const mergedUser = { ...me, isGuest: false };
          setUser(mergedUser);
          localStorage.setItem('linguaai_user', JSON.stringify(mergedUser));
        } catch (e) {
          if (!sessionUnchanged()) { setLoading(false); return; }
          // Fall back to local storage user if offline/error
          if (storedUser) {
            try {
              setUser(JSON.parse(storedUser));
            } catch {
              localStorage.removeItem('linguaai_user');
              localStorage.removeItem('linguaai_token');
            }
          } else {
            localStorage.removeItem('linguaai_token');
          }
        }
      } else if (storedUser) {
        try {
          setUser(JSON.parse(storedUser));
        } catch (e) {
          localStorage.removeItem('linguaai_user');
        }
      }
      setLoading(false);
    };

    initializeAuth();
  }, []);

  const login = (newUser: User, newToken: string) => {
    advanceOfflineQueueSession();
    localStorage.setItem('linguaai_user', JSON.stringify(newUser));
    localStorage.setItem('linguaai_token', newToken);
    localStorage.removeItem('linguaai_is_guest');
    setUser(newUser);
    setToken(newToken);
    setIsGuest(false);
  };

  const loginAsGuest = async () => {
    let guestUser: User = localGuestUser;
    let guestToken: string | null = null;

    // Try to get a real guest token from the backend
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/auth/guest`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } }
      );
      if (!response.ok) throw new Error('Guest login failed');
      const data = await response.json();
      if (!isBackendGuestUser(data.user)
        || typeof data.access_token !== 'string' || !data.access_token.trim()) {
        throw new Error('Guest login returned an incomplete session');
      }
      guestUser = { ...data.user, isGuest: true };
      guestToken = data.access_token;
    } catch {
      // Backend unavailable or invalid response: use a local guest without a token.
    }

    advanceOfflineQueueSession();
    localStorage.setItem('linguaai_user', JSON.stringify(guestUser));
    if (guestToken) {
      localStorage.setItem('linguaai_token', guestToken);
    } else {
      localStorage.removeItem('linguaai_token');
    }
    localStorage.setItem('linguaai_is_guest', 'true');

    setUser(guestUser);
    setToken(guestToken);
    setIsGuest(true);
  };

  const logout = () => {
    advanceOfflineQueueSession();
    localStorage.removeItem('linguaai_user');
    localStorage.removeItem('linguaai_token');
    localStorage.removeItem('linguaai_is_guest');
    setUser(null);
    setToken(null);
    setIsGuest(false);
  };

  return (
    <AuthContext.Provider value={{ user, token, isGuest, loading, login, loginAsGuest, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
