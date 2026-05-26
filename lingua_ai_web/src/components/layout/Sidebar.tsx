import React from 'react';
import { NavLink } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { Brain } from 'lucide-react';
import './Sidebar.css';

const aiCoachIcon = '/assets/images/ai-coach-icon.png';

export const Sidebar: React.FC = () => {
  const { t } = useLanguage();

  const navItems = [
    { 
      path: '/', 
      icon: <img src="/assets/images/apps.png" alt="" className="nav-custom-icon" />, 
      label: t('dashboard') 
    },
    { 
      path: '/lessons', 
      icon: <img src="/assets/images/lesson.png" alt="" className="nav-custom-icon" />, 
      label: t('lessons') 
    },
    { 
      path: '/flashcards', 
      icon: <Brain size={24} className="nav-custom-icon" />, 
      label: t('flashcards') 
    },
    { 
      path: '/writing', 
      icon: <img src="/assets/images/writing.png" alt="" className="nav-custom-icon" />, 
      label: t('writing_practice') 
    },
    { 
      path: '/ai-coach', 
      icon: <img src={aiCoachIcon} alt="" className="nav-custom-icon" />, 
      label: t('ai_coach') 
    },
    { 
      path: '/profile', 
      icon: <img src="/assets/images/user.png" alt="" className="nav-custom-icon" />, 
      label: t('profile') 
    },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <img src="/assets/images/logo.png" alt="LinguaAI Logo" className="sidebar-logo-img" />
        <span className="logo-text">Lingua<span className="logo-ai">AI</span></span>
      </div>
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <NavLink 
            key={item.path} 
            to={item.path} 
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
