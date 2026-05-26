import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Zap, Flame, Trophy, BookOpen, Plus, ArrowRight, CheckCircle2, Star } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTargetLanguage } from "../context/TargetLanguageContext";
import { useProgress } from "../context/ProgressContext";
import { getProgressToNextLevel } from "../utils/levelUtils";
import { getLessons } from "../api/lessonsApi";
import { fallbackLessons } from "../data/fallbackLessons";
import type { Lesson } from "../types/lesson";

export function DashboardPage() {
  const { user, isGuest } = useAuth();
  const { targetLanguage } = useTargetLanguage();
  const { progress } = useProgress();
  const navigate = useNavigate();

  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loadingLessons, setLoadingLessons] = useState(true);



  useEffect(() => {
    const loadLessons = async () => {
      setLoadingLessons(true);
      try {
        const data = await getLessons(targetLanguage);
        setLessons(data);
      } catch (e) {
        console.error("Failed to load lessons", e);
        setLessons(fallbackLessons.filter((l) => l.targetLanguage === targetLanguage));
      } finally {
        setLoadingLessons(false);
      }
    };
    loadLessons();
  }, [targetLanguage]);

  const levelInfo = getProgressToNextLevel(progress.totalXp);

  const recommendedLesson = useMemo(() => {
    return (
      lessons.find((l) => !progress.completedLessonIds.includes(l.id) && l.level === levelInfo.currentLevel) ||
      lessons.find((l) => !progress.completedLessonIds.includes(l.id))
    );
  }, [lessons, progress.completedLessonIds, levelInfo.currentLevel]);

  const STATS = [
    { label: "XP Earned", value: progress.totalXp.toString(), icon: Zap, color: "#F59E0B", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.2)" },
    { label: "Current Level", value: levelInfo.currentLevel.replace("Level", "").trim() || levelInfo.currentLevel, icon: Star, color: "#8B5CF6", bg: "rgba(139,92,246,0.12)", border: "rgba(139,92,246,0.2)" },
    { label: "Day Streak", value: progress.streak.toString(), icon: Flame, color: "#F87171", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.2)" },
    { label: "Lessons Done", value: progress.completedLessonIds.length.toString(), icon: Trophy, color: "#10B981", bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.2)" },
  ];

  const levels = ["Beginner", "Elementary", "Pre-Intermediate"];
  const levelColors: Record<string, string> = {
    Beginner: "#10B981",
    Elementary: "#6366F1",
    "Pre-Intermediate": "#F59E0B",
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Welcome header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 style={{ color: "var(--l-text)", fontWeight: 800, fontSize: "26px", letterSpacing: "-0.02em" }}>
            {isGuest ? "Welcome Guest" : `Welcome back, ${user?.name}`} 👋
          </h1>
          <p style={{ fontSize: "14px", color: "var(--l-muted)" }}>
            Keep learning <span style={{ color: "#6366F1", fontWeight: 600 }}>{targetLanguage}</span> today. You're on a roll!
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-2xl" style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}>
          <span style={{ fontSize: "24px" }}>🇩🇪</span>
          <div>
            <div style={{ fontSize: "11px", color: "var(--l-muted)" }}>Target Language</div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--l-text)" }}>{targetLanguage}</div>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {STATS.map(({ label, value, icon: Icon, color, bg, border }) => (
          <div key={label} className="p-4 rounded-2xl" style={{ background: bg, border: `1px solid ${border}` }}>
            <div className="flex items-center justify-between mb-3">
              <Icon size={18} color={color} />
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
            </div>
            <div style={{ fontSize: "26px", fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
            <div style={{ fontSize: "12px", color: "var(--l-muted)", marginTop: "4px" }}>{label}</div>
          </div>
        ))}
      </div>

      {/* XP Progress */}
      <div className="p-5 rounded-2xl" style={{ background: "var(--l-surface)", border: "1px solid var(--l-border)" }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--l-text)" }}>{levelInfo.currentLevel} Progress</div>
            <div style={{ fontSize: "12px", color: "var(--l-muted)", marginTop: "2px" }}>
              {progress.totalXp} / {progress.totalXp + levelInfo.xpRemaining} XP to {levelInfo.nextLevel}
            </div>
          </div>
          <div className="px-3 py-1 rounded-full" style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.25)" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "#6366F1" }}>{Math.round(levelInfo.progress)}%</span>
          </div>
        </div>
        <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "var(--l-surface3)" }}>
          <div className="h-full rounded-full transition-all duration-500 ease-out" style={{ width: `${levelInfo.progress}%`, background: "linear-gradient(90deg, #6366F1, #8B5CF6)" }} />
        </div>
        <div className="flex justify-between mt-2">
          <span style={{ fontSize: "11px", color: "var(--l-subtle)" }}>0 XP</span>
          <span style={{ fontSize: "11px", color: "#6366F1", fontWeight: 600 }}>{levelInfo.xpRemaining} XP away from {levelInfo.nextLevel}!</span>
        </div>
      </div>

      {/* Two-column: Quick Add + Continue Learning */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Flashcards Deck Card */}
        <div className="p-5 rounded-2xl flex flex-col justify-between" style={{ background: "var(--l-surface)", border: "1px solid var(--l-border)" }}>
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(16,185,129,0.15)" }}>
                <Plus size={14} color="#10B981" />
              </div>
              <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--l-text)" }}>Flashcards Deck</span>
            </div>
            <p style={{ fontSize: "13px", color: "var(--l-muted)", lineHeight: 1.5, marginBottom: "16px" }}>
              Build your custom vocabulary deck, add example sentences and notes, and study with spaced repetition.
            </p>
          </div>
          <button
            onClick={() => navigate("/flashcards")}
            className="w-full py-2.5 rounded-xl transition-all duration-200 text-center"
            style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.2)", color: "#10B981", fontSize: "13px", fontWeight: 700 }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(16,185,129,0.22)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(16,185,129,0.12)"; }}
          >
            Manage & Study Cards
          </button>
        </div>

        {/* Continue Learning */}
        <div className="p-5 rounded-2xl relative overflow-hidden" style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.15) 0%, rgba(139,92,246,0.1) 100%)", border: "1px solid rgba(99,102,241,0.2)" }}>
          <div className="absolute top-0 right-0 w-32 h-32 opacity-10" style={{ background: "radial-gradient(circle, #8B5CF6, transparent)" }} />
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#6366F1", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>NEXT UP</div>
          {loadingLessons ? (
            <div style={{ color: "var(--l-text)", fontSize: "14px" }}>Loading...</div>
          ) : recommendedLesson ? (
            <>
              <h3 style={{ fontSize: "17px", fontWeight: 700, color: "var(--l-text)", marginBottom: "6px" }}>{recommendedLesson.title}</h3>
              <p style={{ fontSize: "13px", color: "var(--l-muted)", marginBottom: "16px" }}>
                {recommendedLesson.description} • {recommendedLesson.duration} min · {recommendedLesson.xpReward} XP
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => navigate(`/lessons/${recommendedLesson.id}`)}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl transition-all duration-200"
                  style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)", color: "white", fontSize: "13px", fontWeight: 700, boxShadow: "0 4px 16px rgba(99,102,241,0.4)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)"; }}
                >
                  Continue Learning <ArrowRight size={14} />
                </button>
                <div className="flex items-center gap-1.5">
                  <BookOpen size={13} color="var(--l-muted)" />
                  <span style={{ fontSize: "12px", color: "var(--l-muted)" }}>{recommendedLesson.level}</span>
                </div>
              </div>
            </>
          ) : (
            <div style={{ color: "var(--l-text)" }}>All caught up!</div>
          )}
        </div>
      </div>

      {/* Lesson categories */}
      {levels.map((level) => {
        const levelLessons = lessons.filter((l) => l.level === level);
        if (levelLessons.length === 0) return null;
        const color = levelColors[level] || "#6366F1";
        
        return (
          <div key={level}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-2 h-2 rounded-full" style={{ background: color }} />
              <span style={{ fontSize: "15px", fontWeight: 700, color: "var(--l-text)" }}>{level}</span>
              <div className="flex-1 h-px" style={{ background: "var(--l-border-subtle)" }} />
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {levelLessons.map((lesson) => {
                const isCompleted = progress.completedLessonIds.includes(lesson.id);
                return (
                  <button
                    key={lesson.id}
                    onClick={() => navigate(`/lessons/${lesson.id}`)}
                    className="text-left p-4 rounded-2xl transition-all duration-200"
                    style={{ background: "var(--l-surface)", border: isCompleted ? `1px solid ${color}30` : "1px solid var(--l-border)" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = `${color}40`; (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-2px)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = isCompleted ? `${color}30` : "var(--l-border)"; (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)"; }}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: isCompleted ? `${color}20` : "var(--l-card-hover)" }}>
                        {isCompleted ? <CheckCircle2 size={16} color={color} /> : <BookOpen size={16} color="var(--l-muted)" />}
                      </div>
                      <div className="px-2 py-0.5 rounded-md" style={{ background: `${color}15`, border: `1px solid ${color}25` }}>
                        <span style={{ fontSize: "10px", fontWeight: 700, color: color }}>{lesson.xpReward} XP</span>
                      </div>
                    </div>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--l-text)", marginBottom: "4px" }}>{lesson.title}</div>
                    <div style={{ fontSize: "11px", color: "var(--l-subtle)" }}>{lesson.duration} min</div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
