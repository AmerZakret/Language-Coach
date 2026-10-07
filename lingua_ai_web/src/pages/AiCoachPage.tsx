import { useState, useRef, useEffect } from "react";
import { Send, Trash2, Sparkles, User, Utensils, BookOpen, MessageSquare, ShoppingCart, WifiOff } from "lucide-react";
import aiCoachImg from "../assets/images/ai-coach-icon.png";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { useTargetLanguage } from "../context/TargetLanguageContext";
import { useSessionGuard } from "../utils/useSessionGuard";
import { getUserProgressKey } from "../utils/userKey";
import { useNetwork } from "../context/NetworkContext";
import { sendMessage, getChatHistory, clearChatHistory, type ChatMessage } from "../api/aiCoachApi";

const STARTER_PROMPTS = [
  { Icon: Utensils, key: "prompt_restaurant" },
  { Icon: BookOpen, key: "prompt_grammar" },
  { Icon: MessageSquare, key: "prompt_introduce" },
  { Icon: ShoppingCart, key: "prompt_shopping" },
];

export function AiCoachPage() {
  const { user, isGuest, token } = useAuth();
  const { language, t } = useLanguage();
  const { targetLanguage } = useTargetLanguage();
  const { isOffline } = useNetwork();
  const captureSession = useSessionGuard(getUserProgressKey(user, isGuest, token), targetLanguage);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const isSessionCurrent = captureSession();
    let cancelled = false;
    const isCurrent = () => !cancelled && isSessionCurrent();
    setMessages(prev => isCurrent() ? [] : prev);
    if (isOffline || !token) {
      setHistoryLoading(false);
      return () => { cancelled = true; };
    }
    const loadHistory = async () => {
      setHistoryLoading(true);
      try {
        const history = await getChatHistory(targetLanguage);
        if (!isCurrent()) return;
        setMessages(prev => isCurrent() ? history : prev);
      } catch (e) {
        if (isCurrent()) console.error('Failed to load chat history', e);
      } finally {
        if (isCurrent()) setHistoryLoading(prev => isCurrent() ? false : prev);
      }
    };
    loadHistory();
    return () => { cancelled = true; };
  }, [captureSession, targetLanguage, isOffline, token]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, isTyping, historyLoading]);

  const handleSend = async (content: string) => {
    if (!content.trim() || isTyping) return;
    
    const userMsg: ChatMessage = { role: "user", message: content, createdAt: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    try {
      const response = await sendMessage({
        message: content,
        language: language,
        targetLanguage: targetLanguage
      });

      setMessages((prev) => {
        const filtered = prev.slice(0, -1);
        const actualUserMsg = response.userMessage || userMsg;
        const actualAssistantMsg = response.assistantMessage || {
          role: "assistant",
          message: response.reply,
          createdAt: new Date().toISOString()
        };
        return [...filtered, actualUserMsg, actualAssistantMsg];
      });
    } catch (e: any) {
      console.error('AI Coach error', e);
      setMessages((prev) => prev.slice(0, -1));
      const errMsg = e.response?.data?.message || t("something_wrong");
      alert(errMsg);
    } finally {
      setIsTyping(false);
    }
  };

  const formatTime = (dateString?: string) => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const handleClearChat = async () => {
    if (window.confirm(t("clear_chat_confirm"))) {
      setHistoryLoading(true);
      try {
        await clearChatHistory(targetLanguage);
        setMessages([]);
      } catch (e) {
        console.error('Failed to clear chat history', e);
      } finally {
        setHistoryLoading(false);
      }
    }
  };

  if (isOffline) {
    return (
      <div className="flex flex-col items-center justify-center text-center p-8 border rounded-2xl h-[450px]" style={{ background: "var(--l-surface)", borderColor: "var(--l-border)", color: "var(--l-text)" }}>
        <WifiOff size={48} className="text-amber-500 mb-4 animate-bounce" />
        <h2 style={{ fontSize: "20px", fontWeight: 800 }}>{t("offline_only_title")}</h2>
        <p style={{ fontSize: "14px", color: "var(--l-muted)", marginTop: "8px", maxWidth: "340px" }}>{t("offline_only_desc")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full animate-fade-in" style={{ background: "var(--l-bg)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: "1px solid var(--l-border-subtle)" }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)", boxShadow: "0 0 20px rgba(99,102,241,0.3)" }}>
            <img src={aiCoachImg} alt="AI Coach" style={{ width: "22px", height: "22px", objectFit: "contain", filter: "brightness(0) invert(1)" }} />
          </div>
          <div>
            <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--l-text)" }}>{t('ai_coach')}</h2>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#10B981" }} />
              <span style={{ fontSize: "11px", color: "var(--l-muted)" }}>{t("practicing_lang").replace("{lang}", t('lang_' + targetLanguage.toLowerCase()))}</span>
            </div>
          </div>
        </div>
        {messages.length > 0 && !historyLoading && (
          <button
            onClick={handleClearChat}
            disabled={historyLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all"
            style={{ background: "var(--l-card-hover)", border: "1px solid var(--l-border)", color: "var(--l-muted)", fontSize: "12px" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#EF4444"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(239,68,68,0.3)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--l-muted)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--l-border)"; }}
          >
            <Trash2 size={13} />{t("clear_chat")}
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {historyLoading ? (
          <div className="flex items-center justify-center h-full">
            <span style={{ color: "var(--l-text)" }}>{t("loading")}</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-20 h-20 rounded-full flex items-center justify-center mb-4" style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}>
              <img src={aiCoachImg} alt="AI Coach" style={{ width: "48px", height: "48px", objectFit: "contain" }} />
            </div>
            <h3 style={{ fontSize: "18px", fontWeight: 700, color: "var(--l-text)", marginBottom: "8px" }}>{t("ai_coach_welcome")}</h3>
            <p style={{ fontSize: "14px", color: "var(--l-muted)", marginBottom: "32px", maxWidth: "320px" }}>
              {t("ai_coach_welcome_desc").replace("{lang}", t('lang_' + targetLanguage.toLowerCase()))}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-md">
              {STARTER_PROMPTS.map((p) => {
                const promptText = p.key === "prompt_grammar"
                  ? t("prompt_grammar").replace("{lang}", t('lang_' + targetLanguage.toLowerCase()))
                  : t(p.key);
                return (
                  <button
                    key={p.key}
                    onClick={() => handleSend(promptText)}
                    className="flex items-start gap-3 p-4 rounded-2xl text-left transition-all duration-200"
                    style={{ background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(99,102,241,0.12)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(99,102,241,0.3)"; (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-2px)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(99,102,241,0.06)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(99,102,241,0.15)"; (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)"; }}
                  >
                    <div style={{ width: "28px", height: "28px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "8px", background: "rgba(99,102,241,0.12)", flexShrink: 0 }}>
                      <p.Icon size={14} color="#6366F1" />
                    </div>
                    <span style={{ fontSize: "13px", color: "var(--l-text2)", lineHeight: 1.4 }}>{promptText}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 animate-slide-in ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: msg.role === "assistant" ? "linear-gradient(135deg, #6366F1, #8B5CF6)" : "var(--l-surface)" }}>
                  {msg.role === "assistant" ? <img src={aiCoachImg} alt="AI" style={{ width: "18px", height: "18px", objectFit: "contain", filter: "brightness(0) invert(1)" }} /> : <User size={14} color="var(--l-text)" />}
                </div>
                <div className="max-w-[75%]">
                  <div className="px-4 py-3 rounded-2xl" style={{ background: msg.role === "user" ? "linear-gradient(135deg, #6366F1, #8B5CF6)" : "var(--l-surface)", border: msg.role === "assistant" ? "1px solid var(--l-border)" : "none", color: msg.role === "user" ? "white" : "var(--l-text)", fontSize: "14px", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                    {msg.message}
                  </div>
                  <div style={{ fontSize: "10px", color: "var(--l-subtle)", marginTop: "4px", textAlign: msg.role === "user" ? "right" : "left" }}>{formatTime(msg.createdAt)}</div>
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex gap-3 animate-slide-in">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}>
                  <img src={aiCoachImg} alt="AI" style={{ width: "18px", height: "18px", objectFit: "contain", filter: "brightness(0) invert(1)" }} />
                </div>
                <div className="px-4 py-3 rounded-2xl flex items-center gap-1.5" style={{ background: "var(--l-surface)", border: "1px solid var(--l-border)" }}>
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: "#6366F1", animation: `bounce 1.2s ${i * 0.2}s infinite` }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={endRef} />
          </>
        )}
      </div>

      {/* Input */}
      <form onSubmit={(e) => { e.preventDefault(); handleSend(input); }} className="px-6 py-4 shrink-0" style={{ borderTop: "1px solid var(--l-border-subtle)" }}>
        <div className="flex items-end gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isTyping || historyLoading}
            placeholder={`${t('type_message')}...`}
            className="form-input"
          />
          <button
            type="submit"
            disabled={!input.trim() || isTyping || historyLoading}
            className="w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-200 shrink-0 cursor-pointer"
            style={{ 
              background: input.trim() && !isTyping ? "linear-gradient(135deg, #6366F1, #8B5CF6)" : "var(--l-surface3)", 
              color: input.trim() && !isTyping ? "white" : "var(--l-subtle)", 
              boxShadow: input.trim() && !isTyping ? "0 4px 12px rgba(99,102,241,0.3)" : "none", 
              border: input.trim() && !isTyping ? "none" : "1px solid var(--l-border)" 
            }}
          >
            <Send size={16} />
          </button>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <Sparkles size={12} color="var(--l-subtle)" />
          <span style={{ fontSize: "11px", color: "var(--l-subtle)" }}>{t("ai_powered_coach")}</span>
        </div>
      </form>

      <style>{`@keyframes bounce { 0%, 80%, 100% { transform: translateY(0); opacity: 0.5; } 40% { transform: translateY(-6px); opacity: 1; } }`}</style>
    </div>
  );
}
