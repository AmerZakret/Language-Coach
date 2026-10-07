import { targetLanguageCode } from '../../utils/targetLanguage';
import React, { useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useTargetLanguage } from '../../context/TargetLanguageContext';
import { Button } from '../common/Button';
import { Plus, Brain } from 'lucide-react';
import apiClient from '../../api/apiClient';
import { createFlashcardOperationId } from '../../utils/flashcardMutation';
import { getSessionRequestConfig } from '../../utils/queueSession';
import './QuickAddFlashcard.css';

export const QuickAddFlashcard: React.FC = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { targetLanguage } = useTargetLanguage();
  const [word, setWord] = useState('');
  const [translation, setTranslation] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const pending = useRef<{ key: string; id: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!word || !translation || !user) return;
    const key = JSON.stringify([user.id, targetLanguage, word, translation]);
    if (pending.current?.key !== key) pending.current = { key, id: createFlashcardOperationId() };

    setLoading(true);
    try {
      await apiClient.post('/flashcards', {
        targetWord: word,
        turkishTranslation: translation,
        targetLanguage: targetLanguageCode(targetLanguage)
      }, { ...getSessionRequestConfig(), headers: { 'X-Idempotency-Key': pending.current.id } });
      pending.current = null;
      setSuccess(true);
      setWord('');
      setTranslation('');
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      console.error('Failed to add flashcard', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="quick-add-card premium-card">
      <div className="qa-header">
        <Brain size={20} className="text-primary" />
        <h3>{t('quick_add_card')}</h3>
      </div>
      
      <form onSubmit={handleSubmit} className="qa-form">
        <div className="qa-inputs">
          <input 
            type="text" 
            placeholder="English word" 
            value={word}
            onChange={(e) => setWord(e.target.value)}
            disabled={loading}
          />
          <input 
            type="text" 
            placeholder="Turkish translation" 
            value={translation}
            onChange={(e) => setTranslation(e.target.value)}
            disabled={loading}
          />
        </div>
        <Button 
          type="submit" 
          variant={success ? 'secondary' : 'primary'} 
          size="sm" 
          isLoading={loading}
          disabled={!word || !translation}
          leftIcon={success ? <Plus size={16} /> : <Plus size={16} />}
        >
          {success ? t('added') : t('add')}
        </Button>
      </form>
    </div>
  );
};
