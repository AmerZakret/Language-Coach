import { useState, useEffect } from "react";
import { AlertCircle, CheckCircle2, Sparkles, WifiOff } from "lucide-react";
import { useLanguage } from "../context/LanguageContext";
import { useTargetLanguage } from "../context/TargetLanguageContext";
import { useProgress } from "../context/ProgressContext";
import { useNetwork } from "../context/NetworkContext";
import { checkWriting } from "../api/aiCoachApi";
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
  const { language, t } = useLanguage();
  const { targetLanguage } = useTargetLanguage();
  const { addXp } = useProgress();
  const { isOffline } = useNetwork();

  const [topic, setTopic] = useState("");
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [loading, setLoading] = useState(false);

  if (isOffline) {
    return (
      <div className="flex flex-col items-center justify-center text-center p-8 border rounded-2xl h-[450px]" style={{ background: "var(--l-surface)", borderColor: "var(--l-border)", color: "var(--l-text)" }}>
        <WifiOff size={48} className="text-amber-500 mb-4 animate-bounce" />
        <h2 style={{ fontSize: "20px", fontWeight: 800 }}>{t("offline_only_title")}</h2>
        <p style={{ fontSize: "14px", color: "var(--l-muted)", marginTop: "8px", maxWidth: "340px" }}>{t("offline_only_desc")}</p>
      </div>
    );
  }

  const LANGUAGE_CODES: Record<string, string> = {
    English: 'en',
    German: 'de',
    Spanish: 'es',
    French: 'fr',
    Arabic: 'ar',
    Turkish: 'tr',
  };

  const targetCode = LANGUAGE_CODES[targetLanguage] || 'en';
  const topicsMap = writingTopics[language] || writingTopics['en'];
  const topics = topicsMap[targetCode] || topicsMap['en'];

  useEffect(() => {
    setTopic("");
    setFeedback(null);
    setText("");
  }, [targetLanguage, topics]);

  const handleSuggestTopic = () => {
    if (topics.length === 0) return;
    const randomIndex = Math.floor(Math.random() * topics.length);
    setTopic(topics[randomIndex]);
    setFeedback(null);
  };

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const charCount = text.length;

  const handleSubmit = async () => {
    if (!topic.trim() || !text.trim() || text.length < 20 || loading) return;

    setLoading(true);
    setFeedback(null);

    try {
      const response = await checkWriting({
        topic: topic,
        text: text,
        language: language,
        targetLanguage: targetLanguage
      });

      const finalResult: Feedback = {
        score: response.overallScore,
        grammar: response.grammarScore,
        vocabulary: response.vocabularyScore,
        clarity: response.clarityScore,
        corrected: response.improvedVersion,
        mistakes: response.corrections
      };

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
        <p style={{ fontSize: "14px", color: "var(--l-muted)", marginTop: "4px" }}>{t('writing_subtitle').replace('{lang}', t('lang_' + targetLanguage.toLowerCase()))}</p>
      </div>

      {/* Topic selector */}
      <div>
        <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--l-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "8px" }}>{t('topic')}</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={t('topic_placeholder')}
              className="form-input"
            />
          </div>
          <button
            onClick={handleSuggestTopic}
            className="btn-secondary flex items-center gap-2 font-bold shrink-0"
          >
            <Sparkles size={14} color="#6366F1" />
            {t('suggest_topic')}
          </button>
        </div>
      </div>

      {/* Writing area */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--l-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{t('your_writing')}</label>
          <div className="flex items-center gap-3">
            <span style={{ fontSize: "11px", color: wordCount >= 50 ? "#10B981" : "var(--l-muted)" }}>{wordCount} {t('words')}</span>
            <span style={{ fontSize: "11px", color: "var(--l-subtle)" }}>{charCount} {t('chars')}</span>
          </div>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={topic.trim() 
            ? t('write_about_topic').replace('{topic}', topic).replace('{lang}', t('lang_' + targetLanguage.toLowerCase())) 
            : t('write_about_your_topic').replace('{lang}', t('lang_' + targetLanguage.toLowerCase()))}
          rows={8}
          className="form-textarea resize-none"
          disabled={loading}
        />
        <button
          onClick={handleSubmit}
          disabled={!topic.trim() || !text.trim() || text.length < 20 || loading}
          className="btn-primary mt-3"
        >
          {loading ? (<><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />{t('analyzing')}</>) : (<><Sparkles size={15} />{t('check_writing')}</>)}
        </button>
      </div>

      {/* Feedback */}
      {feedback && (
        <div className="space-y-4 animate-fade-in">
          <div className="p-5 rounded-2xl" style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.1), rgba(139,92,246,0.08))", border: "1px solid rgba(99,102,241,0.2)" }}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--l-text)" }}>{t('ai_feedback_label')}</div>
                <div style={{ fontSize: "12px", color: "var(--l-muted)" }}>{t('overall_assessment')}</div>
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
