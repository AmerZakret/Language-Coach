import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, CheckCircle2, Lock, Star } from "lucide-react";

import { useTargetLanguage } from "../context/TargetLanguageContext";
import { useProgress } from "../context/ProgressContext";
import { useLanguage } from "../context/LanguageContext";
import { getLessons } from "../api/lessonsApi";
import { fallbackLessons } from "../data/fallbackLessons";
import type { Lesson } from "../types/lesson";
import { isLessonLocked } from "../utils/lessonLock";
import { lessonLanguageCode } from "../utils/lessonLanguage";

export function LessonsPage() {

  const { targetLanguage } = useTargetLanguage();
  const { progress } = useProgress();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadLessons = async () => {
      setLoading(true);
      const cacheKey = `linguaai_lessons_${targetLanguage}`;
      try {
        const data = await getLessons(targetLanguage);
        setLessons(data);
        localStorage.setItem(cacheKey, JSON.stringify(data));
      } catch (e) {
        console.error("Failed to load lessons, using cache or fallback", e);
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          try {
            setLessons(JSON.parse(cached));
          } catch {
            setLessons(fallbackLessons.filter((l) => l.targetLanguage === lessonLanguageCode(targetLanguage)));
          }
        } else {
          setLessons(fallbackLessons.filter((l) => l.targetLanguage === lessonLanguageCode(targetLanguage)));
        }
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

  const isSectionLocked = (level: string) => {
    if (level === "Beginner") return false;
    const levelLessons = groupedLessons[level] || [];
    if (levelLessons.length === 0) return false;
    return isLessonLocked(levelLessons[0], lessons, progress.completedLessonIds);
  };

  const SECTIONS = [
    { level: "Beginner", desc: t('beginner') + " — " + t('lesson_desc_beginner'), color: "#10B981" },
    { level: "Elementary", desc: t('elementary') + " — " + t('lesson_desc_elementary'), color: "#6366F1" },
    { level: "Pre-Intermediate", desc: t('pre_intermediate') + " — " + t('lesson_desc_pre_intermediate'), color: "#F59E0B" },
  ];

  const totalCompleted = lessons.filter(l => progress.completedLessonIds.includes(l.id)).length;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8 animate-fade-in">
      <div>
        <h1 style={{ color: "var(--l-text)", fontWeight: 800, fontSize: "26px", letterSpacing: "-0.02em" }}>{t('curriculum')}</h1>
        <p style={{ fontSize: "14px", color: "var(--l-muted)", marginTop: "4px" }}>
          {t('lang_' + targetLanguage.toLowerCase())} {t('learning_path')} — <span style={{ color: "#6366F1" }}>{totalCompleted} {t('of')} {lessons.length}</span> {t('lessons_completed_of')}
        </p>
      </div>

      {loading ? (
        /* Skeleton Grid loader matching the cards layout */
        <div className="space-y-8 animate-fade-in">
          {[1, 2].map((groupIndex) => (
            <div key={groupIndex} className="space-y-5">
              <div className="h-24 rounded-2xl bg-[var(--l-surface)] border border-[var(--l-border)] p-5 flex flex-col justify-between animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[var(--l-surface3)]" />
                  <div className="space-y-2 flex-1">
                    <div className="w-32 h-5 bg-[var(--l-surface3)] rounded" />
                    <div className="w-2/3 h-4 bg-[var(--l-surface3)] rounded" />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 animate-pulse">
                {[1, 2].map((cardIndex) => (
                  <div key={cardIndex} className="p-6 rounded-2xl border border-[var(--l-border)] bg-[var(--l-surface)] h-[270px] flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <div className="w-11 h-11 rounded-xl bg-[var(--l-surface3)]" />
                        <div className="w-20 h-6 bg-[var(--l-surface3)] rounded-full" />
                      </div>
                      <div className="w-24 h-4 bg-[var(--l-surface3)] rounded mb-2" />
                      <div className="w-3/4 h-6 bg-[var(--l-surface3)] rounded mb-3" />
                      <div className="w-full h-4 bg-[var(--l-surface3)] rounded mb-1.5" />
                      <div className="w-5/6 h-4 bg-[var(--l-surface3)] rounded" />
                    </div>
                    <div className="space-y-4">
                      <div className="h-px bg-[var(--l-border-subtle)] w-full" />
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <div className="w-16 h-5 bg-[var(--l-surface3)] rounded" />
                          <div className="w-12 h-3.5 bg-[var(--l-surface3)] rounded" />
                        </div>
                        <div className="w-24 h-9 bg-[var(--l-surface3)] rounded-xl" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : lessons.length === 0 ? (
        /* Premium Centered Empty State */
        <div 
          className="p-12 text-center rounded-2xl border flex flex-col items-center justify-center space-y-4" 
          style={{ background: "var(--l-surface)", borderColor: "var(--l-border)", minHeight: "300px" }}
        >
          <BookOpen size={48} color="var(--l-muted)" className="animate-pulse" />
          <h3 style={{ fontSize: "18px", fontWeight: 800, color: "var(--l-text)" }}>
            {t('no_lessons_title')}
          </h3>
          <p style={{ fontSize: "14px", color: "var(--l-muted)", maxWidth: "360px", lineHeight: 1.5 }}>
            {t('no_lessons_available')} {t('lang_' + targetLanguage.toLowerCase())}. {t('check_back_later')}
          </p>
        </div>
      ) : (
        SECTIONS.map((section) => {
          const levelLessons = groupedLessons[section.level];
          if (!levelLessons || levelLessons.length === 0) return null;

          const isLocked = isSectionLocked(section.level);
          const completedCount = levelLessons.filter((l) => progress.completedLessonIds.includes(l.id)).length;
          const totalCount = levelLessons.length;
          const levelCompleted = completedCount === totalCount && totalCount > 0;
          const levelAccentColor = levelCompleted ? "#22C55E" : "#6366F1";
          const levelAccentBg = levelCompleted ? "rgba(34, 197, 94, 0.12)" : "rgba(99, 102, 241, 0.12)";

          return (
            <div key={section.level} className="space-y-5">
              {/* Level Section header card */}
              <div className="flex items-start gap-4 p-5 rounded-2xl border animate-fade-in" style={{ background: "var(--l-surface)", borderColor: "var(--l-border)" }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mt-0.5 shrink-0" style={{ background: levelAccentBg }}>
                  <Star size={18} color={levelAccentColor} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h2 style={{ fontSize: "16px", fontWeight: 800, color: "var(--l-text)" }}>{t(section.level.toLowerCase().replace(' ', '_').replace('-', '_'))}</h2>
                    <span 
                      style={{ 
                        fontSize: "11px", 
                        fontWeight: 600, 
                        color: levelCompleted ? "#22C55E" : "var(--l-text2)", 
                        background: levelCompleted ? "rgba(34, 197, 94, 0.12)" : "var(--l-surface3)", 
                        padding: "2px 8px", 
                        borderRadius: "99px" 
                      }}
                    >
                      {completedCount}/{totalCount} {t('done_badge')}
                    </span>
                  </div>
                  <p style={{ fontSize: "13px", color: "var(--l-muted)", marginBottom: "12px" }}>{section.desc}</p>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--l-surface3)" }}>
                    <div className="h-full rounded-full" style={{ width: `${(completedCount / totalCount) * 100}%`, background: `linear-gradient(90deg, ${levelAccentColor}, ${levelAccentColor}88)` }} />
                  </div>
                </div>
              </div>

              {/* Redesigned clean card-based grid matching user request */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {levelLessons.map((lesson) => {
                  const isCompleted = progress.completedLessonIds.includes(lesson.id);
                  const locked = isLocked;

                  return (
                    <div
                      key={lesson.id}
                      className="premium-card p-6 flex flex-col justify-between transition-all duration-200 border"
                      style={{
                        background: locked ? "var(--l-surface2)" : "var(--l-surface)",
                        borderColor: isCompleted ? "rgba(34, 197, 94, 0.15)" : "var(--l-border)",
                        opacity: locked ? 0.75 : 1,
                      }}
                    >
                      <div>
                        {/* Header Row */}
                        <div className="flex items-center justify-between mb-4">
                          <div 
                            className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" 
                            style={{ 
                              background: locked 
                                ? "var(--l-surface3)" 
                                : isCompleted 
                                  ? "rgba(34, 197, 94, 0.12)" 
                                  : "rgba(99, 102, 241, 0.12)" 
                            }}
                          >
                            {isCompleted ? (
                              <CheckCircle2 size={20} color="#22C55E" />
                            ) : locked ? (
                              <Lock size={18} color="var(--l-subtle)" />
                            ) : (
                              <BookOpen size={18} color="#6366F1" />
                            )}
                          </div>
                          {/* Status Badge */}
                          <span 
                            style={{ 
                              fontSize: "11px", 
                              fontWeight: 700, 
                              color: locked 
                                ? "var(--l-subtle)" 
                                : isCompleted 
                                  ? "#22C55E" 
                                  : "#6366F1",
                              background: locked 
                                ? "var(--l-surface3)" 
                                : isCompleted 
                                  ? "rgba(34, 197, 94, 0.12)" 
                                  : "rgba(99, 102, 241, 0.12)",
                              padding: "4px 10px", 
                              borderRadius: "999px" 
                            }}
                          >
                            {locked ? t('locked') : isCompleted ? t('completed') : t('start')}
                          </span>
                        </div>

                        {/* Meta line */}
                        <div className="mb-2.5" style={{ fontSize: "12px" }}>
                          <span style={{ fontWeight: 700, color: "#6366F1" }}>
                            {t(lesson.category ? lesson.category.toLowerCase().replace(' ', '_') : 'general')}
                          </span>
                          <span style={{ color: "var(--l-subtle)", margin: "0 6px" }}>•</span>
                          <span style={{ color: "var(--l-muted)", fontWeight: 500 }}>
                            {t(section.level.toLowerCase().replace(' ', '_').replace('-', '_'))}
                          </span>
                        </div>

                        {/* Title */}
                        <h3 
                          className="line-clamp-1"
                          style={{ 
                            fontSize: "18px", 
                            fontWeight: 800, 
                            color: locked ? "var(--l-subtle)" : "var(--l-text)", 
                            letterSpacing: "-0.015em",
                            marginBottom: "8px" 
                          }}
                        >
                          {lesson.title}
                        </h3>

                        {/* Description */}
                        <p className="line-clamp-2" style={{ fontSize: "13px", color: "var(--l-muted)", lineHeight: 1.5, marginBottom: "16px", minHeight: "39px" }}>
                          {lesson.description}
                        </p>

                        {/* Tag Pills */}
                        <div className="flex flex-wrap gap-2 mb-5">
                          <span 
                            style={{ 
                              fontSize: "11px", 
                              fontWeight: 600, 
                              color: "var(--l-text2)", 
                              background: "var(--l-surface3)", 
                              padding: "3px 10px", 
                              borderRadius: "999px",
                              border: "1px solid var(--l-border-subtle)" 
                            }}
                          >
                            {t('difficulty_' + (lesson.difficulty || "Medium").toLowerCase())}
                          </span>
                          <span 
                            style={{ 
                              fontSize: "11px", 
                              fontWeight: 600, 
                              color: "var(--l-text2)", 
                              background: "var(--l-surface3)", 
                              padding: "3px 10px", 
                              borderRadius: "999px",
                              border: "1px solid var(--l-border-subtle)" 
                            }}
                          >
                            {lesson.duration} {t('min')}
                          </span>
                          <span 
                            style={{ 
                              fontSize: "11px", 
                              fontWeight: 600, 
                              color: "var(--l-text2)", 
                              background: "var(--l-surface3)", 
                              padding: "3px 10px", 
                              borderRadius: "999px",
                              border: "1px solid var(--l-border-subtle)" 
                            }}
                          >
                            {lesson.questions?.length || 10} {t('questions')}
                          </span>
                        </div>
                      </div>

                      {/* Separator line */}
                      <div className="h-px w-full mb-4" style={{ background: "var(--l-border-subtle)" }} />

                      {/* Footer Area */}
                      <div className="flex items-center justify-between">
                        <div>
                          <div style={{ fontSize: "16px", fontWeight: 800, color: locked ? "var(--l-subtle)" : "#F59E0B" }}>
                            {lesson.xpReward} XP
                          </div>
                          <div style={{ fontSize: "11px", color: "var(--l-muted)", fontWeight: 500 }}>
                            {t('xp_reward_label')}
                          </div>
                        </div>
                        <button
                          disabled={locked}
                          onClick={() => navigate(`/lessons/${lesson.id}`)}
                          className="btn-primary py-2 px-5 text-xs font-bold transition-all"
                          style={{
                            background: locked 
                              ? "var(--l-surface3)" 
                              : isCompleted 
                                ? "transparent" 
                                : "linear-gradient(135deg, #6366F1, #8B5CF6)",
                            border: locked
                              ? "none"
                              : isCompleted 
                                ? "1px solid rgba(99, 102, 241, 0.4)" 
                                : "none",
                            color: locked
                              ? "var(--l-subtle)"
                              : isCompleted 
                                ? "#6366F1" 
                                : "white",
                            boxShadow: locked || isCompleted ? "none" : "0 4px 14px rgba(99, 102, 241, 0.3)",
                            cursor: locked ? "not-allowed" : "pointer"
                          }}
                          onMouseEnter={(e) => {
                            const btn = e.currentTarget as HTMLButtonElement;
                            if (locked) return;
                            if (isCompleted) {
                              btn.style.background = "rgba(99, 102, 241, 0.08)";
                            } else {
                              btn.style.background = "linear-gradient(135deg, #4f46e5, #7c3aed)";
                              btn.style.boxShadow = "0 6px 20px rgba(99, 102, 241, 0.45)";
                              btn.style.transform = "translateY(-1px)";
                            }
                          }}
                          onMouseLeave={(e) => {
                            const btn = e.currentTarget as HTMLButtonElement;
                            if (locked) return;
                            if (isCompleted) {
                              btn.style.background = "transparent";
                            } else {
                              btn.style.background = "linear-gradient(135deg, #6366F1, #8B5CF6)";
                              btn.style.boxShadow = "0 4px 14px rgba(99, 102, 241, 0.3)";
                              btn.style.transform = "none";
                            }
                          }}
                        >
                          {locked ? t('locked') : isCompleted ? t('review') : t('start')}
                        </button>
                      </div>
                    </div>
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
