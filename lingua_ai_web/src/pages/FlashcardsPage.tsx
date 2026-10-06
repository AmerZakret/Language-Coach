import { useState, useEffect } from "react";
import { ArrowLeft, ArrowRight, Plus, Edit2, Trash2, BookOpen, GraduationCap, X, Calendar, MessageSquare, AlertCircle, Volume2, Star, Play, Pause, Shuffle, Maximize2, Lightbulb } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useLanguage } from "../context/LanguageContext";
import { useTargetLanguage } from "../context/TargetLanguageContext";
import apiClient from "../api/apiClient";
import { useSync } from "../context/SyncContext";
import { useNetwork } from "../context/NetworkContext";
import { pushToOfflineQueue, isPendingBackendCard } from "../utils/offlineQueue";
import { getUserProgressKey } from "../utils/userKey";
import { useSessionGuard } from "../utils/useSessionGuard";
import { getSessionRequestConfig } from "../utils/queueSession";

interface CardData {
  _id: string;
  userId: string;
  targetWord: string;
  turkishTranslation: string;
  exampleSentence?: string;
  note?: string;
  interval: number;
  easinessFactor: number;
  nextReviewDate: string;
  reviewCount: number;
  aiContext?: {
    sentences: string[];
    mnemonic: string;
  };
}

const SCORE_KEYS = ["forgot", "hard", "okay", "easy", "very_easy", "perfect"];

const LANGUAGE_CODES: Record<string, string> = {
  English: 'en',
  German: 'de',
  Spanish: 'es',
  French: 'fr',
  Arabic: 'ar',
  Turkish: 'tr',
};

const LANGUAGE_VOICES: Record<string, string> = {
  en: 'en-US',
  de: 'de-DE',
  es: 'es-ES',
  fr: 'fr-FR',
  ar: 'ar-SA',
  tr: 'tr-TR',
};

