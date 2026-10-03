import { useState } from "react";
import { useNavigate, useLocation, Outlet } from "react-router-dom";
import {
  LayoutDashboard, BookOpen, PenLine, Bot, CreditCard, User,
  Menu, X, Globe, LogOut, Sun, Moon, Mic, WifiOff
} from "lucide-react";
import languageLearningImg from "../../assets/images/language-learning.png";
import { useTheme } from "../../context/ThemeContext";
import { useAuth } from "../../context/AuthContext";
import { useProgress } from "../../context/ProgressContext";
import { useTargetLanguage } from "../../context/TargetLanguageContext";
import { useLanguage } from "../../context/LanguageContext";
import { useNetwork } from "../../context/NetworkContext";

const NAV_ITEMS = [
  { icon: LayoutDashboard, labelKey: "dashboard", path: "/" },
  { icon: BookOpen, labelKey: "lessons", path: "/lessons" },
  { icon: PenLine, labelKey: "writing_practice", path: "/writing" },
  { icon: Bot, labelKey: "ai_coach", path: "/ai-coach" },
  { icon: CreditCard, labelKey: "flashcards", path: "/flashcards" },
  { icon: Mic, labelKey: "pronunciation_practice", path: "/pronunciation-practice" },
  { icon: Globe, labelKey: "community", path: "/community" },
  { icon: User, labelKey: "profile", path: "/profile" },
];

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isDark, toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { user, logout } = useAuth();
  const { progress } = useProgress();
  const { targetLanguage } = useTargetLanguage();
  const { language, setLanguage, t } = useLanguage();
  const { isOffline } = useNetwork();

  const isActive = (path: string) => {
    if (path === "/" && location.pathname !== "/") return false;
    return location.pathname.startsWith(path);
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const toggleLanguage = () => {
    setLanguage(language === "en" ? "tr" : "en");
  };

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden" style={{ background: "var(--l-bg)", color: "var(--l-text)" }}>
      {/* Mobile drawer overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Mobile Drawer (aside) - slide out from left */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 flex flex-col h-full transition-transform duration-300 ease-out lg:hidden ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
        style={{
          background: "var(--l-sidebar)",
          borderRight: "1px solid var(--l-border-subtle)",
          width: "260px",
          boxShadow: "4px 0 24px rgba(0,0,0,0.15)",
        }}
      >
        {/* Mobile Drawer Header */}
        <div className="flex items-center gap-3 px-6 py-6">
          <img src={languageLearningImg} alt="LinguaAI Logo" style={{ width: "32px", height: "32px", objectFit: "contain" }} />
          <div>
            <div style={{ fontSize: "18px", fontWeight: 800, color: "var(--l-text)", letterSpacing: "-0.02em" }}>
              Lingua<span style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>AI</span>
            </div>
            <div style={{ fontSize: "11px", color: "#8B5CF6", fontWeight: 600 }}>Premium</div>
          </div>
          <button className="ml-auto" onClick={() => setSidebarOpen(false)}>
            <X size={18} color="var(--l-muted)" />
          </button>
        </div>

        {/* Mobile target language status */}
        <div className="mx-4 mb-6 px-4 py-2.5 rounded-xl flex items-center gap-2" style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}>
          <div>
            <div style={{ fontSize: "11px", color: "var(--l-muted)" }}>{t("learning")}</div>
            <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--l-text)" }}>{t('lang_' + targetLanguage.toLowerCase())}</div>
          </div>
        </div>

        {/* Mobile navigation links */}
        <nav className="flex-1 px-3 space-y-1">
          {NAV_ITEMS.map(({ icon: Icon, labelKey, path }) => (
            <button
              key={path}
              onClick={() => { navigate(path); setSidebarOpen(false); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200"
              style={{
                background: isActive(path) ? "rgba(99,102,241,0.15)" : "transparent",
                border: isActive(path) ? "1px solid rgba(99,102,241,0.25)" : "1px solid transparent",
                color: isActive(path) ? "#6366F1" : "var(--l-muted)",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                if (!isActive(path)) {
                  (e.currentTarget as HTMLButtonElement).style.background = "var(--l-card-hover)";
                  (e.currentTarget as HTMLButtonElement).style.color = "var(--l-text2)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive(path)) {
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                  (e.currentTarget as HTMLButtonElement).style.color = "var(--l-muted)";
                }
              }}
            >
              <Icon size={18} />
              <span style={{ fontSize: "14px", fontWeight: isActive(path) ? 600 : 500 }}>{t(labelKey)}</span>
            </button>
          ))}
        </nav>

        {/* Mobile user profile info */}
        <div className="p-4 mt-auto">
          <div className="p-3 rounded-xl" style={{ background: "var(--l-card-hover)", border: "1px solid var(--l-border-subtle)" }}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}>
                <User size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--l-text)" }}>{user?.name || "Guest"}</div>
                <div style={{ fontSize: "11px", color: "var(--l-muted)" }}>{t('level_label')} {Math.floor(progress.totalXp / 500) + 1}</div>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors"
              style={{ color: "var(--l-muted)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#EF4444"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--l-muted)"; }}
            >
              <LogOut size={14} />
              <span style={{ fontSize: "12px" }}>{t("logout")}</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Top Navbar */}
      <header
        className="w-full sticky top-0 z-40 px-8 py-5 shrink-0"
        style={{
          background: "var(--l-topbar)",
          backdropFilter: "blur(20px)",
          borderBottom: "1px solid var(--l-border-subtle)",
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center"
        }}
      >
        {/* Left: Hamburger menu + Logo */}
        <div className="flex items-center gap-3.5 justify-start">
          <button className="lg:hidden p-2 rounded-lg hover:bg-[var(--l-card-hover)] cursor-pointer" onClick={() => setSidebarOpen(true)}>
            <Menu size={22} color="var(--l-muted)" />
          </button>
          
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => navigate("/")}>
            <img src={languageLearningImg} alt="LinguaAI Logo" style={{ width: "36px", height: "36px", objectFit: "contain" }} />
            <span style={{ fontSize: "22px", fontWeight: 800, color: "var(--l-text)", letterSpacing: "-0.02em" }}>
              Lingua<span style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>AI</span>
            </span>
          </div>
        </div>

        {/* Center: Navigation Pill/Dock (Desktop only) */}
        <nav 
          className="hidden lg:flex items-center gap-2 px-2.5 py-1.5 rounded-full border"
          style={{
            background: "var(--l-surface2)",
            borderColor: "var(--l-border-subtle)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.03)",
            justifySelf: "center"
          }}
        >
          {NAV_ITEMS.map(({ icon: Icon, labelKey, path }) => {
            const active = isActive(path);
            return (
              <button
                key={path}
                onClick={() => navigate(path)}
                title={t(labelKey)}
                className="flex items-center gap-2.5 px-4.5 py-2.5 rounded-full transition-all duration-200"
                style={{
                  background: active ? "rgba(99,102,241,0.12)" : "transparent",
                  border: active ? "1px solid rgba(99,102,241,0.2)" : "1px solid transparent",
                  color: active ? "#6366F1" : "var(--l-muted)",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    (e.currentTarget as HTMLButtonElement).style.background = "var(--l-card-hover)";
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--l-text2)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--l-muted)";
                  }
                }}
              >
                <Icon size={18} />
                {active && (
                  <span 
                    className="animate-fade-in" 
                    style={{ 
                      fontSize: "14.5px", 
                      fontWeight: 600,
                      whiteSpace: "nowrap"
                    }}
                  >
                    {t(labelKey)}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Right: Actions */}
        <div className="flex items-center gap-4 justify-end">
          {/* Learning Target Language Badge (Desktop only) */}
          <div className="hidden md:flex items-center gap-1.5 px-4.5 py-2.5 rounded-xl" style={{ background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)" }}>
            <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--l-text)" }}>{t('lang_' + targetLanguage.toLowerCase())}</span>
          </div>

          {/* Interface translation switch */}
          <button 
            onClick={toggleLanguage}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl transition-colors hover:bg-[var(--l-card-hover)]" 
            style={{ background: "var(--l-input-bg)", border: "1px solid var(--l-border)", color: "var(--l-text2)", cursor: "pointer" }}
          >
            <Globe size={16} />
            <span style={{ fontSize: "13px", fontWeight: 600 }}>{language.toUpperCase()}</span>
          </button>

          {/* Theme switcher toggle */}
          <button
            onClick={toggleTheme}
            className="w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300"
            style={{
              background: isDark ? "rgba(245,158,11,0.12)" : "rgba(99,102,241,0.12)",
              border: isDark ? "1px solid rgba(245,158,11,0.25)" : "1px solid rgba(99,102,241,0.25)",
              color: isDark ? "#F59E0B" : "#6366F1",
              cursor: "pointer",
            }}
            title={isDark ? t('theme_light') : t('theme_dark')}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.08)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {/* User profile / Logout dropdown */}
          <button 
            onClick={() => navigate("/profile")}
            className="w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer transition-all hover:ring-2 hover:ring-indigo-500/50 outline-none text-white" 
            style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}
            title={user?.name || "Profile"}
          >
            <User size={18} />
          </button>
        </div>
      </header>

      {isOffline && (
        <div 
          className="flex items-center justify-center gap-2 px-6 py-2.5 text-center text-xs font-bold transition-all animate-fade-in shrink-0"
          style={{ 
            background: "rgba(245, 158, 11, 0.12)", 
            color: "#F59E0B", 
            borderBottom: "1px solid rgba(245, 158, 11, 0.2)"
          }}
        >
          <WifiOff size={14} />
          <span>{t("offline_banner_text")}</span>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto" style={{ background: "var(--l-bg)" }}>
        <div className="max-w-7xl mx-auto w-full p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
