import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useTargetLanguage } from '../context/TargetLanguageContext';
import { useProgress } from '../context/ProgressContext';
import { getProgressToNextLevel } from '../utils/levelUtils';
import { getLessons } from '../api/lessonsApi';
import { fallbackLessons } from '../data/fallbackLessons';
import type { Lesson } from '../types/lesson';
import { StatCard } from '../components/cards/StatCard';
import { Button } from '../components/common/Button';
import { 
  Zap, 
  Flame, 
  CheckSquare, 
  TrendingUp, 
  ArrowRight
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './Dashboard.css';

export const DashboardPage: React.FC = () => {
  const { user, isGuest } = useAuth();
  const { t } = useLanguage();
  const { targetLanguage } = useTargetLanguage();
  const { progress } = useProgress();
  const navigate = useNavigate();

  const [lessons, setLessons] = React.useState<Lesson[]>([]);
  const [loadingLessons, setLoadingLessons] = React.useState(true);

  React.useEffect(() => {
    const loadLessons = async () => {
      setLoadingLessons(true);
      try {
        const data = await getLessons(targetLanguage);
        setLessons(data);
      } catch (e) {
        console.error('Failed to load lessons', e);
        setLessons(fallbackLessons.filter(l => l.targetLanguage === targetLanguage));
      } finally {
        setLoadingLessons(false);
      }
    };
    loadLessons();
  }, [targetLanguage]);

  const levelInfo = getProgressToNextLevel(progress.totalXp);
  
  // Find recommended lesson: first incomplete in current level, or just first incomplete overall
  const recommendedLesson = React.useMemo(() => {
    return lessons.find(l => !progress.completedLessonIds.includes(l.id) && l.level === levelInfo.currentLevel) 
        || lessons.find(l => !progress.completedLessonIds.includes(l.id));
  }, [lessons, progress.completedLessonIds, levelInfo.currentLevel]);

  return (
    <div className="dashboard-page animate-fade-in">
      <section className="welcome-section">
        <div className="welcome-content">
          <h1 className="welcome-title">
            {isGuest ? t('welcome_guest') : `${t('welcome_back')}, ${user?.name}`} 👋
          </h1>
          <p className="welcome-subtitle">
            {t('keep_learning')} {targetLanguage} {t('today')}
          </p>
        </div>
        <div className="target-language-badge">
          <span>🇩🇪</span> {targetLanguage}
        </div>
      </section>

      <div className="stats-grid">
        <StatCard 
          label={t('xp')} 
          value={progress.totalXp} 
          icon={<Zap size={24} />} 
          variant="accent"
        />
        <StatCard 
          label={t('level')} 
          value={t(levelInfo.currentLevel.toLowerCase().replace('-', '_'))} 
          icon={<TrendingUp size={24} />} 
          variant="primary"
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

      <div className="centered-progress-card premium-card">
        <h3>{t('level')}: {t(levelInfo.currentLevel.toLowerCase().replace('-', '_'))}</h3>
        <p className="xp-text">XP: {progress.totalXp} / {progress.totalXp + levelInfo.xpRemaining}</p>
        <div className="progress-bar-container-large">
          <div className="progress-bar-fill-large" style={{ width: `${levelInfo.progress}%` }}></div>
        </div>
      </div>

      <div className="recommended-card premium-card">
        <div className="rec-header">
          <h3>{t('continue_learning')}</h3>
        </div>
        {loadingLessons ? (
          <div className="loading-container"><div className="spinner"></div></div>
        ) : recommendedLesson ? (
          <div className="rec-lesson-content">
            <div className="rec-lesson-details">
              <h4>{recommendedLesson.title}</h4>
              <p>{recommendedLesson.description}</p>
            </div>
            <Button variant="primary" size="lg" onClick={() => navigate(`/lessons/${recommendedLesson.id}`)}>
              {t('start')} <ArrowRight size={20} style={{ marginLeft: 8 }} />
            </Button>
          </div>
        ) : (
          <p className="no-lesson-text">{t('all_caught_up')}</p>
        )}
      </div>

      <div className="lessons-section">
        <h2 className="section-main-title">{t('your_lessons')}</h2>
        {['Beginner', 'Elementary', 'Pre-Intermediate'].map(level => {
          const levelLessons = lessons.filter(l => l.level === level);
          if (levelLessons.length === 0) return null;
          return (
            <div key={level} className="lesson-level-group">
              <h3 className="level-group-title">{t(level.toLowerCase().replace('-', '_'))}</h3>
              <div className="lessons-grid">
                {levelLessons.map(lesson => {
                  const isCompleted = progress.completedLessonIds.includes(lesson.id);
                  return (
                    <div 
                      key={lesson.id} 
                      className={`lesson-grid-card ${isCompleted ? 'completed' : ''}`}
                      onClick={() => navigate(`/lessons/${lesson.id}`)}
                    >
                      <div className="lgc-header">
                        <span className="lgc-category">{lesson.category}</span>
                        {isCompleted && <CheckSquare size={16} className="text-success" />}
                      </div>
                      <h4>{lesson.title}</h4>
                      <p>{lesson.xpReward} XP • {lesson.duration} min</p>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
