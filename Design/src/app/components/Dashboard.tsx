import { useState } from "react";
import { useNavigate } from "react-router";
import { Zap, Flame, Trophy, BookOpen, Plus, ArrowRight, CheckCircle2, Star } from "lucide-react";

interface DashboardProps {
  userName: string;
}

const STATS = [
  { label: "XP Earned", value: "450", icon: Zap, color: "#F59E0B", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.2)" },
  { label: "Current Level", value: "5", icon: Star, color: "#8B5CF6", bg: "rgba(139,92,246,0.12)", border: "rgba(139,92,246,0.2)" },
  { label: "Day Streak", value: "7", icon: Flame, color: "#F87171", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.2)" },
  { label: "Lessons Done", value: "12", icon: Trophy, color: "#10B981", bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.2)" },
];

const LESSON_CATEGORIES = [
  {
    level: "Beginner", color: "#10B981",
    lessons: [
      { id: 1, title: "Greetings & Introductions", xp: 30, duration: "10 min", completed: true },
      { id: 2, title: "Numbers & Colors", xp: 25, duration: "8 min", completed: true },
      { id: 3, title: "Basic Phrases", xp: 35, duration: "12 min", completed: false },
    ],
  },
  {
    level: "Elementary", color: "#6366F1",
    lessons: [
      { id: 4, title: "Present Tense Verbs", xp: 40, duration: "15 min", completed: false },
      { id: 5, title: "Family Members", xp: 30, duration: "10 min", completed: false },
    ],
  },
];

