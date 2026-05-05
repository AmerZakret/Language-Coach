import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { lessonsApi, type Lesson } from '../services/lessonsApi';
import { useLanguage } from '../contexts/LanguageContext';
import { Play, Clock, Star, BookOpen } from 'lucide-react';
import './Lessons.css';

export const LessonsPage: React.FC = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLessons = async () => {
      try {
        const data = await lessonsApi.getLessons();
        setLessons(data || []);
      } catch (error) {
        console.error("Failed to fetch lessons", error);
      } finally {
        setLoading(false);
      }
    };
    fetchLessons();
  }, []);

  if (loading) return <div className="loading">Loading lessons...</div>;

  return (
    <div className="lessons-page">
      <div className="page-header">
        <h1 className="page-title">{t('lessons')}</h1>
        <p className="page-subtitle">Pick up where you left off or explore new topics.</p>
      </div>
      
      <div className="lessons-grid">
        {lessons.length === 0 ? (
          <div className="empty-state glass-panel">
            <BookOpen size={48} color="var(--text-muted)" />
            <h3>No lessons available</h3>
            <p>Check back later for new content.</p>
          </div>
        ) : (
          lessons.map((lesson, index) => (
            <div 
              key={lesson.id} 
              className="lesson-card glass-panel animate-fade-in"
              style={{ animationDelay: `${index * 0.1}s` }}
            >
              <div className="lesson-info">
                <div className="lesson-type-badge">{lesson.type}</div>
                <h3>{lesson.title}</h3>
                <p>{lesson.description}</p>
                
                <div className="lesson-stats">
                  <div className="stat">
                    <Clock size={16} />
                    <span>{lesson.durationMinutes} min</span>
                  </div>
                  <div className="stat">
                    <Star size={16} color="var(--warning)" />
                    <span>{lesson.xpReward} XP</span>
                  </div>
                </div>
              </div>
              <button 
                className="primary icon-btn full-width"
                onClick={() => navigate(`/lessons/${lesson.id}`)}
              >
                <Play size={18} /> Start Lesson
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
