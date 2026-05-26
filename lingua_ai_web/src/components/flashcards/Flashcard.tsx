import React, { useState } from 'react';
import './Flashcard.css';

interface FlashcardProps {
  word: string;
  translation: string;
  sentences: string[];
  mnemonic: string;
  isFlipped?: boolean;
  onFlip?: (flipped: boolean) => void;
}

export const Flashcard: React.FC<FlashcardProps> = ({ 
  word, 
  translation, 
  sentences, 
  mnemonic,
  isFlipped: controlledFlipped,
  onFlip
}) => {
  const [internalFlipped, setInternalFlipped] = useState(false);
  
  const isFlipped = controlledFlipped !== undefined ? controlledFlipped : internalFlipped;

  const handleFlip = () => {
    const nextState = !isFlipped;
    if (onFlip) {
      onFlip(nextState);
    } else {
      setInternalFlipped(nextState);
    }
  };

  const highlightWord = (text: string, target: string) => {
    const parts = text.split(new RegExp(`(${target})`, 'gi'));
    return parts.map((part, i) => 
      part.toLowerCase() === target.toLowerCase() 
        ? <strong key={i} style={{ color: '#818cf8', fontWeight: 700 }}>{part}</strong> 
        : part
    );
  };

  return (
    <div className={`flashcard-container ${isFlipped ? 'flipped' : ''}`} onClick={handleFlip}>
      <div className="flashcard-inner">
        <div className="flashcard-front">
          <h2 className="word-main">{word}</h2>
          <div className="tap-hint">Tap to flip</div>
        </div>
        
        <div className="flashcard-back">
          <h2 className="word-main" style={{ fontSize: '2rem' }}>{word}</h2>
          <p className="word-translation">{translation}</p>
          
          <div className="context-list">
            {sentences && sentences.map((s, i) => (
              <p key={i} className="context-item">{highlightWord(s, word)}</p>
            ))}
          </div>

          <div className="mnemonic-box">
            <strong>💡 Mnemonic:</strong><br />
            {mnemonic}
          </div>
        </div>
      </div>
    </div>
  );
};
