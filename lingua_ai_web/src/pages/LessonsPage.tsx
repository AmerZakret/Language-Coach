import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, CheckCircle2, Lock, Clock, Zap, ChevronRight, Star } from "lucide-react";

import { useTargetLanguage } from "../context/TargetLanguageContext";
import { useProgress } from "../context/ProgressContext";
import { getLessons } from "../api/lessonsApi";
import { fallbackLessons } from "../data/fallbackLessons";
import type { Lesson } from "../types/lesson";

const DIFF_COLORS: Record<string, { bg: string; text: string }> = {
  Easy: { bg: "rgba(16,185,129,0.12)", text: "#10B981" },
  Medium: { bg: "rgba(99,102,241,0.12)", text: "#6366F1" },
  Hard: { bg: "rgba(245,158,11,0.12)", text: "#F59E0B" },
};

export function LessonsPage() {

  const { targetLanguage } = useTargetLanguage();
  const { progress } = useProgress();
  const navigate = useNavigate();

  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadLessons = async () => {
      setLoading(true);
      try {
        const data = await getLessons(targetLanguage);
        setLessons(data);
      } catch (e) {
        console.error("Failed to load lessons", e);
        setLessons(fallbackLessons.filter((l) => l.targetLanguage === targetLanguage));
      } finally {
        setLoading(false);
      }
    };
    loadLessons();
  }, [targetLanguage]);

  const groupedLessons = lessons.reduce((acc, lesson) => {
    const level = lesson.level || "Beginner";
    if (!acc[level]) acc[level] = [];
    acc[level].push(lesson);
    return acc;
  }, {} as Record<string, Lesson[]>);

  const isLevelCompleted = (level: string) => {
    const levelLessons = groupedLessons[level] || [];
    if (levelLessons.length === 0) return false;
    return levelLessons.every((l) => progress.completedLessonIds.includes(l.id));
  };

  const isSectionLocked = (level: string) => {
    if (level === "Beginner") return false;
    if (level === "Elementary") return !isLevelCompleted("Beginner");
    if (level === "Pre-Intermediate") return !isLevelCompleted("Elementary");
    return false;
  };

  const SECTIONS = [
    { level: "Beginner", desc: "Build your foundation — greetings, basics, and core vocabulary", color: "#10B981" },
    { level: "Elementary", desc: "Build core grammar and expand vocabulary", color: "#6366F1" },
    { level: "Pre-Intermediate", desc: "Tackle complex structures and real-world scenarios", color: "#F59E0B" },
  ];

  const totalCompleted = lessons.filter(l => progress.completedLessonIds.includes(l.id)).length;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8 animate-fade-in">
      <div>
        <h1 style={{ color: "var(--l-text)", fontWeight: 800, fontSize: "26px", letterSpacing: "-0.02em" }}>Curriculum</h1>
        <p style={{ fontSize: "14px", color: "var(--l-muted)", marginTop: "4px" }}>
          Your {targetLanguage} learning path — <span style={{ color: "#6366F1" }}>{totalCompleted} of {lessons.length}</span> lessons completed
        </p>
      </div>

      {loading ? (
        <div style={{ color: "var(--l-text)", fontSize: "14px" }}>Loading...</div>
      ) : lessons.length === 0 ? (
        <div style={{ color: "var(--l-text)", fontSize: "14px" }}>No lessons available for {targetLanguage}</div>
      ) : (
        SECTIONS.map((section) => {
          const levelLessons = groupedLessons[section.level];
          if (!levelLessons || levelLessons.length === 0) return null;

          const isLocked = isSectionLocked(section.level);
          const completedCount = levelLessons.filter((l) => progress.completedLessonIds.includes(l.id)).length;
          const totalCount = levelLessons.length;

          return (
            <div key={section.level}>
              <div className="flex items-start gap-4 mb-5 p-4 rounded-2xl" style={{ background: `${section.color}08`, border: `1px solid ${section.color}18` }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mt-0.5" style={{ background: `${section.color}15` }}>
                  <Star size={18} color={section.color} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <h2 style={{ fontSize: "17px", fontWeight: 800, color: "var(--l-text)" }}>{section.level}</h2>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: section.color, background: `${section.color}15`, padding: "2px 8px", borderRadius: "999px" }}>
                      {completedCount}/{totalCount} done
                    </span>
                  </div>
                  <p style={{ fontSize: "13px", color: "var(--l-muted)", marginBottom: "10px" }}>{section.desc}</p>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--l-surface3)" }}>
                    <div className="h-full rounded-full" style={{ width: `${(completedCount / totalCount) * 100}%`, background: `linear-gradient(90deg, ${section.color}, ${section.color}88)` }} />
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {levelLessons.map((lesson) => {
                  const isCompleted = progress.completedLessonIds.includes(lesson.id);
                  const diffStyle = DIFF_COLORS[lesson.difficulty || "Medium"] || DIFF_COLORS["Medium"];
                  const locked = isLocked;

                  return (
                    <button
                      key={lesson.id}
                      disabled={locked}
                      onClick={() => navigate(`/lessons/${lesson.id}`)}
                      className="w-full text-left p-4 rounded-2xl transition-all duration-200 flex items-start gap-4"
                      style={{
                        background: locked ? "var(--l-card-hover)" : "var(--l-surface)",
                        border: isCompleted ? `1px solid ${section.color}30` : locked ? "1px solid var(--l-border-subtle)" : "1px solid var(--l-border)",
                        opacity: locked ? 0.55 : 1,
                        cursor: locked ? "not-allowed" : "pointer",
                      }}
                      onMouseEnter={(e) => { if (!locked) { (e.currentTarget as HTMLButtonElement).style.borderColor = `${section.color}40`; (e.currentTarget as HTMLButtonElement).style.transform = "translateX(2px)"; } }}
                      onMouseLeave={(e) => { if (!locked) { (e.currentTarget as HTMLButtonElement).style.borderColor = isCompleted ? `${section.color}30` : "var(--l-border)"; (e.currentTarget as HTMLButtonElement).style.transform = "translateX(0)"; } }}
                    >
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: isCompleted ? `${section.color}20` : "var(--l-card-hover)" }}>
                        {isCompleted ? <CheckCircle2 size={18} color={section.color} /> : locked ? <Lock size={16} color="var(--l-subtle)" /> : <BookOpen size={16} color="var(--l-muted)" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <span style={{ fontSize: "14px", fontWeight: 700, color: locked ? "var(--l-subtle)" : "var(--l-text)" }}>{lesson.title}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span style={{ fontSize: "10px", fontWeight: 700, color: diffStyle.text, background: diffStyle.bg, padding: "2px 8px", borderRadius: "999px" }}>{lesson.difficulty || "Medium"}</span>
                            <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--l-muted)", background: "var(--l-card-hover)", padding: "2px 8px", borderRadius: "999px" }}>{lesson.category || "General"}</span>
                          </div>
                        </div>
                        <p style={{ fontSize: "12px", color: "var(--l-subtle)", marginBottom: "10px" }}>{lesson.description}</p>
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-1"><Clock size={12} color="var(--l-subtle)" /><span style={{ fontSize: "11px", color: "var(--l-subtle)" }}>{lesson.duration} min</span></div>
                          <div className="flex items-center gap-1"><Zap size={12} color="#F59E0B" /><span style={{ fontSize: "11px", color: "#F59E0B", fontWeight: 600 }}>{lesson.xpReward} XP</span></div>
                          <span style={{ fontSize: "11px", color: "var(--l-subtle)" }}>{lesson.questions?.length || 10} questions</span>
                        </div>
                      </div>
                      {!locked && <ChevronRight size={16} color="var(--l-subtle)" className="shrink-0 mt-1" />}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
