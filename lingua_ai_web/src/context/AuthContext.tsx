import React, { createContext, useContext, useState, useEffect } from 'react';
import type { User } from '../types/auth';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isGuest: boolean;
  loading: boolean;
  login: (user: User, token: string) => void;
  loginAsGuest: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const storedUser = localStorage.getItem('linguaai_user');
    const storedToken = localStorage.getItem('linguaai_token');
    const storedIsGuest = localStorage.getItem('linguaai_is_guest') === 'true';

    if (storedIsGuest) {
      setIsGuest(true);
      setUser({ id: 'guest', name: 'Guest User', email: 'guest@lingua.ai', isGuest: true });
    } else if (storedUser) {
      try {
        setUser(JSON.parse(storedUser));
        setToken(storedToken);
      } catch (e) {
        localStorage.removeItem('linguaai_user');
        localStorage.removeItem('linguaai_token');
      }
    }
    setLoading(false);
  }, []);

  const login = (newUser: User, newToken: string) => {
    localStorage.setItem('linguaai_user', JSON.stringify(newUser));
    localStorage.setItem('linguaai_token', newToken);
    localStorage.removeItem('linguaai_is_guest');
    setUser(newUser);
    setToken(newToken);
    setIsGuest(false);
  };

  const loginAsGuest = () => {
    const guestUser: User = { id: 'guest', name: 'Guest User', email: 'guest@lingua.ai', isGuest: true };
    localStorage.setItem('linguaai_is_guest', 'true');
    localStorage.removeItem('linguaai_user');
    localStorage.removeItem('linguaai_token');
    setUser(guestUser);
    setToken(null);
    setIsGuest(true);
  };

  const logout = () => {
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
