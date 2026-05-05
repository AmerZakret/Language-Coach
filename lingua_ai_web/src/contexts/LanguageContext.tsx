import React, { createContext, useContext, useState, useEffect } from 'react';

type Language = 'en' | 'tr';

interface Translations {
  [key: string]: {
    en: string;
    tr: string;
  };
}

const translations: Translations = {
  dashboard: { en: 'Dashboard', tr: 'Panel' },
  lessons: { en: 'Lessons', tr: 'Dersler' },
  aiCoach: { en: 'AI Coach', tr: 'Yapay Zeka Koçu' },
  profile: { en: 'Profile', tr: 'Profil' },
  login: { en: 'Login', tr: 'Giriş Yap' },
  register: { en: 'Register', tr: 'Kayıt Ol' },
  logout: { en: 'Logout', tr: 'Çıkış Yap' },
  welcome: { en: 'Welcome back', tr: 'Tekrar hoş geldin' },
  streak: { en: 'Streak', tr: 'Seri' },
  level: { en: 'Level', tr: 'Seviye' },
};

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<Language>('en');

  useEffect(() => {
    const storedLang = localStorage.getItem('language') as Language;
    if (storedLang && (storedLang === 'en' || storedLang === 'tr')) {
      setLanguage(storedLang);
    }
  }, []);

  const changeLanguage = (lang: Language) => {
    localStorage.setItem('language', lang);
    setLanguage(lang);
  };

  const t = (key: string) => {
    return translations[key]?.[language] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage: changeLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used within a LanguageProvider');
  return context;
};
