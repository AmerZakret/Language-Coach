import React from 'react';
import type { Lesson } from '../../types/lesson';
import { useLanguage } from '../../context/LanguageContext';
import { Clock, Star, CheckCircle, Lock } from 'lucide-react';
import { soundService } from '../../utils/soundService';
import './LessonCard.css';

interface LessonCardProps {
  lesson: Lesson;
  isCompleted: boolean;
  isLocked?: boolean;
  onClick: () => void;
}

export const LessonCard: React.FC<LessonCardProps> = ({ lesson, isCompleted, isLocked, onClick }) => {
  const { t } = useLanguage();

  const handleClick = () => {
    if (!isLocked) {
      soundService.playClick();
      onClick();
    }
  };

  return (
    <div 
      className={`lesson-card ${isCompleted ? 'completed' : ''} ${isLocked ? 'locked' : ''}`} 
      onClick={handleClick}
      title={isLocked ? t('complete_previous_to_unlock') : undefined}
    >
      <div className="lesson-badge-row">
        <span className={`difficulty-badge ${(lesson.difficulty || 'Beginner').toLowerCase().replace('-', '')}`}>
          {t((lesson.difficulty || 'Beginner').toLowerCase().replace('-', '_'))}
        </span>
        <span className="category-badge">{lesson.category || 'Vocabulary'}</span>
        {isCompleted && <CheckCircle size={20} className="completion-icon" />}
        {isLocked && <Lock size={20} className="locked-icon text-muted" />}
      </div>

      <h3 className="lesson-title">{lesson.title || 'Untitled Lesson'}</h3>
      <p className="lesson-desc">{lesson.description || 'No description available.'}</p>

      <div className="lesson-footer">
        <div className="footer-item">
          <Clock size={16} />
          <span>{lesson.duration} {t('min')}</span>
        </div>
        <div className="footer-item">
          <Star size={16} className="xp-icon" />
          <span>{lesson.xpReward} XP</span>
        </div>
        <div className="footer-item count">
          <span>{(lesson.questions || []).length} {t('questions')}</span>
        </div>
      </div>
    </div>
  );
};
