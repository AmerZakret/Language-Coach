import React, { createContext, useContext, useState } from 'react';
import type { TargetLanguage } from '../types/language';

interface TargetLanguageContextType {
  targetLanguage: TargetLanguage;
  setTargetLanguage: (lang: TargetLanguage) => void;
}

const TargetLanguageContext = createContext<TargetLanguageContextType | undefined>(undefined);

export const TargetLanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [targetLanguage, setTargetLanguageState] = useState<TargetLanguage>(() => {
    return (localStorage.getItem('linguaai_target_language') as TargetLanguage) || 'English';
  });

  const setTargetLanguage = (lang: TargetLanguage) => {
    setTargetLanguageState(lang);
    localStorage.setItem('linguaai_target_language', lang);
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
