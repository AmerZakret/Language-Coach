import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { progressApi, type Progress } from '../services/progressApi';
import { useLanguage } from '../contexts/LanguageContext';
import { Flame, Trophy, BookOpen, ArrowRight, Star, CheckCircle, Bot } from 'lucide-react';
import './Dashboard.css';

export const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProgress = async () => {
      try {
        if (user?.id) {
          const data = await progressApi.getUserProgress(user.id);
          setProgress(data);
        }
      } catch (error) {
        console.error("Failed to fetch progress", error);
      } finally {
        setLoading(false);
      }
    };
    fetchProgress();
  }, [user]);

  if (loading) return <div className="loading">Loading dashboard...</div>;

  return (
    <div className="dashboard animate-fade-in">
      <div className="dashboard-welcome">
        <div>
          <h1>{t('welcome')}, {user?.name || 'Guest'}!</h1>
          <p>Ready to continue your language journey today?</p>
        </div>
        <button className="primary" onClick={() => navigate('/lessons')}>
          Continue Learning <ArrowRight size={18} />
        </button>
      </div>
      
      <div className="stats-grid">
        <div className="stat-card glass-panel">
          <div className="stat-icon warning-bg">
            <Flame size={28} />
          </div>
          <div className="stat-content">
            <h3>{progress?.stats?.streak || 0} Days</h3>
            <p>{t('streak')}</p>
          </div>
        </div>
        
        <div className="stat-card glass-panel">
          <div className="stat-icon primary-bg">
            <Trophy size={28} />
          </div>
          <div className="stat-content">
            <h3>{progress?.level || 'Beginner'}</h3>
            <p>{t('level')}</p>
          </div>
        </div>
        
        <div className="stat-card glass-panel">
          <div className="stat-icon secondary-bg">
            <BookOpen size={28} />
          </div>
          <div className="stat-content">
            <h3>{progress?.stats?.completedLessonsCount || 0}</h3>
            <p>Completed {t('lessons')}</p>
          </div>
        </div>
        
        <div className="stat-card glass-panel">
          <div className="stat-icon pink-bg">
            <Star size={28} />
          </div>
          <div className="stat-content">
            <h3>{progress?.stats?.totalXp || 0}</h3>
            <p>Total XP</p>
          </div>
        </div>
      </div>
      
      <div className="dashboard-sections">
        <div className="glass-panel recent-lessons">
          <div className="section-header">
            <h2>Recent Activity</h2>
            <button className="text-btn" onClick={() => navigate('/lessons')}>View all</button>
          </div>
          {progress?.completedLessons && progress.completedLessons.length > 0 ? (
            <div className="activity-list">
              {progress.completedLessons.slice(0, 3).map((lesson, idx) => (
                <div key={idx} className="activity-item">
                  <div className="activity-icon"><CheckCircle size={20} color="var(--success)" /></div>
                  <div className="activity-details">
                    <h4>Lesson {lesson.lessonId}</h4>
                    <p>Score: {lesson.score}% • {new Date(lesson.completedAt).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-activity">
              <p>No recent activity. Start a lesson to see your progress!</p>
            </div>
          )}
        </div>
        
        <div className="glass-panel ai-promo" onClick={() => navigate('/ai-coach')}>
          <div className="promo-content">
            <h2>Practice speaking with AI</h2>
            <p>Our intelligent AI coach is ready to help you practice real-world conversations and correct your grammar.</p>
            <button className="secondary outline-btn">
              <Bot size={18} /> Start Chatting
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
