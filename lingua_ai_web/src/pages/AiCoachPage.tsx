import React, { useState, useRef, useEffect } from 'react';
import { aiCoachApi } from '../services/aiCoachApi';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { Bot, Send, User, Sparkles } from 'lucide-react';
import './AiCoach.css';

interface LocalMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  correction?: string;
}

export const AiCoachPage: React.FC = () => {
  const { user } = useAuth();
  const { language } = useLanguage();
  const [messages, setMessages] = useState<LocalMessage[]>([
    {
      id: 'welcome',
      sender: 'ai',
      text: language === 'tr' ? 'Merhaba! Ben senin İngilizce Koçunum. Pratik yapmaya başlayalım mı?' : 'Hello! I am your English Coach. Shall we start practicing?'
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage: LocalMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text: input.trim()
    };
    
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await aiCoachApi.chat({
        userId: user?.id || 'guest',
        message: userMessage.text,
        language: language
      });

      if (response.correction && response.correction.toLowerCase() !== userMessage.text.toLowerCase()) {
        setMessages(prev => prev.map(msg => 
          msg.id === userMessage.id ? { ...msg, correction: response.correction } : msg
        ));
      }

      const aiMessage: LocalMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        text: response.reply
      };
      
      setMessages(prev => [...prev, aiMessage]);
    } catch (error) {
      console.error("AI Coach Chat Error:", error);
      const errorMessage: LocalMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        text: 'Sorry, I am having trouble connecting to my servers right now. Please try again later.'
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ai-coach-page animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">AI Coach</h1>
        <p className="page-subtitle">Practice conversational English. I'll correct your mistakes!</p>
      </div>

      <div className="chat-container glass-panel">
        <div className="chat-messages">
          {messages.map((msg) => (
            <div key={msg.id} className={`message-wrapper ${msg.sender}`}>
              <div className="message-avatar">
                {msg.sender === 'ai' ? <Bot size={20} /> : <User size={20} />}
              </div>
              <div className="message-content">
                <div className="message-bubble">
                  {msg.text}
                </div>
                {msg.correction && (
                  <div className="message-correction animate-fade-in">
                    <Sparkles size={14} className="correction-icon" />
                    <span><strong>Better:</strong> {msg.correction}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="message-wrapper ai animate-fade-in">
              <div className="message-avatar">
                <Bot size={20} />
              </div>
              <div className="message-content">
                <div className="message-bubble typing-indicator">
                  <span></span><span></span><span></span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form className="chat-input-area" onSubmit={handleSend}>
          <input
            type="text"
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message in English or Turkish..."
            disabled={loading}
          />
          <button type="submit" className="primary icon-btn send-btn" disabled={!input.trim() || loading}>
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  );
};
