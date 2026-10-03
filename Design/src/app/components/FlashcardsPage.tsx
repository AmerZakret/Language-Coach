import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, ArrowRight, RotateCcw, Sparkles } from "lucide-react";

const CARDS = [
  { id: 1, front: "Hund", back: "Dog", example: "Der Hund ist groß.", mnemonic: "Sounds like 'hound' — an old English word for dog." },
  { id: 2, front: "Haus", back: "House", example: "Das Haus ist schön.", mnemonic: "Think of 'house' — very similar!" },
  { id: 3, front: "Buch", back: "Book", example: "Ich lese ein Buch.", mnemonic: "Think of 'beech' trees — old books were written on beechwood." },
  { id: 4, front: "Wasser", back: "Water", example: "Ich trinke Wasser.", mnemonic: "Similar to the English word 'water'." },
  { id: 5, front: "Schule", back: "School", example: "Die Schule ist groß.", mnemonic: "Sounds like 'school' — same Latin root!" },
];

const SCORE_LABELS = ["Forgot", "Hard", "Okay", "Easy", "Very Easy", "Perfect"];

export function FlashcardsPage() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(false);
  const [results, setResults] = useState<number[]>([]);

  const card = CARDS[current];

  const handleScore = (score: number) => {
    setResults((prev) => [...prev, score]);
    if (current + 1 >= CARDS.length) { setDone(true); }
    else { setCurrent((c) => c + 1); setFlipped(false); }
  };

  if (done) {
    const avg = results.reduce((a, b) => a + b, 0) / results.length;
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6" style={{ background: "var(--l-bg)" }}>
        <div className="w-16 h-16 rounded-full flex items-center justify-center mb-6" style={{ background: "linear-gradient(135deg, #10B981, #06B6D4)", boxShadow: "0 0 40px rgba(16,185,129,0.3)" }}>
          <Sparkles size={28} color="white" />
        </div>
        <h2 style={{ fontSize: "26px", fontWeight: 800, color: "var(--l-text)", marginBottom: "8px" }}>All Caught Up!</h2>
        <p style={{ fontSize: "14px", color: "var(--l-muted)", marginBottom: "32px" }}>You've reviewed all {CARDS.length} cards for today.</p>
        <div className="px-6 py-4 rounded-2xl mb-8" style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)" }}>
          <div style={{ fontSize: "30px", fontWeight: 800, color: "#10B981", textAlign: "center" }}>{avg.toFixed(1)}/5</div>
          <div style={{ fontSize: "12px", color: "var(--l-muted)", textAlign: "center" }}>Average Score</div>
        </div>
        <button onClick={() => navigate("/dashboard")} className="px-8 py-3 rounded-xl" style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)", color: "white", fontSize: "14px", fontWeight: 700 }}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-lg mx-auto min-h-screen" style={{ background: "var(--l-bg)" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 style={{ fontSize: "20px", fontWeight: 800, color: "var(--l-text)" }}>Daily Review</h2>
          <p style={{ fontSize: "13px", color: "var(--l-muted)" }}>{CARDS.length} cards due today</p>
        </div>
        <div className="px-3 py-1.5 rounded-xl" style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.2)" }}>
          <span style={{ fontSize: "12px", fontWeight: 700, color: "#6366F1" }}>{current + 1} / {CARDS.length}</span>
        </div>
      </div>

      {/* Progress dots */}
      <div className="flex gap-2 mb-8">
        {CARDS.map((_, i) => (
          <div key={i} className="flex-1 h-1.5 rounded-full" style={{ background: i < current ? "#6366F1" : i === current ? "rgba(99,102,241,0.5)" : "var(--l-surface3)" }} />
        ))}
      </div>

      {/* Flashcard */}
      <div className="relative mb-8 cursor-pointer select-none" style={{ perspective: "1200px", height: "320px" }} onClick={() => setFlipped((f) => !f)}>
        <div style={{ position: "absolute", inset: 0, transformStyle: "preserve-3d", transition: "transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)", transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}>
          {/* Front */}
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-3xl" style={{ backfaceVisibility: "hidden", background: "linear-gradient(135deg, rgba(99,102,241,0.15) 0%, rgba(139,92,246,0.1) 100%)", border: "1px solid rgba(99,102,241,0.25)", boxShadow: "0 24px 48px rgba(0,0,0,0.15)" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#6366F1", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "16px" }}>German</div>
            <div style={{ fontSize: "52px", fontWeight: 800, color: "var(--l-text)", letterSpacing: "-0.02em" }}>{card.front}</div>
            <div style={{ fontSize: "12px", color: "var(--l-muted)", marginTop: "24px" }}>Tap to reveal translation</div>
          </div>

          {/* Back */}
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-3xl p-6" style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)", background: "linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(6,182,212,0.08) 100%)", border: "1px solid rgba(16,185,129,0.25)", boxShadow: "0 24px 48px rgba(0,0,0,0.15)" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#10B981", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "12px" }}>Translation</div>
            <div style={{ fontSize: "42px", fontWeight: 800, color: "var(--l-text)", marginBottom: "16px" }}>{card.back}</div>
            <div className="w-full p-3 rounded-xl mb-3" style={{ background: "var(--l-card-hover)" }}>
              <div style={{ fontSize: "11px", color: "var(--l-muted)", marginBottom: "4px" }}>Example</div>
              <div style={{ fontSize: "13px", color: "var(--l-text2)", fontStyle: "italic" }}>"{card.example}"</div>
            </div>
            <div className="w-full p-3 rounded-xl" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.1)" }}>
              <div style={{ fontSize: "11px", color: "#F59E0B", marginBottom: "4px" }}>💡 Mnemonic</div>
              <div style={{ fontSize: "12px", color: "var(--l-text2)" }}>{card.mnemonic}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Buttons */}
      {!flipped ? (
        <div className="flex items-center justify-center gap-6">
          <button onClick={() => handleScore(1)} className="flex flex-col items-center gap-2 w-24 py-4 rounded-2xl transition-all duration-200" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#F87171" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.2)"; (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-2px)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.1)"; (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)"; }}
          >
            <ArrowLeft size={20} /><span style={{ fontSize: "11px", fontWeight: 700 }}>Forgot</span>
          </button>
          <button onClick={() => setFlipped(true)} className="flex flex-col items-center gap-2 px-8 py-4 rounded-2xl" style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)", color: "#6366F1" }}>
            <RotateCcw size={20} /><span style={{ fontSize: "11px", fontWeight: 700 }}>Show Answer</span>
          </button>
          <button onClick={() => handleScore(4)} className="flex flex-col items-center gap-2 w-24 py-4 rounded-2xl transition-all duration-200" style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)", color: "#10B981" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(16,185,129,0.2)"; (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-2px)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(16,185,129,0.1)"; (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)"; }}
          >
            <ArrowRight size={20} /><span style={{ fontSize: "11px", fontWeight: 700 }}>Got It</span>
          </button>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: "12px", color: "var(--l-muted)", textAlign: "center", marginBottom: "12px" }}>How well did you know this?</div>
          <div className="grid grid-cols-6 gap-2">
            {SCORE_LABELS.map((label, i) => {
              const colors = [
                { bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.25)", text: "#F87171" },
                { bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.25)", text: "#F59E0B" },
                { bg: "rgba(234,179,8,0.12)", border: "rgba(234,179,8,0.25)", text: "#EAB308" },
                { bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.25)", text: "#10B981" },
                { bg: "rgba(6,182,212,0.12)", border: "rgba(6,182,212,0.25)", text: "#06B6D4" },
                { bg: "rgba(99,102,241,0.12)", border: "rgba(99,102,241,0.25)", text: "#6366F1" },
              ];
              const c = colors[i];
              return (
                <button key={i} onClick={() => handleScore(i)} className="flex flex-col items-center py-3 rounded-xl transition-all duration-200" style={{ background: c.bg, border: `1px solid ${c.border}` }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-2px)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)"; }}
                >
                  <span style={{ fontSize: "16px", fontWeight: 800, color: c.text }}>{i}</span>
                  <span style={{ fontSize: "9px", color: c.text, textAlign: "center", lineHeight: 1.2, marginTop: "4px" }}>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
