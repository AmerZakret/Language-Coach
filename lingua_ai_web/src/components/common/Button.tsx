import React from 'react';
import { soundService } from '../../utils/soundService';
import './Button.css';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading,
  leftIcon,
  className = '',
  disabled,
  onClick,
  ...props
}) => {
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!disabled && !isLoading) {
      soundService.playClick();
      if (onClick) onClick(e);
    }
  };

  return (
    <button
      className={`btn btn-${variant} btn-${size} ${className} ${isLoading ? 'btn-loading' : ''}`}
      disabled={disabled || isLoading}
      onClick={handleClick}
      {...props}
    >
      {isLoading ? (
        <span className="spinner-small"></span>
      ) : (
        <>
          {leftIcon && <span className="btn-icon">{leftIcon}</span>}
          {children}
        </>
      )}
    </button>
  );
};
