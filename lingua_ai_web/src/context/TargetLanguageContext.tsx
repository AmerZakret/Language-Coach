import { targetLanguageName, tryTargetLanguageCode } from '../utils/targetLanguage';
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { TargetLanguage } from '../types/language';
import { useAuth } from './AuthContext';
import { updateProfile } from '../api/authApi';
import { getUserProgressKey } from '../utils/userKey';
import { useSessionGuard } from '../utils/useSessionGuard';

interface TargetLanguageContextType {
  targetLanguage: TargetLanguage;
  setTargetLanguage: (lang: TargetLanguage) => void;
}

const TargetLanguageContext = createContext<TargetLanguageContextType | undefined>(undefined);

export const TargetLanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, token, isGuest, updateUser } = useAuth();
  const captureSession = useSessionGuard(getUserProgressKey(user, isGuest, token));
  const languageRequest = useRef(0);

  const [targetLanguage, setTargetLanguageState] = useState<TargetLanguage>(() => {
    const saved = localStorage.getItem('linguaai_target_language');
    if (saved == null) return 'English'; // Explicit first-use default only.
    return targetLanguageName(saved);
  });

  // Sync state if backend user's targetLanguage changes (e.g. at login/startup)
  useEffect(() => {
    if (user && !isGuest && user.targetLanguage && user.targetLanguage !== targetLanguage) {
      if (!tryTargetLanguageCode(user.targetLanguage)) {
        console.error('Unsupported profile target language', user.targetLanguage);
        return;
      }
      setTargetLanguageState(targetLanguageName(user.targetLanguage));
      localStorage.setItem('linguaai_target_language', targetLanguageName(user.targetLanguage));
    }
  }, [user, isGuest]);

  const setTargetLanguage = async (lang: TargetLanguage) => {
    const isCurrent = captureSession();
    const request = ++languageRequest.current;
    if (!isCurrent()) return;
    setTargetLanguageState(lang);
    localStorage.setItem('linguaai_target_language', lang);

    if (user && !isGuest && token) {
      try {
        const updatedUser = await updateProfile({ targetLanguage: lang });
        if (!isCurrent() || request !== languageRequest.current) return;
        await updateUser({ ...updatedUser, isGuest: false });
      } catch (e) {
        console.error('Failed to sync target language to backend', e);
      }
    }
  };

  return (
    <TargetLanguageContext.Provider value={{ targetLanguage, setTargetLanguage }}>
      {children}
    </TargetLanguageContext.Provider>
  );
};

export const useTargetLanguage = () => {
  const context = useContext(TargetLanguageContext);
  if (!context) throw new Error('useTargetLanguage must be used within TargetLanguageProvider');
  return context;
};
