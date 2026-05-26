import { useState } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router";
import { ThemeProvider } from "./components/ThemeContext";
import { AuthPage } from "./components/AuthPage";
import { Layout } from "./components/Layout";
import { Dashboard } from "./components/Dashboard";
import { LessonsPage } from "./components/LessonsPage";
import { LessonQuiz } from "./components/LessonQuiz";
import { AICoach } from "./components/AICoach";
import { FlashcardsPage } from "./components/FlashcardsPage";
import { WritingPractice } from "./components/WritingPractice";
import { ProfilePage } from "./components/ProfilePage";

function AppRoutes({ userName, onLogout }: { userName: string; onLogout: () => void }) {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/* Lesson quiz — full-screen, no sidebar */}
      <Route path="/lessons/quiz/:id" element={<LessonQuiz />} />

      {/* Main app with sidebar layout */}
      <Route
        path="/*"
        element={
          <Layout user={{ name: userName, xp: 450, streak: 7, language: "German" }} onLogout={onLogout}>
            <Routes>
              <Route path="/dashboard" element={<Dashboard userName={userName} />} />
              <Route path="/lessons" element={<LessonsPage />} />
              <Route path="/coach" element={<AICoach />} />
              <Route path="/flashcards" element={<FlashcardsPage />} />
              <Route path="/writing" element={<WritingPractice />} />
              <Route path="/profile" element={<ProfilePage userName={userName} onLogout={onLogout} />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Layout>
        }
      />
    </Routes>
  );
}

export default function App() {
  const [user, setUser] = useState<string | null>(null);

  return (
    <ThemeProvider>
      {!user ? (
        <AuthPage onAuth={(name) => setUser(name)} />
      ) : (
        <HashRouter>
          <AppRoutes userName={user} onLogout={() => setUser(null)} />
        </HashRouter>
      )}
    </ThemeProvider>
  );
}
