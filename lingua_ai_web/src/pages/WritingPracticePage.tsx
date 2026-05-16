import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useTargetLanguage } from '../context/TargetLanguageContext';
import { useProgress } from '../context/ProgressContext';
import { sendMessage } from '../api/aiCoachApi';
import { writingTopics } from '../data/writingTopics';
import { Button } from '../components/common/Button';
import { RefreshCw, Send, Sparkles } from 'lucide-react';
import './WritingPractice.css';

interface WritingResult {
  feedback: string;
  corrected: string;
  mistakes: string[];
  scores: {
    grammar: number;
    vocabulary: number;
    clarity: number;
  };
}

export const WritingPracticePage: React.FC = () => {
  const { user, isGuest } = useAuth();
  const { language, t } = useLanguage();
  const { targetLanguage } = useTargetLanguage();
  const { addXp } = useProgress();

  const [topic, setTopic] = useState(writingTopics[targetLanguage][0]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WritingResult | null>(null);

  // Sync topic when target language changes
  React.useEffect(() => {
    setTopic(writingTopics[targetLanguage][0]);
    setResult(null);
    setText('');
  }, [targetLanguage]);

  const suggestTopic = () => {
    const currentTopics = writingTopics[targetLanguage];
    let nextTopic = currentTopics[Math.floor(Math.random() * currentTopics.length)];
    while (nextTopic === topic && currentTopics.length > 1) {
      nextTopic = currentTopics[Math.floor(Math.random() * currentTopics.length)];
    }
    setTopic(nextTopic);
    setResult(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || text.length < 20 || loading) return;

    setLoading(true);
    try {
      // Reusing AI Coach endpoint with specific prompt for writing correction
      const prompt = `Writing correction request. 
      Topic: ${topic}
      Target Language: ${targetLanguage}
      User Text: ${text}
      
      Please return a JSON-style response with:
      - feedback: brief overall feedback
      - corrected: fully corrected version
      - mistakes: list of major mistakes
      - scores: { grammar: 0-10, vocabulary: 0-10, clarity: 0-10 }`;

      const response = await sendMessage({
        userId: user?.email || (isGuest ? 'guest' : 'unknown'),
        message: prompt,
        language: language,
        targetLanguage: targetLanguage
      });

      // Try to parse the structured response
      let finalResult: WritingResult;
      try {
        // Look for JSON pattern in the reply if it's wrapped in text
        const jsonMatch = response.reply.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          finalResult = JSON.parse(jsonMatch[0]);
        } else {
          // Fallback if no JSON found
          finalResult = {
            feedback: language === 'tr' ? 'Harika bir deneme!' : 'Great attempt!',
            corrected: response.reply,
            mistakes: [],
            scores: { grammar: 8, vocabulary: 8, clarity: 8 }
          };
        }
      } catch (e) {
        console.warn('Failed to parse AI response as JSON', e);
        finalResult = {
          feedback: response.reply,
          corrected: response.correction || response.reply,
          mistakes: [],
          scores: { grammar: 0, vocabulary: 0, clarity: 0 }
        };
      }

      setResult(finalResult);
      addXp(10); // Award XP for writing practice
    } catch (e) {
      console.error('Writing check failed', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="writing-page animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">{t('writing_practice')}</h1>
        <p className="page-subtitle">{t('practicing')}: <strong>{targetLanguage}</strong></p>
      </div>

      <div className={`writing-container ${result ? 'has-results' : ''}`}>
        <div className="writing-main">
          <div className="topic-card glass-panel">
            <div className="topic-header">
              <h3>{t('topic')}</h3>
              <Button variant="ghost" size="sm" onClick={suggestTopic} leftIcon={<RefreshCw size={16} />}>
                {t('suggest_topic')}
              </Button>
            </div>
            <div className="topic-text">{topic}</div>
          </div>

          <form className="writing-form glass-panel" onSubmit={handleSubmit}>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`${t('write_at_least_20_chars')}...`}
              rows={10}
              disabled={loading}
            />
            <div className="form-footer">
              <span className="char-count">{text.length} / 500</span>
              <Button type="submit" disabled={text.length < 20 || loading} isLoading={loading} leftIcon={<Send size={18} />}>
                {t('check_writing')}
              </Button>
            </div>
          </form>
        </div>

        {result && (
          <div className="writing-results animate-fade-in">
            <div className="result-card glass-panel">
              <div className="result-header">
                <Sparkles size={24} className="sparkle-icon" />
                <h3>{t('feedback')}</h3>
                <span className="xp-badge">+10 XP</span>
              </div>
              
              <p className="feedback-text">{result.feedback}</p>

              <div className="result-section">
                <h4>{t('corrected_version')}</h4>
                <div className="corrected-box">{result.corrected}</div>
              </div>

              <div className="result-section">
                <h4>{t('mistakes')}</h4>
                <ul className="mistakes-list">
                  {result.mistakes.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>

              <div className="scores-grid">
                <div className="score-item">
                  <span className="score-label">{t('grammar')}</span>
                  <div className="score-bar"><div className="fill" style={{ width: `${result.scores.grammar * 10}%` }}></div></div>
                  <span className="score-val">{result.scores.grammar}/10</span>
                </div>
                <div className="score-item">
                  <span className="score-label">{t('vocabulary')}</span>
                  <div className="score-bar"><div className="fill" style={{ width: `${result.scores.vocabulary * 10}%` }}></div></div>
                  <span className="score-val">{result.scores.vocabulary}/10</span>
                </div>
                <div className="score-item">
                  <span className="score-label">{t('clarity')}</span>
                  <div className="score-bar"><div className="fill" style={{ width: `${result.scores.clarity * 10}%` }}></div></div>
                  <span className="score-val">{result.scores.clarity}/10</span>
                </div>
              </div>

              <Button variant="outline" className="full-width" onClick={() => { setResult(null); setText(''); }}>
                {t('try_another')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
