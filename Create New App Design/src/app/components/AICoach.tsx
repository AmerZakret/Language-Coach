import { useState, useRef, useEffect } from "react";
import { Send, Bot, Trash2, Sparkles } from "lucide-react";

interface Message {
  id: number;
  role: "user" | "ai";
  content: string;
  time: string;
}

const STARTER_PROMPTS = [
  { emoji: "🍽️", text: "Let's practice ordering food at a restaurant" },
  { emoji: "📖", text: "Explain the German past tense (Perfekt)" },
  { emoji: "💬", text: "How do I introduce myself formally?" },
  { emoji: "🛒", text: "Help me practice shopping phrases" },
];

const AI_RESPONSES: Record<string, string> = {
  "Let's practice ordering food at a restaurant": "Natürlich! Let's practice. You walk into a German restaurant and the waiter says: 'Guten Abend! Was möchten Sie bestellen?' (Good evening! What would you like to order?) — how do you respond?",
  "Explain the German past tense (Perfekt)": "The German Perfekt (present perfect) is the most common way to express past events in spoken German. It's formed with a helping verb (haben or sein) + the past participle.\n\nExample:\n• Ich habe gegessen. (I have eaten / I ate.)\n• Er ist gegangen. (He has gone / He went.)\n\nUse haben for most verbs, and sein for movement or change-of-state verbs. Want to practice some examples?",
  "How do I introduce myself formally?": "Great question! A formal self-introduction in German:\n\nGuten Tag, mein Name ist [Name]. (Good day, my name is [Name].)\nIch komme aus [Stadt/Land]. (I come from [City/Country].)\nIch bin [Beruf]. (I am a [profession].)\n\nFor example: Guten Tag, mein Name ist Maria. Ich komme aus Berlin. Ich bin Ärztin. Want to try introducing yourself?",
  "Help me practice shopping phrases": "Perfect! Here are essential shopping phrases:\n\n• Wie viel kostet das? — How much does this cost?\n• Haben Sie das in einer anderen Größe? — Do you have this in another size?\n• Ich nehme es. — I'll take it.\n• Kann ich mit Karte zahlen? — Can I pay by card?\n\nShall we do a roleplay where you're buying something at a German shop? 🛍️",
};

let msgId = 3;

export function AICoach() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, isTyping]);

  const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const sendMessage = (content: string) => {
    if (!content.trim()) return;
    const userMsg: Message = { id: msgId++, role: "user", content, time: now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);
    setTimeout(() => {
      const response = AI_RESPONSES[content] || "Das ist eine gute Frage! (That's a great question!) Let me help you with that. In German, every sentence needs a verb, and the verb usually goes in the second position. Can you try forming a simple sentence for me?";
      const aiMsg: Message = { id: msgId++, role: "ai", content: response, time: now() };
      setMessages((prev) => [...prev, aiMsg]);
      setIsTyping(false);
    }, 1200);
  };

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--l-bg)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--l-border-subtle)" }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)", boxShadow: "0 0 20px rgba(99,102,241,0.3)" }}>
            <Bot size={18} color="white" />
          </div>
          <div>
            <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--l-text)" }}>AI Language Coach</h2>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#10B981" }} />
              <span style={{ fontSize: "11px", color: "var(--l-muted)" }}>Practicing German</span>
            </div>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
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
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-20 h-20 rounded-full flex items-center justify-center mb-4" style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}>
              <Bot size={36} color="#6366F1" />
            </div>
            <h3 style={{ fontSize: "18px", fontWeight: 700, color: "var(--l-text)", marginBottom: "8px" }}>Hallo! Ich bin dein AI Coach</h3>
            <p style={{ fontSize: "14px", color: "var(--l-muted)", marginBottom: "32px", maxWidth: "320px" }}>
              I'm here to help you practice German through conversation. Pick a topic or type a message!
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-md">
              {STARTER_PROMPTS.map((p) => (
                <button
                  key={p.text}
                  onClick={() => sendMessage(p.text)}
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
            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                {msg.role === "ai" && (
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}>
                    <Bot size={14} color="white" />
                  </div>
                )}
                <div className="max-w-[75%]">
                  <div className="px-4 py-3 rounded-2xl" style={{ background: msg.role === "user" ? "linear-gradient(135deg, #6366F1, #8B5CF6)" : "var(--l-surface)", border: msg.role === "ai" ? "1px solid var(--l-border)" : "none", color: msg.role === "user" ? "white" : "var(--l-text)", fontSize: "14px", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                    {msg.content}
                  </div>
                  <div style={{ fontSize: "10px", color: "var(--l-subtle)", marginTop: "4px", textAlign: msg.role === "user" ? "right" : "left" }}>{msg.time}</div>
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}>
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
      <div className="px-6 py-4" style={{ borderTop: "1px solid var(--l-border-subtle)" }}>
        <div className="flex items-end gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
            placeholder="Type in German or ask about grammar..."
            className="flex-1 px-4 py-3 rounded-xl outline-none transition-all"
            style={{ background: "var(--l-input-bg)", border: "1px solid var(--l-border)", color: "var(--l-text)", fontSize: "14px" }}
            onFocus={(e) => { e.target.style.borderColor = "rgba(99,102,241,0.4)"; }}
            onBlur={(e) => { e.target.style.borderColor = "var(--l-border)"; }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim()}
            className="w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-200 shrink-0"
            style={{ background: input.trim() ? "linear-gradient(135deg, #6366F1, #8B5CF6)" : "var(--l-card-hover)", color: input.trim() ? "white" : "var(--l-subtle)", boxShadow: input.trim() ? "0 4px 16px rgba(99,102,241,0.4)" : "none", border: input.trim() ? "none" : "1px solid var(--l-border)" }}
          >
            <Send size={16} />
          </button>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <Sparkles size={12} color="var(--l-subtle)" />
          <span style={{ fontSize: "11px", color: "var(--l-subtle)" }}>AI-powered German language coach</span>
        </div>
      </div>

      <style>{`@keyframes bounce { 0%, 80%, 100% { transform: translateY(0); opacity: 0.5; } 40% { transform: translateY(-6px); opacity: 1; } }`}</style>
    </div>
  );
}
