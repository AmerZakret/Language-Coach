import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { lessonsApi, type Lesson } from '../services/lessonsApi';
import { progressApi } from '../services/progressApi';
import { useAuth } from '../contexts/AuthContext';
import { CheckCircle, ArrowLeft, ArrowRight, RefreshCw, Award } from 'lucide-react';
import './Lessons.css';

export const LessonQuizPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Quiz state
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [showResults, setShowResults] = useState(false);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    const fetchLesson = async () => {
      if (id) {
        try {
          const data = await lessonsApi.getLessonById(id);
          setLesson(data);
        } catch (error) {
          console.error("Failed to fetch lesson", error);
        } finally {
          setLoading(false);
        }
      }
    };
    fetchLesson();
  }, [id]);

  const handleSelectAnswer = (questionId: string, answer: string) => {
    if (showResults) return;
    setSelectedAnswers(prev => ({
      ...prev,
      [questionId]: answer
    }));
  };

  const calculateScore = () => {
    if (!lesson?.questions) return 100;
    let correct = 0;
    lesson.questions.forEach(q => {
      if (selectedAnswers[q.id] === q.correctAnswer) correct++;
    });
    return Math.round((correct / lesson.questions.length) * 100);
  };

  const handleSubmit = async () => {
    if (showResults) return;
    setShowResults(true);
    
    if (!user || !lesson) return;
    setCompleting(true);
    try {
      const score = calculateScore();
      await progressApi.completeLesson(user.id, lesson.id, score);
    } catch (error) {
      console.error("Failed to complete lesson", error);
    } finally {
      setCompleting(false);
    }
  };

  if (loading) return <div className="loading">Loading lesson...</div>;
  if (!lesson) return <div className="error-state">Lesson not found.</div>;

  const hasQuestions = lesson.questions && lesson.questions.length > 0;
  const currentQuestion = hasQuestions ? lesson.questions![currentQuestionIndex] : null;
  const isLastQuestion = hasQuestions && currentQuestionIndex === lesson.questions!.length - 1;
  const score = calculateScore();

  return (
    <div className="lessons-page animate-fade-in">
      <button className="back-btn" onClick={() => navigate('/lessons')}>
        <ArrowLeft size={20} /> Back to Lessons
      </button>

      <div className="glass-panel lesson-quiz-container">
        <div className="lesson-header">
          <div>
            <div className="lesson-meta">
              <span className="badge">{lesson.level}</span>
              <span className="points">{lesson.xpReward} XP</span>
            </div>
            <h1 className="page-title">{lesson.title}</h1>
            <p className="lesson-desc">{lesson.description}</p>
          </div>
        </div>
        
        <div className="lesson-content">
          {!hasQuestions ? (
            <div className="no-questions">
              <p>This lesson is reading-only. No questions available.</p>
              <button className="primary" onClick={handleSubmit} disabled={completing || showResults}>
                <CheckCircle size={20} /> {completing ? 'Completing...' : 'Mark as Completed'}
              </button>
            </div>
          ) : showResults ? (
            <div className="quiz-results animate-fade-in">
              <Award size={64} color="var(--warning)" className="award-icon" />
              <h2>Lesson Completed!</h2>
              <div className="score-circle">
                <span className="score-number">{score}%</span>
                <span className="score-label">Score</span>
              </div>
              <div className="results-actions">
                <button className="secondary" onClick={() => navigate('/lessons')}>
                  Return to Lessons
                </button>
                <button className="primary" onClick={() => {
                  setShowResults(false);
                  setSelectedAnswers({});
                  setCurrentQuestionIndex(0);
                }}>
                  <RefreshCw size={18} /> Retry Quiz
                </button>
              </div>
            </div>
          ) : currentQuestion ? (
            <div className="quiz-section animate-fade-in" key={currentQuestion.id}>
              <div className="quiz-progress">
                Question {currentQuestionIndex + 1} of {lesson.questions!.length}
              </div>
              
              <h3 className="question-text">{currentQuestion.text}</h3>
              
              <div className="options-grid">
                {currentQuestion.options.map((option, idx) => {
                  const isSelected = selectedAnswers[currentQuestion.id] === option;
                  return (
                    <button 
                      key={idx}
                      className={`option-btn ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleSelectAnswer(currentQuestion.id, option)}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
              
              <div className="quiz-actions">
                <button 
                  className="secondary" 
                  disabled={currentQuestionIndex === 0}
                  onClick={() => setCurrentQuestionIndex(prev => prev - 1)}
                >
                  <ArrowLeft size={18} /> Previous
                </button>
                
                {!isLastQuestion ? (
                  <button 
                    className="primary" 
                    onClick={() => setCurrentQuestionIndex(prev => prev + 1)}
                    disabled={!selectedAnswers[currentQuestion.id]}
                  >
                    Next <ArrowRight size={18} />
                  </button>
                ) : (
                  <button 
                    className="primary success" 
                    onClick={handleSubmit}
                    disabled={!selectedAnswers[currentQuestion.id] || completing}
                  >
                    <CheckCircle size={18} /> {completing ? 'Submitting...' : 'Submit Answers'}
                  </button>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
