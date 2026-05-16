import React from 'react';
import './Common.css';

export const LoadingSpinner: React.FC = () => {
  return (
    <div className="loading-spinner-container">
      <div className="spinner"></div>
    </div>
  );
};
