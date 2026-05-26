import { useState, useRef, useEffect } from "react";
import { Send, Bot, Trash2, Sparkles, User } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { useTargetLanguage } from "../context/TargetLanguageContext";
import { sendMessage, getChatHistory, clearChatHistory, type ChatMessage } from "../api/aiCoachApi";

const STARTER_PROMPTS = [
  { emoji: "🍽️", text: "Let's practice ordering food at a restaurant" },
  { emoji: "📖", text: "Explain the German past tense (Perfekt)" },
  { emoji: "💬", text: "How do I introduce myself formally?" },
  { emoji: "🛒", text: "Help me practice shopping phrases" },
];

export function AiCoachPage() {
  const { user, isGuest } = useAuth();
  const { language, t } = useLanguage();
  const { targetLanguage } = useTargetLanguage();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  const userId = user?.id || user?.email || (isGuest ? 'guest' : 'unknown');

  useEffect(() => {
    const loadHistory = async () => {
      setHistoryLoading(true);
      try {
        const history = await getChatHistory(userId, targetLanguage);
        setMessages(history);
      } catch (e) {
        console.error('Failed to load chat history', e);
      } finally {
        setHistoryLoading(false);
      }
    };
    loadHistory();
  }, [userId, targetLanguage]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, isTyping, historyLoading]);

  const handleSend = async (content: string) => {
    if (!content.trim() || isTyping) return;
    
    const userMsg: ChatMessage = { role: "user", message: content, createdAt: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    try {
      const response = await sendMessage({
        userId,
        message: content,
        language: language,
        targetLanguage: targetLanguage
      });

      const aiMsg: ChatMessage = { role: "assistant", message: response.reply, createdAt: new Date().toISOString() };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (e) {
      console.error('AI Coach error', e);
      setMessages((prev) => [...prev, { 
        role: 'assistant', 
        message: "Something went wrong. Please try again.",
        createdAt: new Date().toISOString()
      }]);
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
    if (window.confirm('Are you sure you want to clear the chat history?')) {
      setHistoryLoading(true);
      try {
        await clearChatHistory(userId, targetLanguage);
        setMessages([]);
      } catch (e) {
        console.error('Failed to clear chat history', e);
      } finally {
        setHistoryLoading(false);
      }
    }
  };

  return (
    <div className="flex flex-col h-full animate-fade-in" style={{ background: "var(--l-bg)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: "1px solid var(--l-border-subtle)" }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)", boxShadow: "0 0 20px rgba(99,102,241,0.3)" }}>
            <Bot size={18} color="white" />
          </div>
          <div>
            <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--l-text)" }}>{t('ai_coach')}</h2>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#10B981" }} />
              <span style={{ fontSize: "11px", color: "var(--l-muted)" }}>Practicing {targetLanguage}</span>
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
            <Trash2 size={13} />Clear Chat
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {historyLoading ? (
          <div className="flex items-center justify-center h-full">
            <span style={{ color: "var(--l-text)" }}>Loading...</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-20 h-20 rounded-full flex items-center justify-center mb-4" style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}>
              <Bot size={36} color="#6366F1" />
            </div>
            <h3 style={{ fontSize: "18px", fontWeight: 700, color: "var(--l-text)", marginBottom: "8px" }}>Hallo! Ich bin dein AI Coach</h3>
            <p style={{ fontSize: "14px", color: "var(--l-muted)", marginBottom: "32px", maxWidth: "320px" }}>
              I'm here to help you practice {targetLanguage} through conversation. Pick a topic or type a message!
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-md">
              {STARTER_PROMPTS.map((p) => (
                <button
                  key={p.text}
                  onClick={() => handleSend(p.text)}
                  className="flex items-start gap-3 p-4 rounded-2xl text-left transition-all duration-200"
                  style={{ background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(99,102,241,0.12)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(99,102,241,0.3)"; (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-2px)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(99,102,241,0.06)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(99,102,241,0.15)"; (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)"; }}
                >
                  <span style={{ fontSize: "20px" }}>{p.emoji}</span>
                  <span style={{ fontSize: "13px", color: "var(--l-text2)", lineHeight: 1.4 }}>{p.text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 animate-slide-in ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: msg.role === "assistant" ? "linear-gradient(135deg, #6366F1, #8B5CF6)" : "var(--l-surface)" }}>
                  {msg.role === "assistant" ? <Bot size={14} color="white" /> : <User size={14} color="var(--l-text)" />}
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
                  <Bot size={14} color="white" />
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
            className="flex-1 px-4 py-3 rounded-xl outline-none transition-all"
            style={{ background: "var(--l-input-bg)", border: "1px solid var(--l-border)", color: "var(--l-text)", fontSize: "14px" }}
            onFocus={(e) => { e.target.style.borderColor = "rgba(99,102,241,0.4)"; }}
            onBlur={(e) => { e.target.style.borderColor = "var(--l-border)"; }}
          />
          <button
            type="submit"
            disabled={!input.trim() || isTyping || historyLoading}
            className="w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-200 shrink-0"
            style={{ background: input.trim() && !isTyping ? "linear-gradient(135deg, #6366F1, #8B5CF6)" : "var(--l-card-hover)", color: input.trim() && !isTyping ? "white" : "var(--l-subtle)", boxShadow: input.trim() && !isTyping ? "0 4px 16px rgba(99,102,241,0.4)" : "none", border: input.trim() && !isTyping ? "none" : "1px solid var(--l-border)" }}
          >
            <Send size={16} />
          </button>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <Sparkles size={12} color="var(--l-subtle)" />
          <span style={{ fontSize: "11px", color: "var(--l-subtle)" }}>AI-powered language coach</span>
        </div>
      </form>

      <style>{`@keyframes bounce { 0%, 80%, 100% { transform: translateY(0); opacity: 0.5; } 40% { transform: translateY(-6px); opacity: 1; } }`}</style>
    </div>
  );
}
