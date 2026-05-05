import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { LogOut } from 'lucide-react';
import './Topbar.css';

export const Topbar: React.FC = () => {
  const { language, setLanguage, t } = useLanguage();
  const { user, logout } = useAuth();

  return (
    <header className="topbar glass-panel">
      <div className="topbar-left">
        <span className="welcome-text">{t('welcome')}, {user?.name}</span>
      </div>
      <div className="topbar-right">
        <div className="lang-switch">
          <button 
            className={`lang-btn ${language === 'en' ? 'active' : ''}`}
            onClick={() => setLanguage('en')}
          >
            EN
          </button>
          <button 
            className={`lang-btn ${language === 'tr' ? 'active' : ''}`}
            onClick={() => setLanguage('tr')}
          >
            TR
          </button>
        </div>
        <button className="logout-btn" onClick={logout} title={t('logout')}>
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
};
