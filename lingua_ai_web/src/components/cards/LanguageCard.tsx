import React from 'react';
import type { TargetLanguage } from '../../types/language';
import { Globe } from 'lucide-react';
import './StatCard.css'; // Reusing some styles

interface LanguageCardProps {
  language: TargetLanguage;
  isSelected: boolean;
  onClick: () => void;
}

export const LanguageCard: React.FC<LanguageCardProps> = ({ language, isSelected, onClick }) => {
  return (
    <div className={`stat-card language-card ${isSelected ? 'active' : ''}`} onClick={onClick}>
      <div className="stat-icon-wrapper">
        <Globe size={24} />
      </div>
      <div className="stat-info">
        <h3 className="stat-value">{language}</h3>
        <p className="stat-label">{isSelected ? 'Active' : 'Select'}</p>
      </div>
    </div>
  );
};
