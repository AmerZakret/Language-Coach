import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import { TargetLanguageProvider } from './context/TargetLanguageContext';
import { ProgressProvider } from './context/ProgressContext';
import { SoundProvider } from './context/SoundContext';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { LessonsPage } from './pages/LessonsPage';
import { LessonQuizPage } from './pages/LessonQuizPage';
import { AiCoachPage } from './pages/AiCoachPage';
import { WritingPracticePage } from './pages/WritingPracticePage';
import { ProfilePage } from './pages/ProfilePage';

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="loading-screen"><div className="spinner"></div></div>;
  }

  return (
    <Routes>
      <Route path="/login" element={!user ? <LoginPage /> : <Navigate to="/" replace />} />
      <Route path="/register" element={!user ? <RegisterPage /> : <Navigate to="/" replace />} />
      
      <Route path="/" element={user ? <AppLayout /> : <Navigate to="/login" replace />}>
        <Route index element={<DashboardPage />} />
        <Route path="lessons" element={<LessonsPage />} />
        <Route path="lessons/:id" element={<LessonQuizPage />} />
        <Route path="writing" element={<WritingPracticePage />} />
        <Route path="ai-coach" element={<AiCoachPage />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>
      
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SoundProvider>
        <TargetLanguageProvider>
          <ProgressProvider>
            <LanguageProvider>
              <Router>
                <AppRoutes />
              </Router>
            </LanguageProvider>
          </ProgressProvider>
        </TargetLanguageProvider>
      </SoundProvider>
    </AuthProvider>
  );
}
