import React, { useState } from "react";
import { Globe, Eye, EyeOff, ArrowRight, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { login as apiLogin, register as apiRegister } from "../../api/authApi";

interface AuthPageProps {
  initialMode: "login" | "register";
}

export function AuthPage({ initialMode }: AuthPageProps) {
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();
  const { login, loginAsGuest } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      let data;
      if (mode === "login") {
        data = await apiLogin(email, password);
      } else {
        data = await apiRegister(name, email, password);
      }
      login(data.user, data.access_token);
      navigate("/");
    } catch (err: any) {
      let errorMessage = `${mode === "login" ? "Login" : "Registration"} failed. Please try again.`;
      if (err.response?.data?.message) {
        errorMessage = Array.isArray(err.response.data.message)
          ? err.response.data.message.join(", ")
          : err.response.data.message;
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleGuest = () => {
    loginAsGuest();
    navigate("/");
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative animate-fade-in"
      style={{
        background: "var(--l-bg)",
        // adding a subtle radial gradient specific to auth page
        backgroundImage: "radial-gradient(ellipse at 20% 50%, rgba(99,102,241,0.06) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(139,92,246,0.04) 0%, transparent 60%)"
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

      <div className="w-full max-w-sm relative">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4" style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)", boxShadow: "0 0 40px rgba(99,102,241,0.4)" }}>
            <Globe size={24} color="white" />
          </div>
          <h1 style={{ fontSize: "28px", fontWeight: 800, letterSpacing: "-0.03em", color: "var(--l-text)" }}>LinguaAI</h1>
          <p style={{ fontSize: "14px", color: "var(--l-muted)", marginTop: "4px" }}>Your AI-powered language tutor</p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-6 relative z-10"
          style={{
            background: "var(--l-surface)",
            border: "1px solid var(--l-border)",
            boxShadow: "0 24px 48px rgba(0,0,0,0.15)",
          }}
        >
          {/* Tabs */}
          <div className="flex p-1 rounded-xl mb-6" style={{ background: "var(--l-card-hover)" }}>
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                type="button"
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

          {error && (
            <div className="mb-4 p-3 rounded-lg text-sm font-medium" style={{ background: "rgba(239,68,68,0.1)", color: "#EF4444", border: "1px solid rgba(239,68,68,0.2)" }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "register" && (
              <div className="animate-fade-in">
                <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--l-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Johnson"
                  required={mode === "register"}
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
                required
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
                  required
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
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl mt-2 transition-all duration-200"
              style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)", color: "white", fontSize: "14px", fontWeight: 700, boxShadow: "0 4px 20px rgba(99,102,241,0.4)", opacity: loading ? 0.7 : 1 }}
              onMouseEnter={(e) => { if (!loading) { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)"; (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 8px 30px rgba(99,102,241,0.5)"; } }}
              onMouseLeave={(e) => { if (!loading) { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)"; (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 20px rgba(99,102,241,0.4)"; } }}
            >
              {loading ? "Please wait..." : (mode === "login" ? "Sign In" : "Create Account")}
              {!loading && <ArrowRight size={16} />}
            </button>
          </form>

          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px" style={{ background: "var(--l-border)" }} />
            <span style={{ fontSize: "12px", color: "var(--l-subtle)" }}>or</span>
            <div className="flex-1 h-px" style={{ background: "var(--l-border)" }} />
          </div>

          <button
            onClick={handleGuest}
            type="button"
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
          <button type="button" onClick={() => setMode(mode === "login" ? "register" : "login")} style={{ color: "#6366F1", fontWeight: 600 }}>
            {mode === "login" ? "Sign up" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
