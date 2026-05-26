import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, CheckCircle2, XCircle, Trophy, Zap } from "lucide-react";

import { useTargetLanguage } from "../context/TargetLanguageContext";
import { useProgress } from "../context/ProgressContext";
import { getLessonById } from "../api/lessonsApi";
import { fallbackLessons } from "../data/fallbackLessons";
import type { Lesson } from "../types/lesson";
import { soundService } from "../utils/soundService";

type AnswerState = "idle" | "correct" | "incorrect";

export function LessonQuizPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { targetLanguage } = useTargetLanguage();
  const { completeLesson } = useProgress();

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answerState, setAnswerState] = useState<AnswerState>("idle");
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadLesson = async () => {
      setLoading(true);
      try {
        if (id) {
          const found = await getLessonById(id);
          setLesson(found);
        }
      } catch (e) {
        console.error("Failed to load lesson by ID, trying fallback", e);
        const fallback = fallbackLessons.find((l) => l.id === id);
        if (fallback) setLesson(fallback);
      } finally {
        setLoading(false);
      }
    };
    loadLesson();
  }, [id, targetLanguage]);

  if (loading) return <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--l-bg)", color: "var(--l-text)" }}>Loading...</div>;
  if (!lesson || !lesson.questions || lesson.questions.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--l-bg)" }}>
        <div className="w-full max-w-sm text-center">
          <h2 style={{ fontSize: "28px", fontWeight: 800, color: "var(--l-text)", marginBottom: "8px" }}>Lesson Unavailable</h2>
          <p style={{ fontSize: "14px", color: "var(--l-muted)", marginBottom: "32px" }}>No questions found for this lesson.</p>
          <button onClick={() => navigate("/lessons")} className="w-full py-3 rounded-xl" style={{ background: "var(--l-card-hover)", color: "var(--l-text)", border: "1px solid var(--l-border)", fontSize: "14px", fontWeight: 700 }}>
            Back to Lessons
          </button>
        </div>
      </div>
    );
  }

  const q = lesson.questions[current];
  const progress = (current / lesson.questions.length) * 100;

  const handleSelect = (idx: number) => {
    if (answerState !== "idle") return;
    setSelected(idx);
    const isCorrect = q.options[idx] === q.correctAnswer;
    if (isCorrect) {
      setAnswerState("correct");
      setScore((s) => s + 1);
      soundService.playCorrect();
    } else {
      setAnswerState("incorrect");
      soundService.playWrong();
    }
  };

  const handleNext = () => {
    if (current + 1 >= (lesson.questions?.length || 0)) {
      setDone(true);
      const totalQuestions = lesson.questions?.length || 1;
      // score is current correct count; +1 if the final answer was also correct
      // but score state is already updated by handleSelect before handleNext is called
      const pct = Math.round((score / totalQuestions) * 100);
      completeLesson(lesson.id, lesson.xpReward, pct);
    } else {
      setCurrent((c) => c + 1);
      setSelected(null);
      setAnswerState("idle");
    }
  };

  if (done) {
    const pct = Math.round((score / lesson.questions.length) * 100);
    const msg = pct >= 80 ? "Excellent! 🎉" : pct >= 60 ? "Good job! 👍" : "Keep practicing! 💪";
    return (
      <div className="min-h-screen flex items-center justify-center p-6 animate-fade-in" style={{ background: "var(--l-bg)" }}>
        <div className="w-full max-w-sm text-center">
          <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6" style={{ background: "linear-gradient(135deg, #F59E0B, #EF4444)", boxShadow: "0 0 40px rgba(245,158,11,0.3)" }}>
            <Trophy size={36} color="white" />
          </div>
          <h2 style={{ fontSize: "28px", fontWeight: 800, color: "var(--l-text)", marginBottom: "8px" }}>{msg}</h2>
          <p style={{ fontSize: "14px", color: "var(--l-muted)", marginBottom: "32px" }}>{lesson.title}</p>
          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="p-4 rounded-2xl" style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.2)" }}>
              <div style={{ fontSize: "28px", fontWeight: 800, color: "#6366F1" }}>{score}/{lesson.questions.length}</div>
              <div style={{ fontSize: "12px", color: "var(--l-muted)" }}>Score</div>
            </div>
            <div className="p-4 rounded-2xl" style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.2)" }}>
              <div style={{ fontSize: "28px", fontWeight: 800, color: "#F59E0B" }}>+{lesson.xpReward}</div>
              <div style={{ fontSize: "12px", color: "var(--l-muted)" }}>XP Earned</div>
            </div>
          </div>
          <button onClick={() => navigate("/lessons")} className="w-full py-3 rounded-xl transition-transform hover:scale-105" style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)", color: "white", fontSize: "14px", fontWeight: 700, boxShadow: "0 4px 20px rgba(99,102,241,0.4)" }}>
            Continue
          </button>
        </div>
      </div>
    );
  }

  const correctOptionIndex = q.options.indexOf(q.correctAnswer);

  return (
    <div className="min-h-screen p-6 animate-fade-in" style={{ background: "var(--l-bg)" }}>
      <div className="max-w-xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => navigate("/lessons")}
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
            style={{ background: "var(--l-card-hover)", border: "1px solid var(--l-border)", color: "var(--l-muted)" }}
          >
            <ArrowLeft size={16} />
          </button>
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1.5">
              <span style={{ fontSize: "12px", color: "var(--l-muted)" }}>Question {current + 1} of {lesson.questions.length}</span>
              <div className="flex items-center gap-1"><Zap size={12} color="#F59E0B" /><span style={{ fontSize: "12px", color: "#F59E0B", fontWeight: 600 }}>XP Points</span></div>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--l-surface3)" }}>
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${progress}%`, background: "linear-gradient(90deg, #6366F1, #8B5CF6)" }} />
            </div>
          </div>
        </div>

        {/* Question card */}
        <div className="p-6 rounded-2xl mb-6" style={{ background: "var(--l-surface)", border: "1px solid var(--l-border)" }}>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full mb-4" style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.2)" }}>
            <span style={{ fontSize: "11px", fontWeight: 700, color: "#6366F1" }}>
              {q.type === 'fill_blank' ? 'Fill in the blank' : q.type === 'meaning_match' ? 'Match meaning' : 'Translate'}
            </span>
          </div>
          <p style={{ fontSize: "20px", fontWeight: 700, color: "var(--l-text)", lineHeight: 1.4 }}>{q.question}</p>
        </div>

        {/* Options */}
        <div className="space-y-3 mb-8">
          {q.options.map((opt, idx) => {
            let bg = "var(--l-card-hover)";
            let border = "var(--l-border)";
            let color = "var(--l-text2)";
            let icon = null;
            if (answerState !== "idle") {
              if (idx === correctOptionIndex) { bg = "rgba(16,185,129,0.12)"; border = "rgba(16,185,129,0.4)"; color = "#10B981"; icon = <CheckCircle2 size={18} color="#10B981" />; }
              else if (idx === selected && answerState === "incorrect") { bg = "rgba(239,68,68,0.12)"; border = "rgba(239,68,68,0.4)"; color = "#F87171"; icon = <XCircle size={18} color="#F87171" />; }
              else { color = "var(--l-subtle)"; }
            }
            return (
              <button
                key={idx}
                onClick={() => handleSelect(idx)}
                className="w-full text-left px-5 py-4 rounded-xl flex items-center justify-between transition-all duration-200"
                style={{ background: bg, border: `1px solid ${border}`, color }}
                onMouseEnter={(e) => { if (answerState === "idle") { (e.currentTarget as HTMLButtonElement).style.background = "rgba(99,102,241,0.08)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(99,102,241,0.25)"; } }}
                onMouseLeave={(e) => { if (answerState === "idle") { (e.currentTarget as HTMLButtonElement).style.background = "var(--l-card-hover)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--l-border)"; } }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--l-input-bg)", fontSize: "12px", fontWeight: 700 }}>
                    {String.fromCharCode(65 + idx)}
                  </div>
                  <span style={{ fontSize: "14px", fontWeight: 500 }}>{opt}</span>
                </div>
                {icon}
              </button>
            );
          })}
        </div>

        {/* Feedback */}
        {answerState !== "idle" && (
          <div
            className="p-4 rounded-2xl flex items-center justify-between animate-fade-in"
            style={{ background: answerState === "correct" ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)", border: `1px solid ${answerState === "correct" ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}` }}
          >
            <div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: answerState === "correct" ? "#10B981" : "#F87171" }}>
                {answerState === "correct" ? "Correct!" : "Incorrect!"}
              </div>
              {answerState === "incorrect" && <div style={{ fontSize: "12px", color: "var(--l-muted)", marginTop: "2px" }}>Correct: {q.correctAnswer}</div>}
            </div>
            <button
              onClick={handleNext}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl transition-all duration-200 hover:scale-105"
              style={{ background: answerState === "correct" ? "rgba(16,185,129,0.2)" : "rgba(99,102,241,0.2)", color: answerState === "correct" ? "#10B981" : "#6366F1", fontSize: "13px", fontWeight: 700, border: `1px solid ${answerState === "correct" ? "rgba(16,185,129,0.3)" : "rgba(99,102,241,0.3)"}` }}
            >
              {current + 1 >= lesson.questions.length ? "See Results" : "Next"} <ArrowRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
