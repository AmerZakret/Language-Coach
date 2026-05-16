import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useTargetLanguage } from '../../context/TargetLanguageContext';
import { useProgress } from '../../context/ProgressContext';
import { Globe, Bolt, User } from 'lucide-react';
import './Topbar.css';

export const Topbar: React.FC = () => {
  const { user, isGuest } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const { targetLanguage } = useTargetLanguage();
  const { progress } = useProgress();

  const toggleLanguage = () => {
    setLanguage(language === 'en' ? 'tr' : 'en');
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="target-lang-badge">
          <Globe size={16} />
          <span>{t('learning')}: {targetLanguage}</span>
        </div>
      </div>
      
      <div className="topbar-right">
        <div className="stat-pill">
          <Bolt size={16} className="xp-icon" />
          <span>{progress.totalXp} XP</span>
        </div>

        <button className="lang-toggle" onClick={toggleLanguage}>
          {language.toUpperCase()}
        </button>

        <div className="user-profile">
          <div className="user-info">
            <span className="user-name">{user?.name || 'User'}</span>
            <span className="user-status">{isGuest ? 'Guest' : 'Member'}</span>
          </div>
          <div className="avatar-placeholder">
            <User size={20} />
          </div>
        </div>
      </div>
    </header>
  );
};
