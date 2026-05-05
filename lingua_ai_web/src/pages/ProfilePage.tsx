import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { progressApi, type Progress } from '../services/progressApi';
import { User, LogOut, Flame, Trophy, BookOpen, Star } from 'lucide-react';
import './Dashboard.css';

export const ProfilePage: React.FC = () => {
  const { user, logout } = useAuth();
  const { t, language, setLanguage } = useLanguage();
  const [progress, setProgress] = useState<Progress | null>(null);

  useEffect(() => {
    const fetchProgress = async () => {
      try {
        if (user?.id) {
          const data = await progressApi.getUserProgress(user.id);
          setProgress(data);
        }
      } catch (error) {
        console.error("Failed to fetch progress", error);
      }
    };
    fetchProgress();
  }, [user]);

  return (
    <div className="dashboard animate-fade-in">
      <h1 className="page-title">{t('profile')}</h1>
      
      <div className="profile-grid">
        <div className="glass-panel profile-header-card">
          <div className="profile-avatar">
            <User size={64} color="white" />
          </div>
          <div className="profile-info">
            <h2>{user?.name || 'Guest User'}</h2>
            <p>{user?.email || 'guest@example.com'}</p>
            <span className="badge">{user ? 'Registered User' : 'Guest Mode'}</span>
          </div>
          <button className="secondary logout-profile-btn" onClick={logout}>
            <LogOut size={18} /> {t('logout')}
          </button>
        </div>

        <div className="glass-panel profile-stats-card">
          <h3>Your Statistics</h3>
          <div className="profile-stats-grid">
            <div className="p-stat">
              <Star size={24} color="var(--primary-color)" />
              <div>
                <h4>{progress?.stats?.totalXp || 0}</h4>
                <p>Total XP</p>
              </div>
            </div>
            <div className="p-stat">
              <Flame size={24} color="var(--warning)" />
              <div>
                <h4>{progress?.stats?.streak || 0}</h4>
                <p>Day Streak</p>
              </div>
            </div>
            <div className="p-stat">
              <BookOpen size={24} color="var(--secondary-color)" />
              <div>
                <h4>{progress?.stats?.completedLessonsCount || 0}</h4>
                <p>Completed Lessons</p>
              </div>
            </div>
            <div className="p-stat">
              <Trophy size={24} color="#ec4899" />
              <div>
                <h4>{progress?.level || 'Beginner'}</h4>
                <p>Current Level</p>
              </div>
            </div>
          </div>
        </div>

        <div className="glass-panel settings-card">
          <h3>Settings</h3>
          <div className="settings-list">
            <div className="setting-item">
              <div>
                <h4>Language</h4>
                <p>Change your interface language</p>
              </div>
              <div className="lang-switch-profile">
                <button 
                  className={`lang-btn ${language === 'en' ? 'active' : ''}`}
                  onClick={() => setLanguage('en')}
                >
                  English
                </button>
                <button 
                  className={`lang-btn ${language === 'tr' ? 'active' : ''}`}
                  onClick={() => setLanguage('tr')}
                >
                  Türkçe
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
