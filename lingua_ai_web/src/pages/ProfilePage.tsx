import { useState } from "react";
import { Globe, Volume2, AlertTriangle, LogOut, Check, ChevronDown, User as UserIcon } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { useTargetLanguage } from "../context/TargetLanguageContext";
import { useProgress } from "../context/ProgressContext";
import { useSound } from "../context/SoundContext";
import { getLevelFromXp } from "../utils/levelUtils";
import type { TargetLanguage } from "../types/language";

const INTERFACE_LANGS = [
  { value: "en", label: "English" },
  { value: "tr", label: "Türkçe" }
];

const TARGET_LANGS = ["English", "German", "Spanish", "French", "Arabic"];

export function ProfilePage() {
  const { user, isGuest, logout } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const { targetLanguage, setTargetLanguage } = useTargetLanguage();
  const { progress, resetProgress } = useProgress();
  const { soundEnabled, toggleSound } = useSound();

  const [saved, setSaved] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [iOpen, setIOpen] = useState(false);
  const [tOpen, setTOpen] = useState(false);

  const currentLevel = getLevelFromXp(progress.totalXp);
  const userName = user?.name || (isGuest ? 'Guest User' : 'User');
  const userEmail = user?.email || 'guest@linguaai.com';

  const handleSave = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  const currentInterfaceLabel = INTERFACE_LANGS.find(l => l.value === language)?.label || "English";

  const Dropdown = ({ open, onToggle, value, options, onSelect }: { open: boolean; onToggle: () => void; value: string; options: {value: string, label: string}[]; onSelect: (v: string) => void }) => (
    <div className="relative">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all" style={{ background: "var(--l-input-bg)", border: open ? "1px solid rgba(99,102,241,0.4)" : "1px solid var(--l-border)", color: "var(--l-text)", fontSize: "14px" }}>
        {value}
        <ChevronDown size={14} color="var(--l-muted)" style={{ transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }} />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-xl overflow-hidden z-10 animate-fade-in" style={{ background: "var(--l-surface2)", border: "1px solid var(--l-border)", boxShadow: "0 16px 40px rgba(0,0,0,0.2)" }}>
          {options.map((opt) => (
            <button key={opt.value} onClick={() => onSelect(opt.value)} className="w-full text-left px-4 py-2.5 transition-colors flex items-center justify-between" style={{ color: opt.label === value ? "#6366F1" : "var(--l-text2)", fontSize: "13px", background: opt.label === value ? "rgba(99,102,241,0.08)" : "transparent" }}
              onMouseEnter={(e) => { if (opt.label !== value) (e.currentTarget as HTMLButtonElement).style.background = "var(--l-card-hover)"; }}
              onMouseLeave={(e) => { if (opt.label !== value) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
            >
              {opt.label} {opt.label === value && <Check size={13} color="#6366F1" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6 animate-fade-in" style={{ background: "var(--l-bg)", minHeight: "100vh" }}>
      <div>
        <h1 style={{ color: "var(--l-text)", fontWeight: 800, fontSize: "26px", letterSpacing: "-0.02em" }}>Profile & Settings</h1>
        <p style={{ fontSize: "14px", color: "var(--l-muted)", marginTop: "4px" }}>Manage your account and learning preferences</p>
      </div>

      {/* User info */}
      <div className="p-6 rounded-2xl" style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.1), rgba(139,92,246,0.07))", border: "1px solid rgba(99,102,241,0.2)" }}>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)", boxShadow: "0 0 24px rgba(99,102,241,0.4)", color: "white" }}>
            <UserIcon size={28} />
          </div>
          <div>
            <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--l-text)" }}>{userName}</div>
            <div style={{ fontSize: "13px", color: "var(--l-muted)" }}>{userEmail}</div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <div className="px-2 py-0.5 rounded-md" style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.2)" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "#F59E0B" }}>{t('level')}: {t(currentLevel.toLowerCase().replace('-', '_'))}</span>
              </div>
              <div className="px-2 py-0.5 rounded-md" style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.2)" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "#6366F1" }}>{progress.totalXp} XP</span>
              </div>
              <div className="px-2 py-0.5 rounded-md" style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.2)" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "#F87171" }}>{progress.streak} day streak 🔥</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Settings */}
      <div className="p-6 rounded-2xl space-y-6" style={{ background: "var(--l-surface)", border: "1px solid var(--l-border)" }}>
        <h3 style={{ fontSize: "15px", fontWeight: 700, color: "var(--l-text)" }}>Learning Settings</h3>

        <div>
          <label className="flex items-center gap-2 mb-2" style={{ fontSize: "13px", fontWeight: 600, color: "var(--l-text2)" }}>
            <Globe size={14} color="var(--l-muted)" /> {t('interface_language')}
          </label>
          <Dropdown open={iOpen} onToggle={() => { setIOpen(!iOpen); setTOpen(false); }} value={currentInterfaceLabel} options={INTERFACE_LANGS} onSelect={(v) => { setLanguage(v as any); setIOpen(false); }} />
        </div>

        <div>
          <label className="flex items-center gap-2 mb-2" style={{ fontSize: "13px", fontWeight: 600, color: "var(--l-text2)" }}>
            <span style={{ fontSize: "14px" }}>🌍</span> {t('target_language')}
          </label>
          <Dropdown open={tOpen} onToggle={() => { setTOpen(!tOpen); setIOpen(false); }} value={targetLanguage} options={TARGET_LANGS.map(l => ({value: l, label: l}))} onSelect={(v) => { setTargetLanguage(v as TargetLanguage); setTOpen(false); }} />
        </div>

        {/* Sound toggle */}
        <div className="flex items-center justify-between py-3" style={{ borderTop: "1px solid var(--l-border)" }}>
          <div className="flex items-center gap-3">
            <Volume2 size={16} color="var(--l-muted)" />
            <div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--l-text)" }}>{t('sound_effects')}</div>
              <div style={{ fontSize: "11px", color: "var(--l-muted)" }}>Play sounds for correct/incorrect answers</div>
            </div>
          </div>
          <button onClick={() => toggleSound()} className="w-12 h-6 rounded-full transition-all duration-300 relative" style={{ background: soundEnabled ? "#6366F1" : "var(--l-surface3)", boxShadow: soundEnabled ? "0 0 12px rgba(99,102,241,0.4)" : "none" }}>
            <div className="absolute top-0.5 w-5 h-5 rounded-full transition-all duration-300" style={{ background: "white", left: soundEnabled ? "calc(100% - 22px)" : "2px", boxShadow: "0 2px 4px rgba(0,0,0,0.2)" }} />
          </button>
        </div>

        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-6 py-3 rounded-xl transition-all duration-200"
          style={{ background: saved ? "rgba(16,185,129,0.15)" : "linear-gradient(135deg, #6366F1, #8B5CF6)", color: saved ? "#10B981" : "white", fontSize: "14px", fontWeight: 700, border: saved ? "1px solid rgba(16,185,129,0.3)" : "none", boxShadow: saved ? "none" : "0 4px 16px rgba(99,102,241,0.4)" }}
        >
          {saved ? <><Check size={16} /> Saved!</> : "Save Settings"}
        </button>
      </div>

      {/* Danger zone */}
      <div className="p-6 rounded-2xl" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>
        <div className="flex items-center gap-2 mb-4"><AlertTriangle size={15} color="#EF4444" /><span style={{ fontSize: "14px", fontWeight: 700, color: "#F87171" }}>Danger Zone</span></div>
        {!resetConfirm ? (
          <div className="flex items-center justify-between">
            <div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--l-text)" }}>Reset Language Progress</div>
              <div style={{ fontSize: "12px", color: "var(--l-muted)" }}>Clears all XP, streaks, and completed lessons.</div>
            </div>
            <button onClick={() => setResetConfirm(true)} className="px-4 py-2 rounded-xl transition-all" style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)", color: "#F87171", fontSize: "13px", fontWeight: 600 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.2)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.12)"; }}
            >Reset Progress</button>
          </div>
        ) : (
          <div className="p-4 rounded-xl" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", animation: "fade-in 0.2s ease-out" }}>
            <p style={{ fontSize: "13px", color: "#F87171", marginBottom: "12px" }}>Are you sure? This cannot be undone. All your {targetLanguage} learning progress will be permanently deleted.</p>
            <div className="flex gap-3">
              <button onClick={() => setResetConfirm(false)} className="px-4 py-2 rounded-xl" style={{ background: "var(--l-card-hover)", color: "var(--l-text2)", fontSize: "13px", fontWeight: 600, border: "1px solid var(--l-border)" }}>Cancel</button>
              <button onClick={async () => { await resetProgress(); setResetConfirm(false); }} className="px-4 py-2 rounded-xl" style={{ background: "#EF4444", color: "white", fontSize: "13px", fontWeight: 700 }}>Yes, Reset Everything</button>
            </div>
          </div>
        )}
      </div>

      <button
        onClick={logout}
        className="flex items-center gap-2 px-5 py-3 rounded-xl transition-all duration-200"
        style={{ background: "var(--l-card-hover)", border: "1px solid var(--l-border)", color: "var(--l-text2)", fontSize: "14px", fontWeight: 600 }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#EF4444"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(239,68,68,0.3)"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.06)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--l-text2)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--l-border)"; (e.currentTarget as HTMLButtonElement).style.background = "var(--l-card-hover)"; }}
      >
        <LogOut size={16} /> {t('logout')}
      </button>
    </div>
  );
}
