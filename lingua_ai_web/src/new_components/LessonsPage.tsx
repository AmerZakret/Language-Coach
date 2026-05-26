import { useNavigate } from "react-router";
import { BookOpen, CheckCircle2, Lock, Clock, Zap, ChevronRight, Star } from "lucide-react";

const CURRICULUM = [
  {
    level: "Beginner", desc: "Build your foundation — greetings, basics, and core vocabulary", color: "#10B981", completed: 2, total: 5,
    lessons: [
      { id: 1, title: "Greetings & Introductions", desc: "Learn how to say hello, goodbye, and introduce yourself.", xp: 30, duration: "10 min", questions: 8, difficulty: "Easy", category: "Speaking", completed: true, locked: false },
      { id: 2, title: "Numbers & Colors", desc: "Master counting from 1-100 and all basic colors.", xp: 25, duration: "8 min", questions: 10, difficulty: "Easy", category: "Vocabulary", completed: true, locked: false },
      { id: 3, title: "Basic Phrases", desc: "Essential phrases for everyday conversations.", xp: 35, duration: "12 min", questions: 12, difficulty: "Easy", category: "Phrases", completed: false, locked: false },
      { id: 4, title: "Food & Drinks", desc: "Vocabulary for restaurants, cafes, and grocery shopping.", xp: 30, duration: "10 min", questions: 10, difficulty: "Easy", category: "Vocabulary", completed: false, locked: true },
      { id: 5, title: "Days & Time", desc: "Days of the week, months, and telling the time.", xp: 30, duration: "10 min", questions: 10, difficulty: "Easy", category: "Vocabulary", completed: false, locked: true },
    ],
  },
  {
    level: "Elementary", desc: "Build core grammar and expand vocabulary", color: "#6366F1", completed: 0, total: 4,
    lessons: [
      { id: 6, title: "Present Tense Verbs", desc: "Conjugate the most common verbs in present tense.", xp: 40, duration: "15 min", questions: 15, difficulty: "Medium", category: "Grammar", completed: false, locked: true },
      { id: 7, title: "Family Members", desc: "Vocabulary for family relationships and descriptions.", xp: 30, duration: "10 min", questions: 10, difficulty: "Medium", category: "Vocabulary", completed: false, locked: true },
      { id: 8, title: "Articles & Gender", desc: "Der, Die, Das — master German grammatical gender.", xp: 50, duration: "18 min", questions: 18, difficulty: "Medium", category: "Grammar", completed: false, locked: true },
      { id: 9, title: "Adjectives", desc: "Describing people, places, and things accurately.", xp: 40, duration: "14 min", questions: 12, difficulty: "Medium", category: "Grammar", completed: false, locked: true },
    ],
  },
  {
    level: "Pre-Intermediate", desc: "Tackle complex structures and real-world scenarios", color: "#F59E0B", completed: 0, total: 3,
    lessons: [
      { id: 10, title: "Past Tense (Perfekt)", desc: "Talk about completed actions using the Perfekt tense.", xp: 60, duration: "20 min", questions: 20, difficulty: "Hard", category: "Grammar", completed: false, locked: true },
      { id: 11, title: "Modal Verbs", desc: "Express possibility, necessity and ability.", xp: 55, duration: "18 min", questions: 16, difficulty: "Hard", category: "Grammar", completed: false, locked: true },
      { id: 12, title: "Subordinate Clauses", desc: "Connect ideas using weil, dass, and ob.", xp: 65, duration: "22 min", questions: 20, difficulty: "Hard", category: "Grammar", completed: false, locked: true },
    ],
  },
];

const DIFF_COLORS: Record<string, { bg: string; text: string }> = {
  Easy: { bg: "rgba(16,185,129,0.12)", text: "#10B981" },
  Medium: { bg: "rgba(99,102,241,0.12)", text: "#6366F1" },
  Hard: { bg: "rgba(245,158,11,0.12)", text: "#F59E0B" },
};

