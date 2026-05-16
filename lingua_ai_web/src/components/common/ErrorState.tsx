import React from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from './Button';
import './Common.css';

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export const ErrorState: React.FC<ErrorStateProps> = ({ message, onRetry }) => {
  return (
    <div className="error-state glass-panel">
      <AlertCircle size={48} className="error-icon" />
      <h3>Oops! Something went wrong</h3>
      <p>{message}</p>
      {onRetry && (
        <Button onClick={onRetry} variant="outline">
          Try Again
        </Button>
      )}
    </div>
  );
};
