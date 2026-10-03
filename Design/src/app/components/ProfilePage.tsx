import { useState } from "react";
import { Globe, Volume2, AlertTriangle, LogOut, Check, ChevronDown } from "lucide-react";

const LANGUAGES = ["English", "German", "Spanish", "French", "Turkish", "Arabic", "Japanese"];
const TARGET_LANGS = ["German", "Spanish", "French", "Italian", "Japanese", "Korean", "Mandarin"];

interface ProfilePageProps {
  userName: string;
  onLogout: () => void;
}

export function ProfilePage({ userName, onLogout }: ProfilePageProps) {
  const [interfaceLang, setInterfaceLang] = useState("English");
  const [targetLang, setTargetLang] = useState("German");
  const [sound, setSound] = useState(true);
  const [saved, setSaved] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [iOpen, setIOpen] = useState(false);
  const [tOpen, setTOpen] = useState(false);

  const handleSave = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  const Dropdown = ({ open, onToggle, value, options, onSelect }: { open: boolean; onToggle: () => void; value: string; options: string[]; onSelect: (v: string) => void }) => (
    <div className="relative">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all" style={{ background: "var(--l-input-bg)", border: open ? "1px solid rgba(99,102,241,0.4)" : "1px solid var(--l-border)", color: "var(--l-text)", fontSize: "14px" }}>
        {value}
        <ChevronDown size={14} color="var(--l-muted)" style={{ transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }} />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-xl overflow-hidden z-10" style={{ background: "var(--l-surface2)", border: "1px solid var(--l-border)", boxShadow: "0 16px 40px rgba(0,0,0,0.2)" }}>
          {options.map((l) => (
            <button key={l} onClick={() => onSelect(l)} className="w-full text-left px-4 py-2.5 transition-colors flex items-center justify-between" style={{ color: l === value ? "#6366F1" : "var(--l-text2)", fontSize: "13px", background: l === value ? "rgba(99,102,241,0.08)" : "transparent" }}
              onMouseEnter={(e) => { if (l !== value) (e.currentTarget as HTMLButtonElement).style.background = "var(--l-card-hover)"; }}
              onMouseLeave={(e) => { if (l !== value) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
            >
              {l} {l === value && <Check size={13} color="#6366F1" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 style={{ color: "var(--l-text)", fontWeight: 800, fontSize: "26px", letterSpacing: "-0.02em" }}>Profile & Settings</h1>
        <p style={{ fontSize: "14px", color: "var(--l-muted)", marginTop: "4px" }}>Manage your account and learning preferences</p>
      </div>

      {/* User info */}
      <div className="p-6 rounded-2xl" style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.1), rgba(139,92,246,0.07))", border: "1px solid rgba(99,102,241,0.2)" }}>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)", boxShadow: "0 0 24px rgba(99,102,241,0.4)", fontSize: "28px" }}>🧑</div>
          <div>
            <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--l-text)" }}>{userName}</div>
            <div style={{ fontSize: "13px", color: "var(--l-muted)" }}>alex@example.com</div>
            <div className="flex items-center gap-2 mt-1">
              <div className="px-2 py-0.5 rounded-md" style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.2)" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "#F59E0B" }}>Level 5</span>
              </div>
              <div className="px-2 py-0.5 rounded-md" style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.2)" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "#6366F1" }}>450 XP</span>
              </div>
              <div className="px-2 py-0.5 rounded-md" style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.2)" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "#F87171" }}>7 day streak 🔥</span>
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
            <Globe size={14} color="var(--l-muted)" /> App Interface Language
          </label>
          <Dropdown open={iOpen} onToggle={() => { setIOpen(!iOpen); setTOpen(false); }} value={interfaceLang} options={LANGUAGES} onSelect={(v) => { setInterfaceLang(v); setIOpen(false); }} />
        </div>

        <div>
          <label className="flex items-center gap-2 mb-2" style={{ fontSize: "13px", fontWeight: 600, color: "var(--l-text2)" }}>
            <span style={{ fontSize: "14px" }}>🌍</span> Target Learning Language
          </label>
          <Dropdown open={tOpen} onToggle={() => { setTOpen(!tOpen); setIOpen(false); }} value={targetLang} options={TARGET_LANGS} onSelect={(v) => { setTargetLang(v); setTOpen(false); }} />
        </div>

        {/* Sound toggle */}
        <div className="flex items-center justify-between py-3" style={{ borderTop: "1px solid var(--l-border)" }}>
          <div className="flex items-center gap-3">
            <Volume2 size={16} color="var(--l-muted)" />
            <div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--l-text)" }}>Sound Effects</div>
              <div style={{ fontSize: "11px", color: "var(--l-muted)" }}>Play sounds for correct/incorrect answers</div>
            </div>
          </div>
          <button onClick={() => setSound(!sound)} className="w-12 h-6 rounded-full transition-all duration-300 relative" style={{ background: sound ? "#6366F1" : "var(--l-surface3)", boxShadow: sound ? "0 0 12px rgba(99,102,241,0.4)" : "none" }}>
            <div className="absolute top-0.5 w-5 h-5 rounded-full transition-all duration-300" style={{ background: "white", left: sound ? "calc(100% - 22px)" : "2px", boxShadow: "0 2px 4px rgba(0,0,0,0.2)" }} />
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
              <div style={{ fontSize: "12px", color: "var(--l-muted)" }}>Clears all XP, streaks, and completed lessons for German.</div>
            </div>
            <button onClick={() => setResetConfirm(true)} className="px-4 py-2 rounded-xl transition-all" style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)", color: "#F87171", fontSize: "13px", fontWeight: 600 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.2)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.12)"; }}
            >Reset Progress</button>
          </div>
        ) : (
          <div className="p-4 rounded-xl" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)" }}>
            <p style={{ fontSize: "13px", color: "#F87171", marginBottom: "12px" }}>Are you sure? This cannot be undone. All your German learning progress will be permanently deleted.</p>
            <div className="flex gap-3">
              <button onClick={() => setResetConfirm(false)} className="px-4 py-2 rounded-xl" style={{ background: "var(--l-card-hover)", color: "var(--l-text2)", fontSize: "13px", fontWeight: 600, border: "1px solid var(--l-border)" }}>Cancel</button>
              <button onClick={() => setResetConfirm(false)} className="px-4 py-2 rounded-xl" style={{ background: "#EF4444", color: "white", fontSize: "13px", fontWeight: 700 }}>Yes, Reset Everything</button>
            </div>
          </div>
        )}
      </div>

      <button
        onClick={onLogout}
        className="flex items-center gap-2 px-5 py-3 rounded-xl transition-all duration-200"
        style={{ background: "var(--l-card-hover)", border: "1px solid var(--l-border)", color: "var(--l-text2)", fontSize: "14px", fontWeight: 600 }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#EF4444"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(239,68,68,0.3)"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.06)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--l-text2)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--l-border)"; (e.currentTarget as HTMLButtonElement).style.background = "var(--l-card-hover)"; }}
      >
        <LogOut size={16} />Log Out
      </button>
    </div>
  );
}