export function LessonsPage() {
  const navigate = useNavigate();
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 style={{ color: "var(--l-text)", fontWeight: 800, fontSize: "26px", letterSpacing: "-0.02em" }}>Curriculum</h1>
        <p style={{ fontSize: "14px", color: "var(--l-muted)", marginTop: "4px" }}>
          Your German learning path — <span style={{ color: "#6366F1" }}>2 of 12</span> lessons completed
        </p>
      </div>

      {CURRICULUM.map((section) => (
        <div key={section.level}>
          <div className="flex items-start gap-4 mb-5 p-4 rounded-2xl" style={{ background: `${section.color}08`, border: `1px solid ${section.color}18` }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mt-0.5" style={{ background: `${section.color}15` }}>
              <Star size={18} color={section.color} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1">
                <h2 style={{ fontSize: "17px", fontWeight: 800, color: "var(--l-text)" }}>{section.level}</h2>
                <span style={{ fontSize: "11px", fontWeight: 600, color: section.color, background: `${section.color}15`, padding: "2px 8px", borderRadius: "999px" }}>
                  {section.completed}/{section.total} done
                </span>
              </div>
              <p style={{ fontSize: "13px", color: "var(--l-muted)", marginBottom: "10px" }}>{section.desc}</p>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--l-surface3)" }}>
                <div className="h-full rounded-full" style={{ width: `${(section.completed / section.total) * 100}%`, background: `linear-gradient(90deg, ${section.color}, ${section.color}88)` }} />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {section.lessons.map((lesson) => {
              const diffStyle = DIFF_COLORS[lesson.difficulty];
              return (
                <button
                  key={lesson.id}
                  disabled={lesson.locked}
                  onClick={() => navigate(`/lessons/quiz/${lesson.id}`)}
                  className="w-full text-left p-4 rounded-2xl transition-all duration-200 flex items-start gap-4"
                  style={{
                    background: lesson.locked ? "var(--l-card-hover)" : "var(--l-surface)",
                    border: lesson.completed ? `1px solid ${section.color}30` : lesson.locked ? "1px solid var(--l-border-subtle)" : "1px solid var(--l-border)",
                    opacity: lesson.locked ? 0.55 : 1,
                    cursor: lesson.locked ? "not-allowed" : "pointer",
                  }}
                  onMouseEnter={(e) => { if (!lesson.locked) { (e.currentTarget as HTMLButtonElement).style.borderColor = `${section.color}40`; (e.currentTarget as HTMLButtonElement).style.transform = "translateX(2px)"; } }}
                  onMouseLeave={(e) => { if (!lesson.locked) { (e.currentTarget as HTMLButtonElement).style.borderColor = lesson.completed ? `${section.color}30` : "var(--l-border)"; (e.currentTarget as HTMLButtonElement).style.transform = "translateX(0)"; } }}
                >
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: lesson.completed ? `${section.color}20` : "var(--l-card-hover)" }}>
                    {lesson.completed ? <CheckCircle2 size={18} color={section.color} /> : lesson.locked ? <Lock size={16} color="var(--l-subtle)" /> : <BookOpen size={16} color="var(--l-muted)" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span style={{ fontSize: "14px", fontWeight: 700, color: lesson.locked ? "var(--l-subtle)" : "var(--l-text)" }}>{lesson.title}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span style={{ fontSize: "10px", fontWeight: 700, color: diffStyle.text, background: diffStyle.bg, padding: "2px 8px", borderRadius: "999px" }}>{lesson.difficulty}</span>
                        <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--l-muted)", background: "var(--l-card-hover)", padding: "2px 8px", borderRadius: "999px" }}>{lesson.category}</span>
                      </div>
                    </div>
                    <p style={{ fontSize: "12px", color: "var(--l-subtle)", marginBottom: "10px" }}>{lesson.desc}</p>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1"><Clock size={12} color="var(--l-subtle)" /><span style={{ fontSize: "11px", color: "var(--l-subtle)" }}>{lesson.duration}</span></div>
                      <div className="flex items-center gap-1"><Zap size={12} color="#F59E0B" /><span style={{ fontSize: "11px", color: "#F59E0B", fontWeight: 600 }}>{lesson.xp} XP</span></div>
                      <span style={{ fontSize: "11px", color: "var(--l-subtle)" }}>{lesson.questions} questions</span>
                    </div>
                  </div>
                  {!lesson.locked && <ChevronRight size={16} color="var(--l-subtle)" className="shrink-0 mt-1" />}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
