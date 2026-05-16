import React, { useState, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useTargetLanguage } from '../context/TargetLanguageContext';
import { useProgress } from '../context/ProgressContext';
import { getLessons } from '../api/lessonsApi';
import { fallbackLessons } from '../data/fallbackLessons';
import type { Lesson } from '../types/lesson';
import { LessonCard } from '../components/cards/LessonCard';
import { useNavigate } from 'react-router-dom';
import './Lessons.css';

export const LessonsPage: React.FC = () => {
  const { t } = useLanguage();
  const { targetLanguage } = useTargetLanguage();
  const { progress } = useProgress();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const loadLessons = async () => {
      setLoading(true);
      try {
        const data = await getLessons(targetLanguage);
        setLessons(data);
      } catch (e) {
        console.error('Failed to load lessons, using fallback', e);
        setLessons(fallbackLessons.filter(l => l.targetLanguage === targetLanguage));
      } finally {
        setLoading(false);
      }
    };

    loadLessons();
  }, [targetLanguage]);

  // Group lessons by level
  const groupedLessons = lessons.reduce((acc, lesson) => {
    const level = lesson.level || 'Beginner'; // Fallback to Beginner if no level
    if (!acc[level]) {
      acc[level] = [];
    }
    acc[level].push(lesson);
    return acc;
  }, {} as Record<string, Lesson[]>);

  // Define section configuration
  const sections = [
    { level: 'Beginner', title: 'Beginner', subtitle: 'Basic foundations' },
    { level: 'Elementary', title: 'Elementary', subtitle: 'Build core grammar' },
    { level: 'Pre-Intermediate', title: 'Pre-Intermediate', subtitle: 'Improve communication' },
  ];

  // Logic for unlocking levels based on progress
  const isLevelCompleted = (level: string) => {
    const levelLessons = groupedLessons[level] || [];
    if (levelLessons.length === 0) return false;
    return levelLessons.every((l) => progress.completedLessonIds.includes(l.id));
  };

  const isSectionLocked = (level: string) => {
    if (level === 'Beginner') return false; // Always unlocked
    if (level === 'Elementary') return !isLevelCompleted('Beginner');
    if (level === 'Pre-Intermediate') return !isLevelCompleted('Elementary');
    return false;
  };

  return (
    <div className="lessons-page animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">{t('available_lessons')}</h1>
        <p className="page-subtitle">
          {t('learning')}: <strong>{targetLanguage}</strong>
        </p>
      </div>

      {loading ? (
        <div className="loading-container">
          <div className="spinner"></div>
        </div>
      ) : lessons.length === 0 ? (
        <div className="empty-state-container">
          <div className="empty-state">
            <h3>Lessons not available</h3>
            <p>We are currently adding more content for this language.</p>
          </div>
        </div>
      ) : (
        <div className="curriculum-container">
          {sections.map(({ level, title, subtitle }) => {
            const levelLessons = groupedLessons[level];
            if (!levelLessons || levelLessons.length === 0) return null;
            
            const isLocked = isSectionLocked(level);

            return (
              <section key={level} className="level-section">
                <div className="level-header">
                  <div className="level-header-content">
                    <h2 className="level-title">{title}</h2>
                    <p className="level-subtitle">{subtitle}</p>
                  </div>
                  <div className="level-progress-info">
                    <div className="level-progress-text">
                      <strong>{t('progress')}</strong>: {levelLessons.filter(l => progress.completedLessonIds.includes(l.id)).length} / {levelLessons.length} {t('lessons').toLowerCase()}
                    </div>
                    <div className="level-progress-bar">
                      <div 
                        className="level-progress-fill" 
                        style={{ width: `${(levelLessons.filter(l => progress.completedLessonIds.includes(l.id)).length / levelLessons.length) * 100}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
                <div className="lessons-grid">
                  {levelLessons.map((lesson) => (
                    <LessonCard
                      key={lesson.id}
                      lesson={lesson}
                      isCompleted={progress.completedLessonIds.includes(lesson.id)}
                      isLocked={isLocked}
                      onClick={() => navigate(`/lessons/${lesson.id}`)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};
