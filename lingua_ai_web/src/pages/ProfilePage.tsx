import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useTargetLanguage } from '../context/TargetLanguageContext';
import { useProgress } from '../context/ProgressContext';
import { getLevelFromXp } from '../utils/levelUtils';
import { Button } from '../components/common/Button';
import { StatCard } from '../components/cards/StatCard';
import { 
  User, 
  Mail, 
  LogOut, 
  Settings,
  Languages,
  Volume2,
  VolumeX,
  Zap,
  Flame,
  CheckSquare,
  Globe
} from 'lucide-react';
import type { TargetLanguage } from '../types/language';
import { useSound } from '../context/SoundContext';
import './Profile.css';

export const ProfilePage: React.FC = () => {
  const { user, isGuest, logout } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const { targetLanguage, setTargetLanguage } = useTargetLanguage();
  const { progress } = useProgress();
  const { soundEnabled, toggleSound } = useSound();

  const currentLevel = getLevelFromXp(progress.totalXp);

  const handleTargetLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setTargetLanguage(e.target.value as TargetLanguage);
  };

  return (
    <div className="profile-page-premium animate-fade-in">
      <div className="profile-header-premium">
        <div className="profile-avatar-premium">
          <User size={56} />
        </div>
        <div className="profile-info-premium">
          <h1>{user?.name || (isGuest ? 'Guest User' : 'User')}</h1>
          <p className="profile-email-premium">
            <Mail size={16} />
            {user?.email || 'guest@linguaai.com'}
          </p>
          <div className="profile-badges-premium">
            <span className="level-badge-premium">
              {t('level')}: {t(currentLevel.toLowerCase().replace('-', '_'))}
            </span>
            <span className="target-language-badge-small">
              {targetLanguage}
            </span>
          </div>
        </div>
      </div>

      <div className="stats-row-premium">
        <StatCard 
          label={t('xp')} 
          value={progress.totalXp} 
          icon={<Zap size={24} />} 
          variant="accent"
        />
        <StatCard 
          label={t('streak')} 
          value={`${progress.streak}`} 
          icon={<Flame size={24} />} 
          variant="accent"
        />
        <StatCard 
          label={t('completed')} 
          value={progress.completedLessonIds.length} 
          icon={<CheckSquare size={24} />} 
          variant="secondary"
        />
      </div>

      <div className="settings-container-premium">
        <div className="settings-group">
          <div className="settings-group-header">
            <Settings size={20} />
            <h3>Preferences</h3>
          </div>
          <div className="settings-list">
            <div className="setting-item-premium">
              <div className="setting-label-premium">
                <Languages size={18} />
                <span>{t('interface_language')}</span>
              </div>
              <select 
                value={language} 
                onChange={(e) => setLanguage(e.target.value as any)}
                className="setting-select-premium"
              >
                <option value="en">English</option>
                <option value="tr">Türkçe</option>
              </select>
            </div>
            
            <div className="setting-divider"></div>

            <div className="setting-item-premium">
              <div className="setting-label-premium">
                <Globe size={18} />
                <span>{t('target_language')}</span>
              </div>
              <select 
                value={targetLanguage} 
                onChange={handleTargetLanguageChange}
                className="setting-select-premium"
              >
                <option value="English">English</option>
                <option value="German">German</option>
                <option value="Spanish">Spanish</option>
                <option value="French">French</option>
                <option value="Arabic">Arabic</option>
              </select>
            </div>

            <div className="setting-divider"></div>

            <div className="setting-item-premium">
              <div className="setting-label-premium">
                {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
                <span>{t('sound_effects')}</span>
              </div>
              <label className="toggle-switch">
                <input 
                  type="checkbox" 
                  checked={soundEnabled} 
                  onChange={toggleSound} 
                />
                <span className="slider round"></span>
              </label>
            </div>
          </div>
        </div>

        <div className="settings-group">
          <div className="settings-group-header">
            <User size={20} />
            <h3>Account</h3>
          </div>
          <div className="settings-list">
            <Button variant="danger" onClick={logout} leftIcon={<LogOut size={18} />} className="full-width-btn">
              {t('logout')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
