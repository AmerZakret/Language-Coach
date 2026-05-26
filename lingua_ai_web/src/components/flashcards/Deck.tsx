import React, { useState, useRef, useEffect } from 'react';
import { Flashcard } from './Flashcard';
import './Deck.css';

interface CardData {
  _id: string;
  targetWord: string;
  turkishTranslation: string;
  aiContext: {
    sentences: string[];
    mnemonic: string;
  };
}

interface DeckProps {
  cards: CardData[];
  onReview: (cardId: string, score: number) => void;
  onComplete: () => void;
}

export const Deck: React.FC<DeckProps> = ({ cards, onReview, onComplete }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  
  const deckRef = useRef<HTMLDivElement>(null);
  const startPos = useRef({ x: 0, y: 0 });

  const currentCard = cards[currentIndex];

  const handleScore = (score: number) => {
    onReview(currentCard._id, score);
    
    // Animate out
    const direction = score >= 3 ? 1 : -1;
    setDragOffset({ x: direction * 500, y: 0 });
    
    setTimeout(() => {
      if (currentIndex < cards.length - 1) {
        setCurrentIndex(prev => prev + 1);
        setIsFlipped(false);
        setDragOffset({ x: 0, y: 0 });
      } else {
        onComplete();
      }
    }, 300);
  };

  // Mouse/Touch Drag Handlers
  const onStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (isFlipped) return; // Only drag if not flipped to prevent confusion
    setIsDragging(true);
    const pos = 'touches' in e ? e.touches[0] : e;
    startPos.current = { x: pos.clientX, y: pos.clientY };
  };

  const onMove = (e: MouseEvent | TouchEvent) => {
    if (!isDragging) return;
    const pos = 'touches' in e ? e.touches[0] : e;
    const x = pos.clientX - startPos.current.x;
    const y = pos.clientY - startPos.current.y;
    setDragOffset({ x, y });
  };

  const onEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);
    
    if (Math.abs(dragOffset.x) > 150) {
      handleScore(dragOffset.x > 0 ? 5 : 0);
    } else {
      setDragOffset({ x: 0, y: 0 });
    }
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onEnd);
      window.addEventListener('touchmove', onMove);
      window.addEventListener('touchend', onEnd);
    }
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, [isDragging, dragOffset]);

  if (!currentCard) {
    return (
      <div className="deck-empty">
        <h2>All caught up! 🎉</h2>
        <p>Come back later for your next review.</p>
      </div>
    );
  }

  const rotation = dragOffset.x / 20;
  const opacity = Math.max(1 - Math.abs(dragOffset.x) / 500, 0.5);

  return (
    <div className="deck-container" ref={deckRef}>
      <div className="deck-stack">
        <div 
          className="deck-card-wrapper"
          style={{ 
            transform: `translate(${dragOffset.x}px, ${dragOffset.y}px) rotate(${rotation}deg)`,
            opacity: opacity,
            cursor: isDragging ? 'grabbing' : 'grab'
          }}
          onMouseDown={onStart}
          onTouchStart={onStart}
        >
          <Flashcard 
            word={currentCard.targetWord}
            translation={currentCard.turkishTranslation}
            sentences={currentCard.aiContext.sentences}
            mnemonic={currentCard.aiContext.mnemonic}
            isFlipped={isFlipped}
            onFlip={setIsFlipped}
          />
          
          <div className={`swipe-indicator left ${dragOffset.x < -50 ? 'visible' : ''}`} style={{ opacity: Math.min(-dragOffset.x / 100, 1) }}>
            FORGOT
          </div>
          <div className={`swipe-indicator right ${dragOffset.x > 50 ? 'visible' : ''}`} style={{ opacity: Math.min(dragOffset.x / 100, 1) }}>
            GOT IT
          </div>
        </div>
      </div>

      <div className="scoring-buttons">
        {[0, 1, 2, 3, 4, 5].map(score => (
          <button 
            key={score} 
            className={`score-btn score-${score}`}
            onClick={() => handleScore(score)}
          >
            <span className="score-num">{score}</span>
            <span className="score-label">
              {score === 0 ? 'Forgot' : score === 5 ? 'Easy' : ''}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
