import { useState } from "react";
import { Globe, Eye, EyeOff, ArrowRight, Sparkles } from "lucide-react";
import { useTheme } from "./ThemeContext";

interface AuthPageProps {
  onAuth: (name: string) => void;
}

export function AuthPage({ onAuth }: AuthPageProps) {
  const { isDark, toggleTheme } = useTheme();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAuth(name || email.split("@")[0] || "Alex");
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative"
      style={{
        background: isDark
          ? "radial-gradient(ellipse at 20% 50%, rgba(99,102,241,0.08) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(139,92,246,0.06) 0%, transparent 60%), #080B18"
          : "radial-gradient(ellipse at 20% 50%, rgba(99,102,241,0.06) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(139,92,246,0.04) 0%, transparent 60%), #EEF1FF",
      }}
    >
      {/* Background grid */}
      <div
        className="fixed inset-0 opacity-20 pointer-events-none"
        style={{
          backgroundImage: "linear-gradient(rgba(99,102,241,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.1) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* Theme toggle top-right */}
      <button
        onClick={toggleTheme}
        className="absolute top-5 right-5 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200"
        style={{
          background: isDark ? "rgba(245,158,11,0.12)" : "rgba(99,102,241,0.12)",
          border: isDark ? "1px solid rgba(245,158,11,0.25)" : "1px solid rgba(99,102,241,0.25)",
          color: isDark ? "#F59E0B" : "#6366F1",
        }}
      >
        {isDark
          ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
          : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        }
      </button>

      <div className="w-full max-w-sm relative">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4" style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)", boxShadow: "0 0 40px rgba(99,102,241,0.4)" }}>
            <Globe size={24} color="white" />
          </div>
          <h1 className="gradient-text" style={{ fontSize: "28px", fontWeight: 800, letterSpacing: "-0.03em" }}>LinguaAI</h1>
          <p style={{ fontSize: "14px", color: "var(--l-muted)", marginTop: "4px" }}>Your AI-powered language tutor</p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-6"
          style={{
            background: "var(--l-surface)",
            border: "1px solid var(--l-border)",
            boxShadow: isDark ? "0 24px 48px rgba(0,0,0,0.4)" : "0 24px 48px rgba(99,102,241,0.1)",
          }}
        >
          {/* Tabs */}
          <div className="flex p-1 rounded-xl mb-6" style={{ background: "var(--l-card-hover)" }}>
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="flex-1 py-2 rounded-lg transition-all duration-200 capitalize"
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  background: mode === m ? "rgba(99,102,241,0.2)" : "transparent",
                  color: mode === m ? "#6366F1" : "var(--l-muted)",
                  border: mode === m ? "1px solid rgba(99,102,241,0.3)" : "1px solid transparent",
                }}
              >
                {m === "login" ? "Sign In" : "Create Account"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "register" && (
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--l-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Johnson"
                  className="w-full mt-1.5 px-4 py-3 rounded-xl outline-none transition-all"
                  style={{ background: "var(--l-input-bg)", border: "1px solid var(--l-border)", color: "var(--l-text)", fontSize: "14px" }}
                  onFocus={(e) => { e.target.style.borderColor = "rgba(99,102,241,0.5)"; }}
                  onBlur={(e) => { e.target.style.borderColor = "var(--l-border)"; }}
                />
              </div>
            )}

            <div>
              <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--l-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alex@example.com"
                className="w-full mt-1.5 px-4 py-3 rounded-xl outline-none transition-all"
                style={{ background: "var(--l-input-bg)", border: "1px solid var(--l-border)", color: "var(--l-text)", fontSize: "14px" }}
                onFocus={(e) => { e.target.style.borderColor = "rgba(99,102,241,0.5)"; }}
                onBlur={(e) => { e.target.style.borderColor = "var(--l-border)"; }}
              />
            </div>

            <div>
              <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--l-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Password</label>
              <div className="relative mt-1.5">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 pr-11 rounded-xl outline-none transition-all"
                  style={{ background: "var(--l-input-bg)", border: "1px solid var(--l-border)", color: "var(--l-text)", fontSize: "14px" }}
                  onFocus={(e) => { e.target.style.borderColor = "rgba(99,102,241,0.5)"; }}
                  onBlur={(e) => { e.target.style.borderColor = "var(--l-border)"; }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: "var(--l-muted)" }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl mt-2 transition-all duration-200"
              style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)", color: "white", fontSize: "14px", fontWeight: 700, boxShadow: "0 4px 20px rgba(99,102,241,0.4)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)"; (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 8px 30px rgba(99,102,241,0.5)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)"; (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 20px rgba(99,102,241,0.4)"; }}
            >
              {mode === "login" ? "Sign In" : "Create Account"}
              <ArrowRight size={16} />
            </button>
          </form>

          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px" style={{ background: "var(--l-border)" }} />
            <span style={{ fontSize: "12px", color: "var(--l-subtle)" }}>or</span>
            <div className="flex-1 h-px" style={{ background: "var(--l-border)" }} />
          </div>

          <button
            onClick={() => onAuth("Guest")}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl transition-all duration-200"
            style={{ background: "var(--l-card-hover)", border: "1px solid var(--l-border)", color: "var(--l-text2)", fontSize: "14px", fontWeight: 600 }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--l-input-bg)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--l-card-hover)"; }}
          >
            <Sparkles size={16} />
            Continue as Guest
          </button>
        </div>

        <p className="text-center mt-4" style={{ fontSize: "13px", color: "var(--l-subtle)" }}>
          {mode === "login" ? "Don't have an account? " : "Already have an account? "}
          <button onClick={() => setMode(mode === "login" ? "register" : "login")} style={{ color: "#6366F1", fontWeight: 600 }}>
            {mode === "login" ? "Sign up" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