export function Dashboard({ userName }: DashboardProps) {
  const navigate = useNavigate();
  const [quickWord, setQuickWord] = useState("");
  const [quickTranslation, setQuickTranslation] = useState("");

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Welcome header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 style={{ color: "var(--l-text)", fontWeight: 800, fontSize: "26px", letterSpacing: "-0.02em" }}>
            Welcome back, {userName} 👋
          </h1>
          <p style={{ fontSize: "14px", color: "var(--l-muted)" }}>
            Keep learning <span style={{ color: "#6366F1", fontWeight: 600 }}>German</span> today. You're on a roll!
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-2xl" style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}>
          <span style={{ fontSize: "24px" }}>🇩🇪</span>
          <div>
            <div style={{ fontSize: "11px", color: "var(--l-muted)" }}>Target Language</div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--l-text)" }}>German</div>
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
            <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--l-text)" }}>Level 5 Progress</div>
            <div style={{ fontSize: "12px", color: "var(--l-muted)", marginTop: "2px" }}>450 / 500 XP to Level 6</div>
          </div>
          <div className="px-3 py-1 rounded-full" style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.25)" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "#6366F1" }}>90%</span>
          </div>
        </div>
        <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "var(--l-surface3)" }}>
          <div className="h-full rounded-full" style={{ width: "90%", background: "linear-gradient(90deg, #6366F1, #8B5CF6)" }} />
        </div>
        <div className="flex justify-between mt-2">
          <span style={{ fontSize: "11px", color: "var(--l-subtle)" }}>0 XP</span>
          <span style={{ fontSize: "11px", color: "#6366F1", fontWeight: 600 }}>50 XP away from Level 6!</span>
        </div>
      </div>

      {/* Two-column: Quick Add + Continue Learning */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Quick Add Flashcard */}
        <div className="p-5 rounded-2xl" style={{ background: "var(--l-surface)", border: "1px solid var(--l-border)" }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(16,185,129,0.15)" }}>
              <Plus size={14} color="#10B981" />
            </div>
            <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--l-text)" }}>Quick Add Flashcard</span>
          </div>
          <div className="space-y-3">
            <input
              placeholder="Word (e.g. Hund)"
              value={quickWord}
              onChange={(e) => setQuickWord(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl outline-none transition-all"
              style={{ background: "var(--l-input-bg)", border: "1px solid var(--l-border)", color: "var(--l-text)", fontSize: "13px" }}
              onFocus={(e) => { e.target.style.borderColor = "rgba(16,185,129,0.4)"; }}
              onBlur={(e) => { e.target.style.borderColor = "var(--l-border)"; }}
            />
            <input
              placeholder="Translation (e.g. Dog)"
              value={quickTranslation}
              onChange={(e) => setQuickTranslation(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl outline-none transition-all"
              style={{ background: "var(--l-input-bg)", border: "1px solid var(--l-border)", color: "var(--l-text)", fontSize: "13px" }}
              onFocus={(e) => { e.target.style.borderColor = "rgba(16,185,129,0.4)"; }}
              onBlur={(e) => { e.target.style.borderColor = "var(--l-border)"; }}
            />
            <button
              className="w-full py-2.5 rounded-xl transition-all duration-200"
              style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.25)", color: "#10B981", fontSize: "13px", fontWeight: 700 }}
              onClick={() => { setQuickWord(""); setQuickTranslation(""); }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(16,185,129,0.25)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(16,185,129,0.15)"; }}
            >
              Add to Deck
            </button>
          </div>
        </div>

        {/* Continue Learning */}
        <div className="p-5 rounded-2xl relative overflow-hidden" style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.15) 0%, rgba(139,92,246,0.1) 100%)", border: "1px solid rgba(99,102,241,0.2)" }}>
          <div className="absolute top-0 right-0 w-32 h-32 opacity-10" style={{ background: "radial-gradient(circle, #8B5CF6, transparent)" }} />
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#6366F1", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>NEXT UP</div>
          <h3 style={{ fontSize: "17px", fontWeight: 700, color: "var(--l-text)", marginBottom: "6px" }}>Basic Phrases</h3>
          <p style={{ fontSize: "13px", color: "var(--l-muted)", marginBottom: "16px" }}>Continue from where you left off. 12 min · 35 XP</p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/lessons/quiz/3")}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl transition-all duration-200"
              style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)", color: "white", fontSize: "13px", fontWeight: 700, boxShadow: "0 4px 16px rgba(99,102,241,0.4)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)"; }}
            >
              Continue Learning <ArrowRight size={14} />
            </button>
            <div className="flex items-center gap-1.5">
              <BookOpen size={13} color="var(--l-muted)" />
              <span style={{ fontSize: "12px", color: "var(--l-muted)" }}>Beginner</span>
            </div>
          </div>
        </div>
      </div>

      {/* Lesson categories */}
      {LESSON_CATEGORIES.map((cat) => (
        <div key={cat.level}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-2 h-2 rounded-full" style={{ background: cat.color }} />
            <span style={{ fontSize: "15px", fontWeight: 700, color: "var(--l-text)" }}>{cat.level}</span>
            <div className="flex-1 h-px" style={{ background: "var(--l-border-subtle)" }} />
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {cat.lessons.map((lesson) => (
              <button
                key={lesson.id}
                onClick={() => navigate(`/lessons/quiz/${lesson.id}`)}
                className="text-left p-4 rounded-2xl transition-all duration-200"
                style={{ background: "var(--l-surface)", border: lesson.completed ? `1px solid ${cat.color}30` : "1px solid var(--l-border)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = `${cat.color}40`; (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-2px)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = lesson.completed ? `${cat.color}30` : "var(--l-border)"; (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)"; }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: lesson.completed ? `${cat.color}20` : "var(--l-card-hover)" }}>
                    {lesson.completed ? <CheckCircle2 size={16} color={cat.color} /> : <BookOpen size={16} color="var(--l-muted)" />}
                  </div>
                  <div className="px-2 py-0.5 rounded-md" style={{ background: `${cat.color}15`, border: `1px solid ${cat.color}25` }}>
                    <span style={{ fontSize: "10px", fontWeight: 700, color: cat.color }}>{lesson.xp} XP</span>
                  </div>
                </div>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--l-text)", marginBottom: "4px" }}>{lesson.title}</div>
                <div style={{ fontSize: "11px", color: "var(--l-subtle)" }}>{lesson.duration}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
