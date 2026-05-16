import React, { createContext, useContext, useState } from 'react';
import type { InterfaceLanguage } from '../types/language';

interface LanguageContextType {
  language: InterfaceLanguage;
  setLanguage: (lang: InterfaceLanguage) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const translations: Record<InterfaceLanguage, Record<string, string>> = {
  en: {
    dashboard: 'Dashboard',
    lessons: 'Lessons',
    writing_practice: 'Writing Practice',
    topic: 'Topic',
    ai_coach: 'AI Coach',
    profile: 'Profile',
    welcome_back: 'Welcome back',
    welcome_guest: 'Welcome, Guest',
    learning: 'Learning',
    xp: 'XP',
    level: 'Level',
    streak: 'Streak',
    days: 'days',
    completed: 'Completed',
    current_level: 'Current Level',
    next_level: 'Next Level',
    progress_to_next: 'Progress to Next Level',
    suggest_topic: 'Suggest Topic',
    check_writing: 'Check Writing',
    corrected_version: 'Corrected Version',
    mistakes: 'Mistakes',
    grammar: 'Grammar',
    vocabulary: 'Vocabulary',
    clarity: 'Clarity',
    practicing: 'Practicing',
    logout: 'Logout',
    settings: 'Settings',
    interface_language: 'Interface Language',
    target_language: 'Target Learning Language',
    write_at_least_20_chars: 'Write at least 20 characters',
    feedback: 'Feedback',
    try_another: 'Try Another',
    start_conversation: 'Start a conversation...',
    type_message: 'Type a message',
    continue: 'Continue',
    back: 'Back',
    score: 'Score',
    excellent: 'Excellent!',
    good_job: 'Good Job!',
    keep_trying: 'Keep Trying!',
    question: 'Question',
    of: 'of',
    translate_sentence: 'Translate the following sentence:',
    sound_effects: 'Sound Effects',
    correct: 'Correct!',
    incorrect: 'Incorrect',
    available_lessons: 'Available Lessons',
    min: 'min',
    questions: 'questions',
    beginner: 'Beginner',
    elementary: 'Elementary',
    pre_intermediate: 'Pre-Intermediate',
    intermediate: 'Intermediate',
    upper_intermediate: 'Upper-Intermediate',
    advanced: 'Advanced',
    lesson_unavailable: 'Lesson Unavailable',
    lesson_no_questions: 'This lesson currently has no questions. Please try another one.',
    back_to_lessons: 'Back to Lessons',
    fill_blank: 'Fill in the blank',
    match_meaning: 'Match the meaning',
    to_go: 'to go',
    quick_actions: 'Quick Actions',
    weekly_activity: 'Weekly Activity',
    progress_stats: 'Progress Stats',
    reset_warning: 'Warning: This will reset your progress for the current language.',
    reset_language_progress: 'Reset Language Progress',
    total_xp: 'Total XP',
    completed_lessons: 'Completed Lessons',
    current_streak: 'Current Streak',
    see_all: 'See All',
    start_learning_now: 'Start learning now!',
    finish: 'Finish',
    next: 'Next',
    complete_previous_to_unlock: 'Complete previous level to unlock',
    progress: 'Progress',
  },
  tr: {
    dashboard: 'Panel',
    lessons: 'Dersler',
    writing_practice: 'Yazma Pratiği',
    topic: 'Konu',
    ai_coach: 'Yapay Zeka Koçu',
    profile: 'Profil',
    welcome_back: 'Tekrar hoş geldin',
    welcome_guest: 'Hoş geldin, Misafir',
    learning: 'Öğrenilen Dil',
    xp: 'XP',
    level: 'Seviye',
    streak: 'Seri',
    days: 'gün',
    completed: 'Tamamlandı',
    current_level: 'Mevcut Seviye',
    next_level: 'Sonraki Seviye',
    progress_to_next: 'Sonraki Seviyeye İlerleme',
    suggest_topic: 'Konu Öner',
    check_writing: 'Yazıyı Kontrol Et',
    corrected_version: 'Düzeltilmiş Versiyon',
    mistakes: 'Hatalar',
    grammar: 'Dil Bilgisi',
    vocabulary: 'Kelime Bilgisi',
    clarity: 'Açıklık',
    practicing: 'Pratik Yapılıyor',
    logout: 'Çıkış Yap',
    settings: 'Ayarlar',
    interface_language: 'Arayüz Dili',
    target_language: 'Öğrenilen Dil',
    write_at_least_20_chars: 'En az 20 karakter yazın',
    feedback: 'Geri Bildirim',
    try_another: 'Başka Bir Tane Dene',
    start_conversation: 'Konuşmayı başlat...',
    type_message: 'Bir mesaj yazın',
    continue: 'Devam Et',
    back: 'Geri',
    score: 'Puan',
    excellent: 'Mükemmel!',
    good_job: 'Tebrikler!',
    keep_trying: 'Denemeye Devam Et!',
    question: 'Soru',
    of: '/',
    translate_sentence: 'Aşağıdaki cümleyi çeviriniz:',
    sound_effects: 'Ses Efektleri',
    correct: 'Doğru!',
    incorrect: 'Yanlış',
    available_lessons: 'Mevcut Dersler',
    min: 'dk',
    questions: 'soru',
    beginner: 'Başlangıç',
    elementary: 'Temel Seviye',
    pre_intermediate: 'Ön-Orta Seviye',
    intermediate: 'Orta Seviye',
    upper_intermediate: 'İleri-Orta Seviye',
    advanced: 'İleri Seviye',
    lesson_unavailable: 'Ders Mevcut Değil',
    lesson_no_questions: 'Bu derste şu an için soru bulunmamaktadır. Lütfen başka bir ders deneyin.',
    back_to_lessons: 'Derslere Geri Dön',
    fill_blank: 'Boşluğu doldurun',
    match_meaning: 'Anlamı eşleştirin',
    to_go: 'kaldı',
    quick_actions: 'Hızlı İşlemler',
    weekly_activity: 'Haftalık Aktivite',
    progress_stats: 'İlerleme İstatistikleri',
    reset_warning: 'Uyarı: Bu işlem mevcut dil için ilerlemenizi sıfırlayacaktır.',
    reset_language_progress: 'Dil İlerlemesini Sıfırla',
    total_xp: 'Toplam XP',
    completed_lessons: 'Tamamlanan Dersler',
    current_streak: 'Mevcut Seri',
    see_all: 'Tümünü Gör',
    start_learning_now: 'Şimdi öğrenmeye başla!',
    finish: 'Bitir',
    next: 'Sıradaki',
    complete_previous_to_unlock: 'Önceki seviyeyi tamamla',
    progress: 'İlerleme',
  },
};

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<InterfaceLanguage>(() => {
    return (localStorage.getItem('linguaai_interface_language') as InterfaceLanguage) || 'en';
  });

  const setLanguage = (lang: InterfaceLanguage) => {
    setLanguageState(lang);
    localStorage.setItem('linguaai_interface_language', lang);
  };

  const t = (key: string) => {
    return translations[language][key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used within LanguageProvider');
  return context;
};
