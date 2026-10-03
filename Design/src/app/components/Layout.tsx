import { useState } from "react";
import { useNavigate, useLocation } from "react-router";
import {
  LayoutDashboard, BookOpen, PenLine, Bot, CreditCard, User,
  Zap, Flame, ChevronDown, Menu, X, Globe, LogOut, Sun, Moon
} from "lucide-react";
import { useTheme } from "./ThemeContext";

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { icon: BookOpen, label: "Lessons", path: "/lessons" },
  { icon: PenLine, label: "Writing", path: "/writing" },
  { icon: Bot, label: "AI Coach", path: "/coach" },
  { icon: CreditCard, label: "Flashcards", path: "/flashcards" },
  { icon: User, label: "Profile", path: "/profile" },
];

interface LayoutProps {
  children: React.ReactNode;
  user?: { name: string; xp: number; streak: number; language: string };
  onLogout?: () => void;
}

export function Layout({ children, user = { name: "Alex", xp: 450, streak: 7, language: "German" }, onLogout }: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isDark, toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ background: "var(--l-bg)" }}>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:relative z-50 flex flex-col h-full transition-transform duration-300 ease-out lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
        style={{
          background: "var(--l-sidebar)",
          borderRight: "1px solid var(--l-border-subtle)",
          width: "240px",
          minWidth: "240px",
          boxShadow: isDark ? "none" : "4px 0 24px rgba(0,0,0,0.06)",
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-6">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}>
            <Globe size={18} color="white" />
          </div>
          <div>
            <div style={{ fontSize: "16px", fontWeight: 800, color: "var(--l-text)", letterSpacing: "-0.02em" }}>LinguaAI</div>
            <div style={{ fontSize: "11px", color: "#6366F1", fontWeight: 600 }}>Premium</div>
          </div>
          <button className="ml-auto lg:hidden" onClick={() => setSidebarOpen(false)}>
            <X size={18} color="var(--l-muted)" />
          </button>
        </div>

        {/* Language badge */}
        <div className="mx-4 mb-6 px-3 py-2 rounded-xl flex items-center gap-2" style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}>
          <span style={{ fontSize: "18px" }}>🇩🇪</span>
          <div>
            <div style={{ fontSize: "11px", color: "var(--l-muted)" }}>Learning</div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--l-text)" }}>{user.language}</div>
          </div>
        </div>

        {/* Nav items */}
        <nav className="flex-1 px-3 space-y-1">
          {NAV_ITEMS.map(({ icon: Icon, label, path }) => (
            <button
              key={path}
              onClick={() => { navigate(path); setSidebarOpen(false); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200"
              style={{
                background: isActive(path) ? "rgba(99,102,241,0.15)" : "transparent",
                border: isActive(path) ? "1px solid rgba(99,102,241,0.25)" : "1px solid transparent",
                color: isActive(path) ? "#6366F1" : "var(--l-muted)",
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
              <span style={{ fontSize: "14px", fontWeight: isActive(path) ? 600 : 500 }}>{label}</span>
              {isActive(path) && <div className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: "#6366F1" }} />}
            </button>
          ))}
        </nav>

        {/* User section */}
        <div className="p-4 mt-auto">
          <div className="p-3 rounded-xl" style={{ background: "var(--l-card-hover)", border: "1px solid var(--l-border-subtle)" }}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}>
                <span style={{ fontSize: "14px" }}>🧑</span>
              </div>
              <div className="flex-1 min-w-0">
                <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--l-text)" }}>{user.name}</div>
                <div style={{ fontSize: "11px", color: "var(--l-muted)" }}>Level 5</div>
              </div>
            </div>
            <button
              onClick={onLogout}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors"
              style={{ color: "var(--l-muted)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#EF4444"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--l-muted)"; }}
            >
              <LogOut size={14} />
              <span style={{ fontSize: "12px" }}>Logout</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Topbar */}
        <header
          className="flex items-center gap-3 px-6 py-4 shrink-0"
          style={{
            background: "var(--l-topbar)",
            backdropFilter: "blur(20px)",
            borderBottom: "1px solid var(--l-border-subtle)",
          }}
        >
          <button className="lg:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu size={20} color="var(--l-muted)" />
          </button>

          <div className="flex-1" />

          {/* XP */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl" style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.2)" }}>
            <Zap size={14} color="#F59E0B" />
            <span style={{ fontSize: "13px", fontWeight: 700, color: "#F59E0B" }}>{user.xp} XP</span>
          </div>

          {/* Streak */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl" style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <Flame size={14} color="#F87171" />
            <span style={{ fontSize: "13px", fontWeight: 700, color: "#F87171" }}>{user.streak}</span>
          </div>

          {/* Interface language */}
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-xl transition-colors" style={{ background: "var(--l-card-hover)", border: "1px solid var(--l-border)", color: "var(--l-text2)" }}>
            <Globe size={14} />
            <span style={{ fontSize: "13px" }}>EN</span>
            <ChevronDown size={12} />
          </button>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-300"
            style={{
              background: isDark ? "rgba(245,158,11,0.12)" : "rgba(99,102,241,0.12)",
              border: isDark ? "1px solid rgba(245,158,11,0.25)" : "1px solid rgba(99,102,241,0.25)",
              color: isDark ? "#F59E0B" : "#6366F1",
            }}
            title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.1)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {/* Avatar */}
          <div className="w-8 h-8 rounded-xl flex items-center justify-center cursor-pointer" style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}>
            <span style={{ fontSize: "14px" }}>🧑</span>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto" style={{ background: "var(--l-bg)" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
