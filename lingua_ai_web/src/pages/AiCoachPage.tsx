import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useTargetLanguage } from '../context/TargetLanguageContext';
import { sendMessage, getChatHistory, clearChatHistory, type ChatMessage } from '../api/aiCoachApi';
import { Button } from '../components/common/Button';
import { Send, User, Trash2, Globe } from 'lucide-react';
import './AiCoach.css';

const aiCoachIcon = '/assets/images/ai-coach-icon.png';

export const AiCoachPage: React.FC = () => {
  const { user, isGuest } = useAuth();
  const { language, t } = useLanguage();
  const { targetLanguage } = useTargetLanguage();
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const userId = user?.email || (isGuest ? 'guest' : 'unknown');

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

  // Load chat history
  useEffect(() => {
    loadHistory();
  }, [userId, targetLanguage]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    
    // Optimistic update
    const newMessage: ChatMessage = { 
      role: 'user', 
      message: userMessage,
      createdAt: new Date().toISOString()
    };
    setMessages(prev => [...prev, newMessage]);
    setLoading(true);

    try {
      const response = await sendMessage({
        userId,
        message: userMessage,
        language: language,
        targetLanguage: targetLanguage
      });

      const assistantMessage: ChatMessage = { 
        role: 'assistant', 
        message: response.reply,
        createdAt: new Date().toISOString()
      };
      
      setMessages(prev => [...prev, assistantMessage]);
    } catch (e) {
      console.error('AI Coach error', e);
      // Requirement 8: Show UI error message, but not as AI message bubble if possible
      // But for chat flow, it's common to show it as a system or AI message with error style
      // I'll use a specific error toast or just a red AI message for now
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        message: language === 'tr' 
          ? "Üzgünüm, şu an bağlantı kuramıyorum. Lütfen tekrar deneyin."
          : "Something went wrong. Please try again.",
        createdAt: new Date().toISOString()
      }]);
    } finally {
      setLoading(false);
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
    if (window.confirm(language === 'tr' ? 'Sohbet geçmişini silmek istediğinize emin misiniz?' : 'Are you sure you want to clear the chat history?')) {
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
    <div className="ai-coach-page animate-fade-in">
      <div className="page-header chat-header-main">
        <div className="header-left">
          <h1 className="page-title">{t('ai_coach')}</h1>
          <div className="practicing-badge">
            <Globe size={14} />
            <span>{t('practicing')}: <strong>{targetLanguage}</strong></span>
          </div>
        </div>
        <div className="header-actions">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleClearChat} 
            disabled={historyLoading}
            leftIcon={<Trash2 size={16} />}
          >
            {language === 'tr' ? 'Sohbeti Temizle' : 'Clear Chat'}
          </Button>
        </div>
      </div>

      <div className="chat-wrapper-centered">
        <div className="chat-container glass-panel">
          <div className="messages-list">
            {historyLoading ? (
              <div className="history-loading">
                <div className="spinner"></div>
              </div>
            ) : messages.length === 0 ? (
              <div className="empty-chat animate-fade-in">
                <div className="empty-icon-wrapper custom-icon-bg">
                  <img src={aiCoachIcon} alt="AI Coach" className="empty-icon-custom" />
                </div>
                <h3>{language === 'tr' ? 'AI Koç ile pratik yapmaya başla!' : 'Start practicing with AI Coach!'}</h3>
                <p>{t('start_conversation')}</p>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i} className={`message-wrapper ${msg.role} animate-slide-in`}>
                  <div className="message-avatar">
                    {msg.role === 'user' ? <User size={20} /> : <img src={aiCoachIcon} alt="" className="message-icon-custom" />}
                  </div>
                  <div className="message-bubble-group">
                    <div className="message-bubble">
                      <div className="message-content">{msg.message}</div>
                    </div>
                    <span className="message-time">{formatTime(msg.createdAt)}</span>
                  </div>
                </div>
              ))
            )}
            {loading && (
              <div className="message-wrapper assistant animate-slide-in">
                <div className="message-avatar">
                  <img src={aiCoachIcon} alt="" className="message-icon-custom" />
                </div>
                <div className="message-bubble loading">
                  <div className="typing-indicator">
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
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`${t('type_message')}...`}
              disabled={loading || historyLoading}
              autoFocus
            />
            <Button type="submit" disabled={!input.trim() || loading || historyLoading} variant="primary">
              <Send size={20} />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};
