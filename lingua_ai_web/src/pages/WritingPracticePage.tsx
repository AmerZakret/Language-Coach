import { useState, useEffect } from "react";
import { PenLine, ChevronDown, AlertCircle, CheckCircle2, Sparkles } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { useTargetLanguage } from "../context/TargetLanguageContext";
import { useProgress } from "../context/ProgressContext";
import { sendMessage } from "../api/aiCoachApi";
import { writingTopics } from "../data/writingTopics";

interface Feedback {
  score: number;
  grammar: number;
  vocabulary: number;
  clarity: number;
  corrected: string;
  mistakes: { original: string; correction: string; explanation: string }[];
}

function ScoreRing({ value, color, label }: { value: number; color: string; label: string }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-16 h-16">
        <svg width="64" height="64" className="-rotate-90">
          <circle cx="32" cy="32" r={r} fill="none" stroke="var(--l-surface3)" strokeWidth="6" />
          <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="6" strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" style={{ transition: "stroke-dashoffset 1s ease" }} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span style={{ fontSize: "13px", fontWeight: 800, color }}>{value}</span>
        </div>
      </div>
      <span style={{ fontSize: "11px", color: "var(--l-muted)" }}>{label}</span>
    </div>
  );
}

export function WritingPracticePage() {
  const { user, isGuest } = useAuth();
  const { language, t } = useLanguage();
  const { targetLanguage } = useTargetLanguage();
  const { addXp } = useProgress();

  const [topic, setTopic] = useState("");
  const [topicOpen, setTopicOpen] = useState(false);
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [loading, setLoading] = useState(false);

  const topics = writingTopics[targetLanguage] || writingTopics["English"];

  useEffect(() => {
    setTopic(topics[0]);
    setFeedback(null);
    setText("");
  }, [targetLanguage, topics]);

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const charCount = text.length;

  const handleSubmit = async () => {
    if (!text.trim() || text.length < 20 || loading) return;

    setLoading(true);
    setFeedback(null);

    try {
      const prompt = `Writing correction request. 
      Topic: ${topic}
      Target Language: ${targetLanguage}
      User Text: ${text}
      
      Please return a JSON-style response with EXACTLY this structure:
      {
        "score": 85,
        "grammar": 80,
        "vocabulary": 90,
        "clarity": 85,
        "corrected": "The fully corrected text goes here.",
        "mistakes": [
          {
            "original": "mistaken word/phrase",
            "correction": "corrected word/phrase",
            "explanation": "Brief explanation of the mistake"
          }
        ]
      }
      All scores should be out of 100. Provide the JSON only, no markdown formatting if possible.`;

      const response = await sendMessage({
        userId: user?.id || (isGuest ? 'guest' : 'unknown'),
        message: prompt,
        language: language,
        targetLanguage: targetLanguage
      });

      let finalResult: Feedback;
      try {
        const jsonMatch = response.reply.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          finalResult = JSON.parse(jsonMatch[0]);
        } else {
          finalResult = {
            score: 0, grammar: 0, vocabulary: 0, clarity: 0,
            corrected: response.reply,
            mistakes: []
          };
        }
      } catch (e) {
        console.warn('Failed to parse AI response as JSON', e);
        finalResult = {
          score: 0, grammar: 0, vocabulary: 0, clarity: 0,
          corrected: response.correction || response.reply,
          mistakes: []
        };
      }

      setFeedback(finalResult);
      addXp(10);
    } catch (e) {
      console.error('Writing check failed', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6 animate-fade-in" style={{ background: "var(--l-bg)", minHeight: "100vh" }}>
      <div>
        <h1 style={{ color: "var(--l-text)", fontWeight: 800, fontSize: "26px", letterSpacing: "-0.02em" }}>{t('writing_practice')}</h1>
        <p style={{ fontSize: "14px", color: "var(--l-muted)", marginTop: "4px" }}>Write in {targetLanguage} and get instant AI feedback</p>
      </div>

      {/* Topic selector */}
      <div className="relative">
        <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--l-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "8px" }}>{t('topic')}</label>
        <button
          onClick={() => setTopicOpen(!topicOpen)}
          className="w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all"
          style={{ background: "var(--l-input-bg)", border: topicOpen ? "1px solid rgba(99,102,241,0.4)" : "1px solid var(--l-border)", color: "var(--l-text)", fontSize: "14px" }}
        >
          <div className="flex items-center gap-2"><PenLine size={15} color="#6366F1" />{topic}</div>
          <ChevronDown size={15} color="var(--l-muted)" style={{ transform: topicOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }} />
        </button>
        {topicOpen && (
          <div className="absolute top-full left-0 right-0 mt-2 rounded-xl overflow-hidden z-10 animate-fade-in" style={{ background: "var(--l-surface)", border: "1px solid var(--l-border)", boxShadow: "0 16px 40px rgba(0,0,0,0.2)" }}>
            {topics.map((tItem) => (
              <button key={tItem} onClick={() => { setTopic(tItem); setTopicOpen(false); setText(""); setFeedback(null); }} className="w-full text-left px-4 py-3 transition-colors flex items-center gap-2" style={{ color: tItem === topic ? "#6366F1" : "var(--l-text2)", fontSize: "13px", background: tItem === topic ? "rgba(99,102,241,0.08)" : "transparent" }}
                onMouseEnter={(e) => { if (tItem !== topic) (e.currentTarget as HTMLButtonElement).style.background = "var(--l-card-hover)"; }}
                onMouseLeave={(e) => { if (tItem !== topic) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
              >
                {tItem === topic && <CheckCircle2 size={13} color="#6366F1" />}{tItem}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Writing area */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--l-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Your Writing</label>
          <div className="flex items-center gap-3">
            <span style={{ fontSize: "11px", color: wordCount >= 50 ? "#10B981" : "var(--l-muted)" }}>{wordCount} words</span>
            <span style={{ fontSize: "11px", color: "var(--l-subtle)" }}>{charCount} chars</span>
          </div>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Write about "${topic}" in ${targetLanguage}... (aim for 50+ words)`}
          rows={8}
          className="w-full px-4 py-3 rounded-xl outline-none transition-all resize-none"
          style={{ background: "var(--l-input-bg)", border: "1px solid var(--l-border)", color: "var(--l-text)", fontSize: "14px", lineHeight: 1.8 }}
          onFocus={(e) => { e.target.style.borderColor = "rgba(99,102,241,0.4)"; }}
          onBlur={(e) => { e.target.style.borderColor = "var(--l-border)"; }}
          disabled={loading}
        />
        <button
          onClick={handleSubmit}
          disabled={!text.trim() || text.length < 20 || loading}
          className="mt-3 flex items-center gap-2 px-6 py-3 rounded-xl transition-all duration-200"
          style={{ background: text.trim() && text.length >= 20 && !loading ? "linear-gradient(135deg, #6366F1, #8B5CF6)" : "var(--l-card-hover)", color: text.trim() && text.length >= 20 && !loading ? "white" : "var(--l-subtle)", fontSize: "14px", fontWeight: 700, boxShadow: text.trim() && text.length >= 20 && !loading ? "0 4px 20px rgba(99,102,241,0.4)" : "none", border: text.trim() && text.length >= 20 && !loading ? "none" : "1px solid var(--l-border)" }}
          onMouseEnter={(e) => { if (text.trim() && text.length >= 20 && !loading) (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)"; }}
        >
          {loading ? (<><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />Analyzing...</>) : (<><Sparkles size={15} />{t('check_writing')}</>)}
        </button>
      </div>

      {/* Feedback */}
      {feedback && (
        <div className="space-y-4 animate-fade-in">
          <div className="p-5 rounded-2xl" style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.1), rgba(139,92,246,0.08))", border: "1px solid rgba(99,102,241,0.2)" }}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--l-text)" }}>AI Feedback</div>
                <div style={{ fontSize: "12px", color: "var(--l-muted)" }}>Overall Assessment</div>
              </div>
              <div className="text-right">
                <div style={{ fontSize: "38px", fontWeight: 900, color: "#6366F1", lineHeight: 1 }}>{feedback.score || Math.round((feedback.grammar + feedback.vocabulary + feedback.clarity)/3) || 0}</div>
                <div style={{ fontSize: "11px", color: "var(--l-muted)" }}>/ 100</div>
              </div>
            </div>
            <div className="flex items-center justify-center gap-8">
              <ScoreRing value={feedback.grammar} color="#6366F1" label={t('grammar')} />
              <ScoreRing value={feedback.vocabulary} color="#10B981" label={t('vocabulary')} />
              <ScoreRing value={feedback.clarity} color="#F59E0B" label={t('clarity')} />
            </div>
          </div>

          <div className="p-5 rounded-2xl" style={{ background: "var(--l-surface)", border: "1px solid rgba(16,185,129,0.2)" }}>
            <div className="flex items-center gap-2 mb-3"><CheckCircle2 size={15} color="#10B981" /><span style={{ fontSize: "13px", fontWeight: 700, color: "#10B981" }}>{t('corrected_version')}</span></div>
            <p style={{ fontSize: "14px", color: "var(--l-text2)", lineHeight: 1.8, fontStyle: "italic" }}>"{feedback.corrected}"</p>
          </div>

          {feedback.mistakes && feedback.mistakes.length > 0 && (
            <div className="p-5 rounded-2xl" style={{ background: "var(--l-surface)", border: "1px solid var(--l-border)" }}>
              <div className="flex items-center gap-2 mb-4"><AlertCircle size={15} color="#F59E0B" /><span style={{ fontSize: "13px", fontWeight: 700, color: "var(--l-text)" }}>{t('mistakes')}</span></div>
              <div className="space-y-3">
                {feedback.mistakes.map((m, i) => (
                  <div key={i} className="p-4 rounded-xl" style={{ background: "var(--l-card-hover)", border: "1px solid var(--l-border-subtle)" }}>
                    <div className="flex items-start gap-2 mb-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded-md" style={{ background: "rgba(239,68,68,0.12)", fontSize: "11px", color: "#F87171", fontWeight: 600, textDecoration: "line-through" }}>{m.original}</span>
                      <span style={{ color: "var(--l-subtle)", fontSize: "12px" }}>→</span>
                      <span className="px-2 py-0.5 rounded-md" style={{ background: "rgba(16,185,129,0.12)", fontSize: "11px", color: "#10B981", fontWeight: 600 }}>{m.correction}</span>
                    </div>
                    <p style={{ fontSize: "12px", color: "var(--l-muted)" }}>{m.explanation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
