import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import './AppLayout.css';

export const AppLayout: React.FC = () => {
  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-wrapper">
        <Topbar />
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
