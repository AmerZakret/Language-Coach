import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useTargetLanguage } from '../context/TargetLanguageContext';
import { useProgress } from '../context/ProgressContext';
import { getLessonById } from '../api/lessonsApi';
import { fallbackLessons } from '../data/fallbackLessons';
import type { Lesson } from '../types/lesson';
import { Button } from '../components/common/Button';
import { ArrowLeft, CheckCircle2, XCircle, Trophy } from 'lucide-react';
import { soundService } from '../utils/soundService';
import './LessonQuizPage.css';

export const LessonQuizPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { targetLanguage } = useTargetLanguage();
  const { completeLesson } = useProgress();

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [score, setScore] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadLesson = async () => {
      setLoading(true);
      try {
        if (id) {
          const found = await getLessonById(id);
          setLesson(found);
        }
      } catch (e) {
        console.error('Failed to load lesson by ID, trying fallback', e);
        const fallback = fallbackLessons.find(l => l.id === id);
        if (fallback) setLesson(fallback);
      } finally {
        setLoading(false);
      }
    };
    loadLesson();
  }, [id, targetLanguage]);

  if (loading) return <div className="quiz-loading"><div className="spinner"></div></div>;
  if (!lesson || !lesson.questions || lesson.questions.length === 0) {
    return (
      <div className="quiz-error animate-fade-in">
        <div className="results-card glass-panel">
          <h2>{t('lesson_unavailable')}</h2>
          <p>{t('lesson_no_questions')}</p>
          <Button variant="primary" onClick={() => navigate('/lessons')}>{t('back_to_lessons')}</Button>
        </div>
      </div>
    );
  }

  const questions = lesson.questions;
  const currentQuestion = questions[currentQuestionIndex];
  const isCorrect = selectedOption === currentQuestion.correctAnswer;

  const handleOptionSelect = (option: string) => {
    if (isAnswered) return;
    setSelectedOption(option);
    setIsAnswered(true);
    if (option === currentQuestion.correctAnswer) {
      setScore(s => s + 1);
      soundService.playCorrect();
    } else {
      soundService.playWrong();
    }
  };

  const handleNext = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(i => i + 1);
      setSelectedOption(null);
      setIsAnswered(false);
    } else {
      setIsFinished(true);
      completeLesson(lesson.id, lesson.xpReward);
    }
  };

  if (isFinished) {
    const percentage = (score / questions.length) * 100;
    return (
      <div className="quiz-results animate-fade-in">
        <div className="results-card glass-panel">
          <div className="results-icon">
            <Trophy size={64} className="trophy-icon" />
          </div>
          <h2 className="results-title">{percentage >= 80 ? t('excellent') : t('good_job')}</h2>
          <p className="results-subtitle">{lesson.title}</p>
          
          <div className="results-stats">
            <div className="res-stat">
              <span className="res-stat-val">{score}/{questions.length}</span>
              <span className="res-stat-label">{t('score')}</span>
            </div>
            <div className="res-stat">
              <span className="res-stat-val">+{lesson.xpReward}</span>
              <span className="res-stat-label">{t('xp')}</span>
            </div>
          </div>

          <Button variant="primary" size="lg" className="full-width" onClick={() => navigate('/lessons')}>
            {t('continue')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="quiz-page animate-fade-in">
      <div className="quiz-header">
        <Button variant="ghost" size="sm" onClick={() => navigate('/lessons')} leftIcon={<ArrowLeft size={16} />}>
          {t('back')}
        </Button>
        <div className="quiz-progress">
           <span>{t('question')} {currentQuestionIndex + 1} {t('of')} {questions.length}</span>
           <div className="progress-bar-small">
              <div className="fill" style={{ width: `${((currentQuestionIndex + 1) / questions.length) * 100}%` }}></div>
           </div>
        </div>
      </div>

      <div className="quiz-content-wrapper">
        <div className="question-container">
          <h2 className="question-type">
            {currentQuestion.type === 'fill_blank' ? t('fill_blank') : 
             currentQuestion.type === 'meaning_match' ? t('match_meaning') : 
             t('translate_sentence')}
          </h2>
          <div className="question-text">{currentQuestion.question}</div>
        </div>

        <div className="options-list">
          {currentQuestion.options.map((option) => {
            let state = '';
            if (isAnswered) {
              if (option === currentQuestion.correctAnswer) state = 'correct';
              else if (option === selectedOption) state = 'incorrect';
            } else if (option === selectedOption) {
              state = 'selected';
            }

            return (
              <button 
                key={option} 
                className={`option-btn ${state}`}
                onClick={() => handleOptionSelect(option)}
                disabled={isAnswered}
              >
                {option}
                {state === 'correct' && <CheckCircle2 size={20} className="status-icon" />}
                {state === 'incorrect' && <XCircle size={20} className="status-icon" />}
              </button>
            );
          })}
        </div>

        {isAnswered && (
          <div className={`feedback-area ${isCorrect ? 'correct' : 'incorrect'}`}>
            <div className="feedback-content">
              {isCorrect ? (
                <>
                  <CheckCircle2 size={24} />
                  <span>{t('correct')}</span>
                </>
              ) : (
                <>
                  <XCircle size={24} />
                  <span>{t('incorrect')}: <strong>{currentQuestion.correctAnswer}</strong></span>
                </>
              )}
            </div>
            <Button variant="primary" onClick={handleNext}>
              {currentQuestionIndex < questions.length - 1 ? t('next') : t('finish')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
