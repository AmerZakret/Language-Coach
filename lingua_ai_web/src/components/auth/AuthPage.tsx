import React, { useState } from "react";
import { Eye, EyeOff, ArrowRight, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { login as apiLogin, register as apiRegister } from "../../api/authApi";
import { useLanguage } from "../../context/LanguageContext";
import logoImg from "../../assets/images/language-learning.png";
import { getUserProgressKey } from "../../utils/userKey";
import { useSessionGuard } from "../../utils/useSessionGuard";

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
  const { login, loginAsGuest, user, isGuest, token } = useAuth();
  const captureSession = useSessionGuard(getUserProgressKey(user, isGuest, token));
  const { t } = useLanguage();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const isCurrent = captureSession();
    if (!isCurrent()) return;
    setError("");
    setLoading(true);

    try {
      let data;
      if (mode === "login") {
        data = await apiLogin(email, password);
      } else {
        data = await apiRegister(name, email, password);
      }
      if (!isCurrent()) return;
      await login(data.user, data.access_token);
      navigate("/");
    } catch (err: any) {
      if (!isCurrent()) return;
      let errorMessage = mode === "login" ? t("login_failed") : t("registration_failed");
      if (err.response?.data?.message) {
        errorMessage = Array.isArray(err.response.data.message)
          ? err.response.data.message.join(", ")
          : err.response.data.message;
      }
      setError(errorMessage);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  const handleGuest = async () => {
    await loginAsGuest();
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
        <div className="text-center mb-8 flex flex-col items-center">
          <img src={logoImg} alt="LinguaAI Logo" style={{ width: "56px", height: "56px", objectFit: "contain", marginBottom: "12px" }} />
          <h1 style={{ fontSize: "28px", fontWeight: 800, letterSpacing: "-0.03em", color: "var(--l-text)" }}>
            Lingua<span style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>AI</span>
          </h1>
          <p style={{ fontSize: "14px", color: "var(--l-muted)", marginTop: "4px" }}>{t("your_ai_tutor")}</p>
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
                className={`flex-1 py-2 rounded-lg transition-all duration-200 border text-xs font-bold ${mode === m ? 'bg-indigo-500/15 text-indigo-500 border-indigo-500/30 shadow-sm' : 'border-transparent text-[var(--l-muted)] hover:bg-[var(--l-card-hover)]'}`}
              >
                {m === "login" ? t("sign_in") : t("create_account")}
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
                <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--l-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{t("full_name")}</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Johnson"
                  required={mode === "register"}
                  className="form-input mt-1.5"
                />
              </div>
            )}

            <div>
              <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--l-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{t("email")}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alex@example.com"
                required
                className="form-input mt-1.5"
              />
            </div>

            <div>
              <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--l-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{t("password")}</label>
              <div className="relative mt-1.5">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="form-input pr-11"
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
              className="w-full btn-primary mt-2"
              style={{ opacity: loading ? 0.7 : 1 }}
            >
              {loading ? t("please_wait") : (mode === "login" ? t("sign_in") : t("create_account"))}
              {!loading && <ArrowRight size={16} />}
            </button>
          </form>

          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px" style={{ background: "var(--l-border)" }} />
            <span style={{ fontSize: "12px", color: "var(--l-subtle)" }}>{t("or")}</span>
            <div className="flex-1 h-px" style={{ background: "var(--l-border)" }} />
          </div>

          <button
            onClick={handleGuest}
            type="button"
            className="w-full btn-secondary"
          >
            <Sparkles size={16} className="text-indigo-500" />
            {t("continue_as_guest")}
          </button>
        </div>

        <p className="text-center mt-4" style={{ fontSize: "13px", color: "var(--l-subtle)" }}>
          {mode === "login" ? t("dont_have_account") + " " : t("already_have_account") + " "}
          <button type="button" onClick={() => setMode(mode === "login" ? "register" : "login")} style={{ color: "#6366F1", fontWeight: 600 }}>
            {mode === "login" ? t("sign_up_action") : t("sign_in_action")}
          </button>
        </p>
      </div>
    </div>
  );
}
