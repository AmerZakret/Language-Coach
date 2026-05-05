import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, BookOpen, Bot, User as UserIcon } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import './Sidebar.css';

export const Sidebar: React.FC = () => {
  const { t } = useLanguage();

  const navItems = [
    { to: '/', icon: <LayoutDashboard size={20} />, label: t('dashboard') },
    { to: '/lessons', icon: <BookOpen size={20} />, label: t('lessons') },
    { to: '/ai-coach', icon: <Bot size={20} />, label: t('aiCoach') },
    { to: '/profile', icon: <UserIcon size={20} />, label: t('profile') },
  ];

  return (
    <aside className="sidebar glass-panel">
      <div className="sidebar-logo">
        <Bot size={32} color="var(--primary-color)" />
        <h2>LinguaAI</h2>
      </div>
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <NavLink 
            key={item.to} 
            to={item.to} 
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            {item.icon}
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
};