export function FlashcardsPage() {
  const { user, isGuest, token } = useAuth();
  const queueOwner = getUserProgressKey(user, isGuest, token);
  const localOnly = queueOwner === 'local_guest';
  const { isDark } = useTheme();
  const { t } = useLanguage();
  const { targetLanguage } = useTargetLanguage();
  const captureContext = useSessionGuard(queueOwner, targetLanguage);
  const userId = user?.id || user?.email || (isGuest ? 'guest@lingua.ai' : 'unknown');
  const { isOffline } = useNetwork();

  const { syncRevision, lastDrainSucceeded } = useSync();
  useEffect(() => {
    if (!isOffline && syncRevision > 0 && lastDrainSucceeded) void fetchCards();
  }, [isOffline, syncRevision, lastDrainSucceeded, captureContext]);

  // View & Modal states
  const [view, setView] = useState<"list" | "study">("list");
  const [modal, setModal] = useState<null | "add" | "edit">(null);
  const [selectedCard, setSelectedCard] = useState<CardData | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [flippedListCards, setFlippedListCards] = useState<Record<string, boolean>>({});

  const toggleListCardFlip = (cardId: string) => {
    setFlippedListCards((prev) => ({
      ...prev,
      [cardId]: !prev[cardId],
    }));
  };

  // Data states
  const [allCards, setAllCards] = useState<CardData[]>([]);
  const [dueCards, setDueCards] = useState<CardData[]>([]);
  const [originalDueCards, setOriginalDueCards] = useState<CardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    targetWord: "",
    turkishTranslation: "",
    exampleSentence: "",
    note: "",
  });

  // Study states
  const [currentStudyIndex, setCurrentStudyIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [studyFinished, setStudyFinished] = useState(false);
  const [studyResults, setStudyResults] = useState<number[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isShuffled, setIsShuffled] = useState(false);
  const [starredCards, setStarredCards] = useState<Record<string, boolean>>({});
  const [hintVisible, setHintVisible] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    setAllCards([]);
    setDueCards([]);
    setOriginalDueCards([]);
    setModal(null);
    setSelectedCard(null);
    setDeleteConfirmId(null);
    setSuccessMsg(null);
    setIsPlaying(false);
    setView('list');
    setStudyResults([]);
    fetchCards();
  }, [user, targetLanguage, captureContext]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // Slideshow automatic player
  useEffect(() => {
    let timer: any;
    if (isPlaying && view === "study" && !studyFinished) {
      timer = setInterval(() => {
        if (!flipped) {
          setFlipped(true);
        } else {
          // Record automatic default pass (score 4)
          handleStudyScore(4, false);
        }
      }, 4000);
    }
    return () => clearInterval(timer);
  }, [isPlaying, flipped, currentStudyIndex, dueCards, view, studyFinished]);

  const fetchCards = async () => {
    const isCurrent = captureContext();
    if (!isCurrent()) return;
    const requestConfig = getSessionRequestConfig();
    setLoading(true);
    setError(null);
    try {
      if (localOnly) {
        const cachedAll = localStorage.getItem(`flashcards_all_${userId}_${targetLanguage}`);
        const cachedDue = localStorage.getItem(`flashcards_due_${userId}_${targetLanguage}`);
        if (cachedAll) setAllCards(JSON.parse(cachedAll));
        if (cachedDue) {
          const cards = JSON.parse(cachedDue);
          setDueCards(cards);
          setOriginalDueCards(cards);
        }
        return;
      }
      const allRes = await apiClient.get(`/flashcards/all?userId=${userId}&targetLanguage=${targetLanguage}`, requestConfig);
      if (!isCurrent()) return;
      setAllCards(allRes.data);

      const dueRes = await apiClient.get(`/flashcards/due?userId=${userId}&targetLanguage=${targetLanguage}`, requestConfig);
      if (!isCurrent()) return;
      setDueCards(dueRes.data);
      setOriginalDueCards(dueRes.data);

      localStorage.setItem(`flashcards_all_${userId}_${targetLanguage}`, JSON.stringify(allRes.data));
      localStorage.setItem(`flashcards_due_${userId}_${targetLanguage}`, JSON.stringify(dueRes.data));
    } catch (e) {
      if (!isCurrent()) return;
      console.error("Failed to fetch cards from server, loading cached.", e);
      const cachedAll = localStorage.getItem(`flashcards_all_${userId}_${targetLanguage}`);
      const cachedDue = localStorage.getItem(`flashcards_due_${userId}_${targetLanguage}`);
      if (cachedAll) setAllCards(JSON.parse(cachedAll));
      if (cachedDue) {
        setDueCards(JSON.parse(cachedDue));
        setOriginalDueCards(JSON.parse(cachedDue));
      }
      
      setError(t("offline_data"));
      setTimeout(() => { if (isCurrent()) setError(null); }, 5000);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  const handleOpenAdd = () => {
    setFormData({ targetWord: "", turkishTranslation: "", exampleSentence: "", note: "" });
    setModal("add");
  };

  const handleOpenEdit = (card: CardData) => {
    setSelectedCard(card);
    setFormData({
      targetWord: card.targetWord,
      turkishTranslation: card.turkishTranslation,
      exampleSentence: card.exampleSentence || "",
      note: card.note || "",
    });
    setModal("edit");
  };

  const handleSaveCard = async (e: React.FormEvent) => {
    e.preventDefault();
    const isCurrent = captureContext();
    if (!isCurrent()) return;
    const requestConfig = getSessionRequestConfig();
    if (!formData.targetWord || !formData.turkishTranslation) {
      setError(t("field_required_error"));
      return;
    }

    if (localOnly || isOffline || (modal === 'edit' && selectedCard && isPendingBackendCard(selectedCard._id, queueOwner))) {
      if (modal === "add") {
        const tempId = `local_${Date.now()}`;
        const newCard: CardData = {
          _id: tempId,
          userId,
          targetWord: formData.targetWord,
          turkishTranslation: formData.turkishTranslation,
          exampleSentence: formData.exampleSentence || undefined,
          note: formData.note || undefined,
          interval: 0,
          easinessFactor: 2.5,
          nextReviewDate: new Date().toISOString(),
          reviewCount: 0,
        };
        if (!localOnly) pushToOfflineQueue('create-flashcard', {
          tempId, userId, targetLanguage, ...formData
        }, queueOwner);
        const updatedAll = [newCard, ...allCards];
        setAllCards(updatedAll);
        
        // Compute due state (always due if review count is 0)
        const updatedDue = [newCard, ...dueCards];
        setDueCards(updatedDue);
        setOriginalDueCards([newCard, ...originalDueCards]);
        
        localStorage.setItem(`flashcards_all_${userId}_${targetLanguage}`, JSON.stringify(updatedAll));
        localStorage.setItem(`flashcards_due_${userId}_${targetLanguage}`, JSON.stringify(updatedDue));
        
        showSuccess(t("flashcard_created"));
      } else if (modal === "edit" && selectedCard) {
        if (!localOnly) pushToOfflineQueue('update-flashcard', {
          cardId: selectedCard._id, targetLanguage, ...formData
        }, queueOwner);
        const updatedAll = allCards.map(c => c._id === selectedCard._id ? { ...c, ...formData } : c);
        const updatedDue = dueCards.map(c => c._id === selectedCard._id ? { ...c, ...formData } : c);
        setAllCards(updatedAll);
        setDueCards(updatedDue);
        setOriginalDueCards(originalDueCards.map(c => c._id === selectedCard._id ? { ...c, ...formData } : c));
        
        localStorage.setItem(`flashcards_all_${userId}_${targetLanguage}`, JSON.stringify(updatedAll));
        localStorage.setItem(`flashcards_due_${userId}_${targetLanguage}`, JSON.stringify(updatedDue));
        
        showSuccess(t("flashcard_updated"));
      }
      setModal(null);
      return;
    }

    try {
      if (modal === "add") {
        await apiClient.post("/flashcards", {
          userId,
          targetLanguage,
          ...formData,
        }, requestConfig);
        if (!isCurrent()) return;
        showSuccess(t("flashcard_created"));
      } else if (modal === "edit" && selectedCard) {
        await apiClient.put(`/flashcards/${selectedCard._id}`, {
          ...formData,
          targetLanguage,
        }, requestConfig);
        if (!isCurrent()) return;
        showSuccess(t("flashcard_updated"));
      }
      setModal(null);
      fetchCards();
    } catch (err: any) {
      if (!isCurrent()) return;
      console.error("Failed to save card", err);
      setError(err.response?.data?.message || t("failed_save_card"));
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    const isCurrent = captureContext();
    if (!isCurrent()) return;
    if (localOnly || isOffline || isPendingBackendCard(cardId, queueOwner)) {
      if (!localOnly) pushToOfflineQueue('delete-flashcard', { cardId }, queueOwner);
      const updatedAll = allCards.filter(c => c._id !== cardId);
      const updatedDue = dueCards.filter(c => c._id !== cardId);
      setAllCards(updatedAll);
      setDueCards(updatedDue);
      setOriginalDueCards(originalDueCards.filter(c => c._id !== cardId));
      
      localStorage.setItem(`flashcards_all_${userId}_${targetLanguage}`, JSON.stringify(updatedAll));
      localStorage.setItem(`flashcards_due_${userId}_${targetLanguage}`, JSON.stringify(updatedDue));
      
      showSuccess(t("flashcard_deleted"));
      setDeleteConfirmId(null);
      return;
    }

    try {
      await apiClient.delete(`/flashcards/${cardId}`, getSessionRequestConfig());
      if (!isCurrent()) return;
      showSuccess(t("flashcard_deleted"));
      setDeleteConfirmId(null);
      fetchCards();
    } catch (err: any) {
      if (!isCurrent()) return;
      console.error("Failed to delete card", err);
      setError(t("failed_delete_card"));
    }
  };

  const showSuccess = (msg: string) => {
    const isCurrent = captureContext();
    if (!isCurrent()) return;
    setSuccessMsg(msg);
    setTimeout(() => { if (isCurrent()) setSuccessMsg(null); }, 3000);
  };

  // Study functions
  const startStudy = () => {
    if (dueCards.length === 0) return;
    setCurrentStudyIndex(0);
    setFlipped(false);
    setStudyFinished(false);
    setStudyResults([]);
    setIsPlaying(false);
    setIsShuffled(false);
    setDueCards(originalDueCards);
    setView("study");
  };

  const handleStudyScore = async (score: number, _manual: boolean = true) => {
    const isCurrent = captureContext();
    if (!isCurrent()) return;
    const card = dueCards[currentStudyIndex];
    if (card) {
      if (localOnly || isOffline || isPendingBackendCard(card._id, queueOwner)) {
        if (!localOnly) pushToOfflineQueue('review-flashcard', { cardId: card._id, score }, queueOwner);
        // Local SM-2 calculation
        let easinessFactor = card.easinessFactor || 2.5;
        let interval = card.interval || 0;
        let reviewCount = card.reviewCount || 0;

        if (score >= 3) {
          if (reviewCount === 0) {
            interval = 1;
          } else if (reviewCount === 1) {
            interval = 6;
          } else {
            interval = Math.round(interval * easinessFactor);
          }
          reviewCount += 1;
        } else {
          reviewCount = 0;
          interval = 1;
        }
        
        easinessFactor = easinessFactor + (0.1 - (5 - score) * (0.08 + (5 - score) * 0.02));
        if (easinessFactor < 1.3) easinessFactor = 1.3;

        const nextReviewDate = new Date(Date.now() + interval * 24 * 60 * 60 * 1000).toISOString();
        
        const updatedCard = {
          ...card,
          easinessFactor,
          interval,
          reviewCount,
          nextReviewDate,
        };

        const updatedAll = allCards.map(c => c._id === card._id ? updatedCard : c);
        setAllCards(updatedAll);
        localStorage.setItem(`flashcards_all_${userId}_${targetLanguage}`, JSON.stringify(updatedAll));

      } else {
        try {
          await apiClient.put(`/flashcards/${card._id}/review`, { score }, getSessionRequestConfig());
        } catch (e) {
          console.error("Failed to save review to backend", e);
        }
      }
    }

    if (!isCurrent()) return;
    setStudyResults((prev) => [...prev, score]);
    if (currentStudyIndex + 1 >= dueCards.length) {
      setStudyFinished(true);
      setIsPlaying(false);
    } else {
      setCurrentStudyIndex((prev) => prev + 1);
      setFlipped(false);
      setHintVisible(false);
    }
  };

  const speakWord = (text: string, langKey?: string, e?: React.MouseEvent) => {
    const isCurrent = captureContext();
    if (e) e.stopPropagation();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const shortCode = LANGUAGE_CODES[targetLanguage] || 'en';
      const voiceLocale = langKey === 'tr' ? 'tr-TR' : (LANGUAGE_VOICES[shortCode] || 'en-US');
      utterance.lang = voiceLocale;
      window.speechSynthesis.speak(utterance);
    } else {
      setError(t("tts_unsupported"));
      setTimeout(() => { if (isCurrent()) setError(null); }, 3000);
    }
  };

  const toggleStar = (cardId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setStarredCards((prev) => ({
      ...prev,
      [cardId]: !prev[cardId],
    }));
  };

  const toggleShuffle = () => {
    if (isShuffled) {
      setDueCards(originalDueCards);
      setIsShuffled(false);
    } else {
      const shuffled = [...dueCards].sort(() => Math.random() - 0.5);
      setDueCards(shuffled);
      setIsShuffled(true);
    }
    setCurrentStudyIndex(0);
    setFlipped(false);
    setHintVisible(false);
  };

  const toggleFullscreen = () => {
    const isCurrent = captureContext();
    const element = document.getElementById("study-container");
    if (!element) return;
    if (!document.fullscreenElement) {
      element.requestFullscreen().then(() => { if (isCurrent()) setIsFullscreen(true); }).catch(err => {
        console.error("Error entering fullscreen mode", err);
      });
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const handleNextCard = () => {
    if (currentStudyIndex + 1 < dueCards.length) {
      setCurrentStudyIndex((prev) => prev + 1);
      setFlipped(false);
      setHintVisible(false);
    }
  };

  const handlePrevCard = () => {
    if (currentStudyIndex > 0) {
      setCurrentStudyIndex((prev) => prev - 1);
      setFlipped(false);
      setHintVisible(false);
    }
  };

  const getHintText = (card: CardData) => {
    if (card.note) return `${t("note_label")}: ${card.note}`;
    if (card.turkishTranslation) {
      return `${t("starts_with")}: "${card.turkishTranslation.substring(0, 2)}..."`;
    }
    return t("no_hint_available");
  };

  const finishStudy = () => {
    setView("list");
    fetchCards();
  };

  if (loading && allCards.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col" style={{ background: "var(--l-bg)", color: "var(--l-text)" }}>
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="font-semibold">{t("loading_vocab")}</p>
      </div>
    );
  }

  // Calculate study progress percent
  const progressPercent = dueCards.length > 0 ? ((currentStudyIndex) / dueCards.length) * 100 : 0;

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto animate-fade-in" style={{ color: "var(--l-text)" }}>
      
      {/* Notifications */}
      {error && (
        <div className="fixed bottom-6 right-6 p-4 rounded-xl flex items-center gap-2 shadow-lg animate-fade-in z-50" style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", color: "#B91C1C" }}>
          <AlertCircle size={18} />
          <span style={{ fontSize: "13px", fontWeight: 600 }}>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 hover:opacity-70"><X size={14} /></button>
        </div>
      )}
      {successMsg && (
        <div className="fixed bottom-6 right-6 p-4 rounded-xl flex items-center gap-2 shadow-lg animate-fade-in z-50" style={{ background: "#D1FAE5", border: "1px solid #6EE7B7", color: "#065F46" }}>
          <span style={{ fontSize: "13px", fontWeight: 600 }}>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="ml-2 hover:opacity-70"><X size={14} /></button>
        </div>
      )}

      {view === "list" ? (
        <>
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <div>
              <h1 style={{ fontSize: "28px", fontWeight: 800, letterSpacing: "-0.02em" }}>{t("flashcards")}</h1>
              <p style={{ fontSize: "14px", color: "var(--l-muted)", marginTop: "2px" }}>
                {t("flashcards_subtitle")}
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleOpenAdd}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl transition-all duration-200"
                style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)", color: "white", fontSize: "13px", fontWeight: 700, boxShadow: "0 4px 14px rgba(99,102,241,0.3)" }}
              >
                <Plus size={16} /> {t("add_new_card")}
              </button>
              {dueCards.length > 0 && (
                <button
                  onClick={startStudy}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl transition-all duration-200"
                  style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.25)", color: "#10B981", fontSize: "13px", fontWeight: 700 }}
                >
                  <GraduationCap size={16} /> {t("study_due")} ({dueCards.length})
                </button>
              )}
            </div>
          </div>
          {/* Cards Grid */}
          {allCards.length === 0 ? (
            <div className="p-12 rounded-2xl flex flex-col items-center justify-center text-center" style={{ background: "var(--l-surface)", border: "1px solid var(--l-border)" }}>
              <div className="w-12 h-12 rounded-full flex items-center justify-center mb-4" style={{ background: "rgba(99,102,241,0.12)" }}>
                <BookOpen size={22} color="#6366F1" />
              </div>
              <h3 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "6px" }}>{t("no_cards_title")}</h3>
              <p style={{ fontSize: "13px", color: "var(--l-muted)", maxWidth: "320px", marginBottom: "20px" }}>
                {t("no_cards_desc_language")}
              </p>
              <button
                onClick={handleOpenAdd}
                className="px-6 py-2.5 rounded-xl text-white font-bold"
                style={{ background: "#6366F1", fontSize: "13px" }}
              >
                {t("add_first_card")}
              </button>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {allCards.map((card) => {
                const isDue = dueCards.some((d) => d._id === card._id);
                const isFlipped = !!flippedListCards[card._id];
                return (
                  <div
                    key={card._id}
                    onClick={() => toggleListCardFlip(card._id)}
                    className="relative cursor-pointer select-none"
                    style={{ perspective: "1000px", height: "220px" }}
                  >
                    <div
                      className="absolute inset-0 transition-transform duration-500"
                      style={{
                        transformStyle: "preserve-3d",
                        transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
                      }}
                    >
                      {/* FRONT OF LIST CARD */}
                      <div
                        className="absolute inset-0 p-5 rounded-2xl flex flex-col justify-between"
                        style={{
                          backfaceVisibility: "hidden",
                          background: "var(--l-surface)",
                          border: isDue ? "1.5px solid #10B981" : "1px solid var(--l-border)",
                          boxShadow: "0 4px 12px rgba(0,0,0,0.03)",
                        }}
                      >
                        <div className="flex justify-between items-start gap-2 mb-3">
                          <span className="px-2.5 py-0.5 rounded-md font-bold" style={{ fontSize: "10px", background: isDue ? "rgba(16,185,129,0.15)" : "var(--l-surface3)", color: isDue ? "#10B981" : "var(--l-muted)" }}>
                            {isDue ? t("due_now") : t("learning_badge")}
                          </span>
                          <div className="flex gap-2">
                            <button onClick={(e) => { e.stopPropagation(); handleOpenEdit(card); }} className="p-1.5 rounded-lg hover:bg-[var(--l-card-hover)] transition-colors" style={{ color: "var(--l-muted)" }}>
                              <Edit2 size={14} />
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(card._id); }} className="p-1.5 rounded-lg hover:bg-red-50 transition-colors" style={{ color: "#F87171" }}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        <div className="flex-1 flex items-center justify-center">
                          <div style={{ fontSize: "24px", fontWeight: 800, color: "var(--l-text)", textAlign: "center" }}>{card.targetWord}</div>
                        </div>

                        <div className="text-center text-[10px] font-semibold text-[var(--l-muted)] mt-2">
                          {t("click_to_flip")}
                        </div>
                      </div>

                      {/* BACK OF LIST CARD */}
                      <div
                        className="absolute inset-0 p-5 rounded-2xl flex flex-col justify-between"
                        style={{
                          backfaceVisibility: "hidden",
                          transform: "rotateY(180deg)",
                          background: "var(--l-surface)",
                          border: isDue ? "1.5px solid #10B981" : "1px solid var(--l-border)",
                          boxShadow: "0 4px 12px rgba(0,0,0,0.03)",
                        }}
                      >
                        <div className="flex justify-between items-start gap-2 mb-2">
                          <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest">
                            {t("translation_label")}
                          </span>
                          <button
                            onClick={(e) => { e.stopPropagation(); speakWord(card.turkishTranslation, 'tr', e); }}
                            className="p-1.5 rounded-lg hover:bg-[var(--l-card-hover)] transition-colors"
                            style={{ color: "var(--l-muted)" }}
                          >
                            <Volume2 size={14} />
                          </button>
                        </div>

                        <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto max-h-[110px] py-1">
                          <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--l-text)", textAlign: "center" }}>{card.turkishTranslation}</div>
                          {card.exampleSentence && (
                            <div className="mt-2 p-1.5 rounded-lg text-[10px] w-full text-center italic" style={{ background: "var(--l-surface3)", color: "var(--l-text2)" }}>
                              "{card.exampleSentence}"
                            </div>
                          )}
                          {card.note && (
                            <div className="mt-1 text-[10px] flex gap-1 items-center justify-center text-[var(--l-muted)]">
                              <MessageSquare size={10} className="flex-shrink-0" />
                              <span className="truncate max-w-[150px]">{card.note}</span>
                            </div>
                          )}
                        </div>

                        <div className="mt-2 pt-2 flex items-center justify-between border-t" style={{ borderColor: "var(--l-border-subtle)", fontSize: "10px", color: "var(--l-subtle)" }}>
                          <span className="flex items-center gap-1"><Calendar size={10} /> {new Date(card.nextReviewDate).toLocaleDateString()}</span>
                          <span>{t("reviews")} {card.reviewCount || 0}</span>
                        </div>
                      </div>

                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        /* STUDY VIEW (QUIZLET STYLE REDESIGN) */
        <div id="study-container" className={`max-w-3xl mx-auto py-6 px-4 flex flex-col justify-center ${isFullscreen ? 'h-screen w-full flex justify-center flex-col p-12 bg-slate-900 text-white' : ''}`}>
          {studyFinished ? (
            <div className="flex flex-col items-center justify-center p-8 rounded-2xl text-center" style={{ background: "var(--l-surface)", border: "1px solid var(--l-border)", color: "var(--l-text)" }}>
              <div className="w-16 h-16 rounded-full flex items-center justify-center mb-6" style={{ background: "linear-gradient(135deg, #10B981, #06B6D4)", boxShadow: "0 0 40px rgba(16,185,129,0.3)" }}>
                <GraduationCap size={28} color="white" />
              </div>
              <h2 style={{ fontSize: "24px", fontWeight: 800, marginBottom: "8px" }}>{t("great_job")}</h2>
              <p style={{ fontSize: "14px", color: "var(--l-muted)", marginBottom: "24px" }}>
                {t("finished_reviewing")} {dueCards.length} {t("cards_today")}
              </p>
              
              <div className="px-6 py-4 rounded-xl mb-8" style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)" }}>
                <div style={{ fontSize: "30px", fontWeight: 800, color: "#10B981" }}>
                  {studyResults.length > 0 ? (studyResults.reduce((a, b) => a + b, 0) / studyResults.length).toFixed(1) : "5.0"}/5
                </div>
                <div style={{ fontSize: "12px", color: "var(--l-muted)" }}>{t("average_score")}</div>
              </div>

              <button
                onClick={finishStudy}
                className="w-full py-3 rounded-xl text-white font-bold transition-transform hover:scale-102"
                style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}
              >
                {t("back_to_list")}
              </button>
            </div>
          ) : (
            <>
              {/* Study Header Navigation */}
              <div className="flex items-center justify-between mb-4">
                <button onClick={finishStudy} className="flex items-center gap-1.5 text-xs font-bold text-indigo-500 hover:underline">
                  {t("exit_study")}
                </button>
                <div className="text-xs font-bold" style={{ color: "var(--l-muted)" }}>
                  {t("spaced_rep")}
                </div>
              </div>

              {/* Study Card Body */}
              {dueCards[currentStudyIndex] && (
                <div className="flex flex-col items-stretch">
                  
                  {/* Large White Rounded Study Card */}
                  <div
                    onClick={() => setFlipped(!flipped)}
                    className="relative cursor-pointer select-none mb-6 w-full"
                    style={{ perspective: "1200px", height: "380px" }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        transformStyle: "preserve-3d",
                        transition: "transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
                        transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
                      }}
                    >
                      {/* FRONT CARD */}
                      <div
                        className="absolute inset-0 flex flex-col justify-between rounded-3xl p-8"
                        style={{
                          backfaceVisibility: "hidden",
                          background: "var(--l-surface)",
                          border: "1px solid var(--l-border)",
                          boxShadow: isDark ? "none" : "0 10px 30px rgba(0,0,0,0.04)",
                          color: "var(--l-text)",
                        }}
                      >
                        {/* Front Card Header */}
                        <div className="flex justify-between items-center w-full">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setHintVisible(!hintVisible);
                            }}
                            className="flex items-center gap-1 text-sm font-semibold hover:opacity-75"
                            style={{ color: "var(--l-text2)" }}
                          >
                            <Lightbulb size={15} /> {t("get_hint")}
                          </button>
                          
                          <div className="flex items-center gap-4">
                            <button
                              onClick={(e) => speakWord(dueCards[currentStudyIndex].targetWord, 'target', e)}
                              className="p-2 rounded-full hover:bg-[var(--l-card-hover)] transition-colors"
                              style={{ color: "var(--l-text2)" }}
                            >
                              <Volume2 size={18} />
                            </button>
                            <button
                              onClick={(e) => toggleStar(dueCards[currentStudyIndex]._id, e)}
                              className="p-2 rounded-full hover:bg-[var(--l-card-hover)] transition-colors"
                              style={{ color: starredCards[dueCards[currentStudyIndex]._id] ? "#F59E0B" : "#94a3b8" }}
                            >
                              <Star size={18} fill={starredCards[dueCards[currentStudyIndex]._id] ? "#F59E0B" : "transparent"} />
                            </button>
                          </div>
                        </div>

                        {/* Front Card Middle Text */}
                        <div className="flex-1 flex flex-col items-center justify-center">
                          <div className="text-5xl sm:text-6xl font-bold tracking-tight text-center px-4" style={{ fontFamily: "'Outfit', 'Inter', sans-serif" }}>
                            {dueCards[currentStudyIndex].targetWord}
                          </div>
                          {hintVisible && (
                            <div className={`mt-6 text-sm font-medium px-4 py-2 rounded-xl border animate-fade-in ${isDark ? 'bg-amber-500/10 border-amber-500/20 text-amber-200' : 'bg-amber-50 border-amber-100 text-amber-800'}`}>
                              {getHintText(dueCards[currentStudyIndex])}
                            </div>
                          )}
                        </div>

                        {/* Front Card Footer Tip */}
                        <div className="text-center text-xs font-semibold text-[var(--l-muted)]">
                          {t("click_to_flip")}
                        </div>
                      </div>

                      {/* BACK CARD */}
                      <div
                        className="absolute inset-0 flex flex-col justify-between rounded-3xl p-8"
                        style={{
                          backfaceVisibility: "hidden",
                          transform: "rotateY(180deg)",
                          background: "var(--l-surface)",
                          border: "1px solid var(--l-border)",
                          boxShadow: isDark ? "none" : "0 10px 30px rgba(0,0,0,0.04)",
                          color: "var(--l-text)",
                        }}
                      >
                        {/* Back Card Header */}
                        <div className="flex justify-between items-center w-full">
                          <div className="text-xs font-bold text-indigo-500 uppercase tracking-widest">
                            {t("translation_label")}
                          </div>
                          <div className="flex items-center gap-4">
                            <button
                              onClick={(e) => speakWord(dueCards[currentStudyIndex].turkishTranslation, 'tr', e)}
                              className="p-2 rounded-full hover:bg-[var(--l-card-hover)] transition-colors"
                              style={{ color: "var(--l-text2)" }}
                            >
                              <Volume2 size={18} />
                            </button>
                            <button
                              onClick={(e) => toggleStar(dueCards[currentStudyIndex]._id, e)}
                              className="p-2 rounded-full hover:bg-[var(--l-card-hover)] transition-colors"
                              style={{ color: starredCards[dueCards[currentStudyIndex]._id] ? "#F59E0B" : "#94a3b8" }}
                            >
                              <Star size={18} fill={starredCards[dueCards[currentStudyIndex]._id] ? "#F59E0B" : "transparent"} />
                            </button>
                          </div>
                        </div>

                        {/* Back Card Middle Text */}
                        <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto max-h-[220px] py-4">
                          <div className="text-4xl sm:text-5xl font-bold tracking-tight text-center px-4 mb-4">
                            {dueCards[currentStudyIndex].turkishTranslation}
                          </div>
                          
                          {dueCards[currentStudyIndex].exampleSentence && (
                            <div className={`w-full max-w-md p-3 rounded-xl text-left border mb-2 ${isDark ? 'bg-slate-900/40 border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-100 text-slate-700'}`}>
                              <div className="text-[10px] font-bold text-slate-400 uppercase mb-0.5">{t("example_label")}</div>
                              <div className="text-xs italic">"{dueCards[currentStudyIndex].exampleSentence}"</div>
                            </div>
                          )}

                          {dueCards[currentStudyIndex].note && (
                            <div className={`w-full max-w-md p-3 rounded-xl text-left border ${isDark ? 'bg-slate-900/40 border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-100 text-slate-700'}`}>
                              <div className="text-[10px] font-bold text-slate-400 uppercase mb-0.5">{t("note_label")}</div>
                              <div className="text-xs">{dueCards[currentStudyIndex].note}</div>
                            </div>
                          )}
                        </div>

                        {/* Back Card Footer Tip */}
                        <div className="text-center text-xs font-semibold text-[var(--l-muted)]">
                          {t("click_to_flip")}
                        </div>
                      </div>

                    </div>
                  </div>

                  {/* Rating Buttons - Fades in below the card ONLY when card is flipped */}
                  <div className={`transition-all duration-300 overflow-hidden ${flipped ? 'opacity-100 max-h-48 mb-6' : 'opacity-0 max-h-0 pointer-events-none'}`}>
                    <div className="p-4 rounded-2xl bg-[var(--l-surface)] border border-[var(--l-border)] shadow-sm">
                      <div className="text-center text-xs font-bold text-[var(--l-muted)] mb-3 uppercase tracking-wider">{t("how_well_knew_sm2")}</div>
                      <div className="grid grid-cols-6 gap-2">
                        {SCORE_KEYS.map((key, i) => {
                          const colors = isDark ? [
                            { bg: "rgba(239, 68, 68, 0.15)", border: "rgba(239, 68, 68, 0.3)", text: "#F87171" },
                            { bg: "rgba(217, 119, 6, 0.15)", border: "rgba(217, 119, 6, 0.3)", text: "#F59E0B" },
                            { bg: "rgba(202, 138, 4, 0.15)", border: "rgba(202, 138, 4, 0.3)", text: "#FACC15" },
                            { bg: "rgba(16, 185, 129, 0.15)", border: "rgba(16, 185, 129, 0.3)", text: "#34D399" },
                            { bg: "rgba(8, 145, 178, 0.15)", border: "rgba(8, 145, 178, 0.3)", text: "#22D3EE" },
                            { bg: "rgba(79, 70, 229, 0.15)", border: "rgba(79, 70, 229, 0.3)", text: "#818CF8" },
                          ] : [
                            { bg: "#FEF2F2", border: "#FCA5A5", text: "#EF4444" },
                            { bg: "#FFFBEB", border: "#FCD34D", text: "#D97706" },
                            { bg: "#FEFCE8", border: "#FDE047", text: "#CA8A04" },
                            { bg: "#ECFDF5", border: "#6EE7B7", text: "#10B981" },
                            { bg: "#ECFEFF", border: "#67E8F9", text: "#0891B2" },
                            { bg: "#EEF2FF", border: "#A5B4FC", text: "#4F46E5" },
                          ];
                          const c = colors[i];
                          return (
                            <button
                              key={i}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStudyScore(i, true);
                              }}
                              className="flex flex-col items-center py-2.5 rounded-xl border hover:-translate-y-0.5 transition-all duration-200"
                              style={{ background: c.bg, borderColor: c.border }}
                            >
                              <span style={{ fontSize: "16px", fontWeight: 800, color: c.text }}>{i}</span>
                              <span style={{ fontSize: "9px", color: c.text, textAlign: "center", fontWeight: 700, lineHeight: 1.1, marginTop: "2px" }}>{t(key)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Navigation Control Bar */}
                  <div className="flex items-center justify-between px-2 mb-4 w-full">
                    {/* Play/Pause Slideshow Button */}
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={toggleShuffle}
                        className={`p-3 rounded-full transition-all ${isShuffled ? 'bg-indigo-500/15 text-indigo-500' : 'hover:bg-[var(--l-card-hover)] text-[var(--l-muted)]'}`}
                        title={t("shuffle_deck")}
                      >
                        <Shuffle size={18} />
                      </button>
                      <button
                        onClick={() => setIsPlaying(!isPlaying)}
                        className={`p-3 rounded-full transition-all ${isPlaying ? 'bg-indigo-500/15 text-indigo-500' : 'hover:bg-[var(--l-card-hover)] text-[var(--l-muted)]'}`}
                        title={isPlaying ? t("pause_slideshow") : t("play_slideshow")}
                      >
                        {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                      </button>
                    </div>

                    {/* Centered Controls */}
                    <div className="flex items-center gap-6">
                      <button
                        onClick={handlePrevCard}
                        disabled={currentStudyIndex === 0}
                        className="p-3 rounded-full hover:bg-[var(--l-card-hover)] disabled:opacity-30 disabled:pointer-events-none transition-colors text-[var(--l-muted)]"
                      >
                        <ArrowLeft size={20} />
                      </button>
                      
                      <span className="text-sm font-semibold tracking-wide text-[var(--l-text2)]">
                        {currentStudyIndex + 1} / {dueCards.length}
                      </span>

                      <button
                        onClick={handleNextCard}
                        disabled={currentStudyIndex + 1 >= dueCards.length}
                        className="p-3 rounded-full hover:bg-[var(--l-card-hover)] disabled:opacity-30 disabled:pointer-events-none transition-colors text-[var(--l-muted)] border border-[var(--l-border)]"
                      >
                        <ArrowRight size={20} />
                      </button>
                    </div>

                    {/* Fullscreen Button */}
                    <button
                      onClick={toggleFullscreen}
                      className="p-3 rounded-full hover:bg-[var(--l-card-hover)] transition-colors text-[var(--l-muted)]"
                      title={t("fullscreen_mode")}
                    >
                      <Maximize2 size={18} />
                    </button>
                  </div>

                  {/* Horizontal Linear Progress Bar */}
                  <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "var(--l-border-subtle)" }}>
                    <div
                      className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>

                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Add / Edit Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-md p-6 rounded-2xl shadow-2xl animate-fade-in" style={{ background: "var(--l-surface)", border: "1px solid var(--l-border)" }}>
            <div className="flex justify-between items-center mb-4">
              <h2 style={{ fontSize: "18px", fontWeight: 800 }}>{modal === "add" ? t("add_flashcard_modal") : t("edit_flashcard_modal")}</h2>
              <button onClick={() => setModal(null)} className="p-1.5 rounded-lg hover:bg-[var(--l-card-hover)]"><X size={16} /></button>
            </div>

            <form onSubmit={handleSaveCard} className="space-y-4">
              <div>
                <label className="block text-xs font-bold mb-1.5" style={{ color: "var(--l-muted)" }}>{t("english_word_label")}</label>
                <input
                  type="text"
                  required
                  placeholder={t("placeholder_target_word")}
                  value={formData.targetWord}
                  onChange={(e) => setFormData({ ...formData, targetWord: e.target.value })}
                  className="form-input"
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1.5" style={{ color: "var(--l-muted)" }}>{t("turkish_translation_label")}</label>
                <input
                  type="text"
                  required
                  placeholder={t("placeholder_translation")}
                  value={formData.turkishTranslation}
                  onChange={(e) => setFormData({ ...formData, turkishTranslation: e.target.value })}
                  className="form-input"
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1.5" style={{ color: "var(--l-muted)" }}>{t("example_sentence_optional")}</label>
                <textarea
                  placeholder={t("placeholder_example")}
                  value={formData.exampleSentence}
                  onChange={(e) => setFormData({ ...formData, exampleSentence: e.target.value })}
                  rows={2}
                  className="form-textarea resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1.5" style={{ color: "var(--l-muted)" }}>{t("note_optional")}</label>
                <input
                  type="text"
                  placeholder={t("placeholder_note")}
                  value={formData.note}
                  onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                  className="form-input"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModal(null)}
                  className="btn-secondary"
                >
                  {t("cancel")}
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                >
                  {t("save_card")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-sm p-6 rounded-2xl shadow-2xl animate-fade-in" style={{ background: "var(--l-surface)", border: "1px solid var(--l-border)" }}>
            <h3 style={{ fontSize: "16px", fontWeight: 800, marginBottom: "8px" }}>{t("delete_flashcard_title")}</h3>
            <p style={{ fontSize: "13px", color: "var(--l-muted)", marginBottom: "20px" }}>
              {t("delete_flashcard_warning")}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="btn-secondary"
              >
                {t("cancel")}
              </button>
              <button
                onClick={() => deleteConfirmId && handleDeleteCard(deleteConfirmId)}
                className="btn-danger"
              >
                {t("delete")}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
