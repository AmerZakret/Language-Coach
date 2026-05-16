import React from 'react';
import './StatCard.css';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: string;
  variant?: 'primary' | 'secondary' | 'accent';
}

export const StatCard: React.FC<StatCardProps> = ({ label, value, icon, trend, variant = 'primary' }) => {
  return (
    <div className={`stat-card variant-${variant}`}>
      <div className="stat-icon">
        {icon}
      </div>
      <div className="stat-content">
        <span className="stat-label">{label}</span>
        <h3 className="stat-value">{value}</h3>
        {trend && <span className="stat-trend">{trend}</span>}
      </div>
    </div>
  );
};
