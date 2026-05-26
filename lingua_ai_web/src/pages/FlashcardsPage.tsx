import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, RotateCcw, Plus, Edit2, Trash2, BookOpen, GraduationCap, X, Calendar, MessageSquare, AlertCircle, Volume2, Star, Play, Pause, Shuffle, Maximize2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTargetLanguage } from "../context/TargetLanguageContext";
import apiClient from "../api/apiClient";

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

const SCORE_LABELS = ["Forgot", "Hard", "Okay", "Easy", "Very Easy", "Perfect"];

export function FlashcardsPage() {
  const navigate = useNavigate();
  const { user, isGuest } = useAuth();
  const { targetLanguage } = useTargetLanguage();
  const userId = user?.id || user?.email || (isGuest ? 'guest@lingua.ai' : 'unknown');

  // View & Modal states
  const [view, setView] = useState<"list" | "study">("list");
  const [modal, setModal] = useState<null | "add" | "edit">(null);
  const [selectedCard, setSelectedCard] = useState<CardData | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

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
    fetchCards();
  }, [user]);

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
    setLoading(true);
    setError(null);
    try {
      const allRes = await apiClient.get(`/flashcards/all?userId=${userId}`);
      setAllCards(allRes.data);

      const dueRes = await apiClient.get(`/flashcards/due?userId=${userId}`);
      setDueCards(dueRes.data);
      setOriginalDueCards(dueRes.data);

      localStorage.setItem(`flashcards_all_${userId}`, JSON.stringify(allRes.data));
      localStorage.setItem(`flashcards_due_${userId}`, JSON.stringify(dueRes.data));
    } catch (e) {
      console.error("Failed to fetch cards from server, loading cached.", e);
      const cachedAll = localStorage.getItem(`flashcards_all_${userId}`);
      const cachedDue = localStorage.getItem(`flashcards_due_${userId}`);
      if (cachedAll) setAllCards(JSON.parse(cachedAll));
      if (cachedDue) {
        setDueCards(JSON.parse(cachedDue));
        setOriginalDueCards(JSON.parse(cachedDue));
      }
      
      setError("Unable to sync with server. Using offline data.");
      setTimeout(() => setError(null), 5000);
    } finally {
      setLoading(false);
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
    if (!formData.targetWord || !formData.turkishTranslation) {
      setError("English Word and Turkish Translation are required.");
      return;
    }

    try {
      if (modal === "add") {
        await apiClient.post("/flashcards", {
          userId,
          ...formData,
        });
        showSuccess("Flashcard created successfully!");
      } else if (modal === "edit" && selectedCard) {
        await apiClient.put(`/flashcards/${selectedCard._id}`, formData);
        showSuccess("Flashcard updated successfully!");
      }
      setModal(null);
      fetchCards();
    } catch (err: any) {
      console.error("Failed to save card", err);
      setError(err.response?.data?.message || "Failed to save flashcard.");
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    try {
      await apiClient.delete(`/flashcards/${cardId}`);
      showSuccess("Flashcard deleted successfully!");
      setDeleteConfirmId(null);
      fetchCards();
    } catch (err: any) {
      console.error("Failed to delete card", err);
      setError("Failed to delete flashcard.");
    }
  };

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
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

  const handleStudyScore = async (score: number, manual: boolean = true) => {
    const card = dueCards[currentStudyIndex];
    if (card) {
      try {
        await apiClient.put(`/flashcards/${card._id}/review`, { score });
      } catch (e) {
        console.error("Failed to save review to backend", e);
      }
    }

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

  const speakWord = (text: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      window.speechSynthesis.speak(utterance);
    } else {
      setError("Text-to-speech is not supported on this browser.");
      setTimeout(() => setError(null), 3000);
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
    const element = document.getElementById("study-container");
    if (!element) return;
    if (!document.fullscreenElement) {
      element.requestFullscreen().then(() => setIsFullscreen(true)).catch(err => {
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
    if (card.note) return `Note: ${card.note}`;
    if (card.turkishTranslation) {
      return `Starts with: "${card.turkishTranslation.substring(0, 2)}..."`;
    }
    return "No hint available.";
  };

  const finishStudy = () => {
    setView("list");
    fetchCards();
  };

  if (loading && allCards.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col" style={{ background: "var(--l-bg)", color: "var(--l-text)" }}>
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="font-semibold">Loading your vocabulary deck...</p>
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
              <h1 style={{ fontSize: "28px", fontWeight: 800, letterSpacing: "-0.02em" }}>Flashcards</h1>
              <p style={{ fontSize: "14px", color: "var(--l-muted)", marginTop: "2px" }}>
                Create your custom cards and learn them using Spaced Repetition (SM-2).
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleOpenAdd}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl transition-all duration-200"
                style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)", color: "white", fontSize: "13px", fontWeight: 700, boxShadow: "0 4px 14px rgba(99,102,241,0.3)" }}
              >
                <Plus size={16} /> Add New Card
              </button>
              {dueCards.length > 0 && (
                <button
                  onClick={startStudy}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl transition-all duration-200"
                  style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.25)", color: "#10B981", fontSize: "13px", fontWeight: 700 }}
                >
                  <GraduationCap size={16} /> Study Due ({dueCards.length})
                </button>
              )}
            </div>
          </div>

          {/* Stats Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <div className="p-4 rounded-xl" style={{ background: "var(--l-surface)", border: "1px solid var(--l-border)" }}>
              <div style={{ fontSize: "12px", color: "var(--l-muted)" }}>Total Cards</div>
              <div style={{ fontSize: "22px", fontWeight: 800, marginTop: "2px" }}>{allCards.length}</div>
            </div>
            <div className="p-4 rounded-xl" style={{ background: "var(--l-surface)", border: "1px solid var(--l-border)" }}>
              <div style={{ fontSize: "12px", color: "var(--l-muted)" }}>Due Today</div>
              <div style={{ fontSize: "22px", fontWeight: 800, color: dueCards.length > 0 ? "#10B981" : "inherit", marginTop: "2px" }}>{dueCards.length}</div>
            </div>
            <div className="p-4 rounded-xl" style={{ background: "var(--l-surface)", border: "1px solid var(--l-border)" }}>
              <div style={{ fontSize: "12px", color: "var(--l-muted)" }}>Target Language</div>
              <div style={{ fontSize: "15px", fontWeight: 700, marginTop: "6px" }}>🇺🇸 {targetLanguage}</div>
            </div>
            <div className="p-4 rounded-xl" style={{ background: "var(--l-surface)", border: "1px solid var(--l-border)" }}>
              <div style={{ fontSize: "12px", color: "var(--l-muted)" }}>Dashboard</div>
              <button onClick={() => navigate("/")} className="text-indigo-500 hover:underline" style={{ fontSize: "13px", fontWeight: 700, marginTop: "6px", display: "block" }}>
                &larr; Go Back
              </button>
            </div>
          </div>

          {/* Cards Grid */}
          {allCards.length === 0 ? (
            <div className="p-12 rounded-2xl flex flex-col items-center justify-center text-center" style={{ background: "var(--l-surface)", border: "1px solid var(--l-border)" }}>
              <div className="w-12 h-12 rounded-full flex items-center justify-center mb-4" style={{ background: "rgba(99,102,241,0.12)" }}>
                <BookOpen size={22} color="#6366F1" />
              </div>
              <h3 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "6px" }}>No flashcards yet</h3>
              <p style={{ fontSize: "13px", color: "var(--l-muted)", maxWidth: "320px", marginBottom: "20px" }}>
                Add words you want to remember. They will show up here and prompt you for reviews.
              </p>
              <button
                onClick={handleOpenAdd}
                className="px-6 py-2.5 rounded-xl text-white font-bold"
                style={{ background: "#6366F1", fontSize: "13px" }}
              >
                Add Your First Card
              </button>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {allCards.map((card) => {
                const isDue = dueCards.some((d) => d._id === card._id);
                return (
                  <div
                    key={card._id}
                    className="p-5 rounded-2xl flex flex-col justify-between transition-all hover:translate-y-[-2px]"
                    style={{ background: "var(--l-surface)", border: isDue ? "1.5px solid #10B981" : "1px solid var(--l-border)" }}
                  >
                    <div>
                      <div className="flex justify-between items-start gap-2 mb-3">
                        <span className="px-2.5 py-0.5 rounded-md font-bold" style={{ fontSize: "10px", background: isDue ? "rgba(16,185,129,0.15)" : "var(--l-surface3)", color: isDue ? "#10B981" : "var(--l-muted)" }}>
                          {isDue ? "DUE NOW" : "LEARNING"}
                        </span>
                        <div className="flex gap-2">
                          <button onClick={() => handleOpenEdit(card)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors" style={{ color: "var(--l-muted)" }}>
                            <Edit2 size={14} />
                          </button>
                          <button onClick={() => setDeleteConfirmId(card._id)} className="p-1.5 rounded-lg hover:bg-red-50 transition-colors" style={{ color: "#F87171" }}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--l-text)" }}>{card.targetWord}</div>
                      <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--l-muted)", marginTop: "4px" }}>{card.turkishTranslation}</div>

                      {card.exampleSentence && (
                        <div className="mt-3 p-2.5 rounded-lg text-xs" style={{ background: "var(--l-surface3)", fontStyle: "italic" }}>
                          "{card.exampleSentence}"
                        </div>
                      )}
                      
                      {card.note && (
                        <div className="mt-2 text-xs flex gap-1.5 items-start" style={{ color: "var(--l-muted)" }}>
                          <MessageSquare size={12} className="mt-0.5 flex-shrink-0" />
                          <span>{card.note}</span>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 pt-3 flex items-center justify-between border-t" style={{ borderColor: "var(--l-border-subtle)", fontSize: "11px", color: "var(--l-subtle)" }}>
                      <span className="flex items-center gap-1"><Calendar size={12} /> Next: {new Date(card.nextReviewDate).toLocaleDateString()}</span>
                      <span>Reviews: {card.reviewCount || 0}</span>
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
              <h2 style={{ fontSize: "24px", fontWeight: 800, marginBottom: "8px" }}>Great Job!</h2>
              <p style={{ fontSize: "14px", color: "var(--l-muted)", marginBottom: "24px" }}>
                You have finished reviewing all {dueCards.length} cards for today.
              </p>
              
              <div className="px-6 py-4 rounded-xl mb-8" style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)" }}>
                <div style={{ fontSize: "30px", fontWeight: 800, color: "#10B981" }}>
                  {studyResults.length > 0 ? (studyResults.reduce((a, b) => a + b, 0) / studyResults.length).toFixed(1) : "5.0"}/5
                </div>
                <div style={{ fontSize: "12px", color: "var(--l-muted)" }}>Average Score</div>
              </div>

              <button
                onClick={finishStudy}
                className="w-full py-3 rounded-xl text-white font-bold transition-transform hover:scale-102"
                style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}
              >
                Back to Flashcard List
              </button>
            </div>
          ) : (
            <>
              {/* Study Header Navigation */}
              <div className="flex items-center justify-between mb-4">
                <button onClick={finishStudy} className="flex items-center gap-1.5 text-xs font-bold text-indigo-500 hover:underline">
                  &larr; Exit Study
                </button>
                <div className="text-xs font-bold" style={{ color: "var(--l-muted)" }}>
                  Spaced Repetition Study Deck
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
                          background: "#ffffff",
                          border: "1px solid rgba(0,0,0,0.06)",
                          boxShadow: "0 10px 30px rgba(0,0,0,0.04)",
                          color: "#1e293b",
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
                            style={{ color: "#475569" }}
                          >
                            <span style={{ fontSize: "16px" }}>💡</span> Get a hint
                          </button>
                          
                          <div className="flex items-center gap-4">
                            <button
                              onClick={(e) => speakWord(dueCards[currentStudyIndex].targetWord, e)}
                              className="p-2 rounded-full hover:bg-slate-50 transition-colors"
                              style={{ color: "#475569" }}
                            >
                              <Volume2 size={18} />
                            </button>
                            <button
                              onClick={(e) => toggleStar(dueCards[currentStudyIndex]._id, e)}
                              className="p-2 rounded-full hover:bg-slate-50 transition-colors"
                              style={{ color: starredCards[dueCards[currentStudyIndex]._id] ? "#F59E0B" : "#94a3b8" }}
                            >
                              <Star size={18} fill={starredCards[dueCards[currentStudyIndex]._id] ? "#F59E0B" : "transparent"} />
                            </button>
                          </div>
                        </div>

                        {/* Front Card Middle Text */}
                        <div className="flex-1 flex flex-col items-center justify-center">
                          <div className="text-4xl sm:text-5xl font-medium tracking-tight text-center px-4" style={{ fontFamily: "'Outfit', 'Inter', sans-serif" }}>
                            {dueCards[currentStudyIndex].targetWord}
                          </div>
                          {hintVisible && (
                            <div className="mt-6 text-sm font-medium px-4 py-2 rounded-xl bg-amber-50 border border-amber-100 text-amber-800 animate-fade-in">
                              {getHintText(dueCards[currentStudyIndex])}
                            </div>
                          )}
                        </div>

                        {/* Front Card Footer Tip */}
                        <div className="text-center text-xs font-semibold text-slate-400">
                          Click card to flip
                        </div>
                      </div>

                      {/* BACK CARD */}
                      <div
                        className="absolute inset-0 flex flex-col justify-between rounded-3xl p-8"
                        style={{
                          backfaceVisibility: "hidden",
                          transform: "rotateY(180deg)",
                          background: "#ffffff",
                          border: "1px solid rgba(0,0,0,0.06)",
                          boxShadow: "0 10px 30px rgba(0,0,0,0.04)",
                          color: "#1e293b",
                        }}
                      >
                        {/* Back Card Header */}
                        <div className="flex justify-between items-center w-full">
                          <div className="text-xs font-bold text-indigo-500 uppercase tracking-widest">
                            Translation
                          </div>
                          <div className="flex items-center gap-4">
                            <button
                              onClick={(e) => speakWord(dueCards[currentStudyIndex].turkishTranslation, e)}
                              className="p-2 rounded-full hover:bg-slate-50 transition-colors"
                              style={{ color: "#475569" }}
                            >
                              <Volume2 size={18} />
                            </button>
                            <button
                              onClick={(e) => toggleStar(dueCards[currentStudyIndex]._id, e)}
                              className="p-2 rounded-full hover:bg-slate-50 transition-colors"
                              style={{ color: starredCards[dueCards[currentStudyIndex]._id] ? "#F59E0B" : "#94a3b8" }}
                            >
                              <Star size={18} fill={starredCards[dueCards[currentStudyIndex]._id] ? "#F59E0B" : "transparent"} />
                            </button>
                          </div>
                        </div>

                        {/* Back Card Middle Text */}
                        <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto max-h-[220px] py-4">
                          <div className="text-3xl sm:text-4xl font-semibold tracking-tight text-center px-4 mb-4">
                            {dueCards[currentStudyIndex].turkishTranslation}
                          </div>
                          
                          {dueCards[currentStudyIndex].exampleSentence && (
                            <div className="w-full max-w-md p-3 rounded-xl bg-slate-50 text-left border border-slate-100 text-slate-700 mb-2">
                              <div className="text-[10px] font-bold text-slate-400 uppercase mb-0.5">Example</div>
                              <div className="text-xs italic">"{dueCards[currentStudyIndex].exampleSentence}"</div>
                            </div>
                          )}

                          {dueCards[currentStudyIndex].note && (
                            <div className="w-full max-w-md p-3 rounded-xl bg-slate-50 text-left border border-slate-100 text-slate-700">
                              <div className="text-[10px] font-bold text-slate-400 uppercase mb-0.5">Note</div>
                              <div className="text-xs">{dueCards[currentStudyIndex].note}</div>
                            </div>
                          )}
                        </div>

                        {/* Back Card Footer Tip */}
                        <div className="text-center text-xs font-semibold text-slate-400">
                          Click card to flip
                        </div>
                      </div>

                    </div>
                  </div>

                  {/* Rating Buttons - Fades in below the card ONLY when card is flipped */}
                  <div className={`transition-all duration-300 overflow-hidden ${flipped ? 'opacity-100 max-h-48 mb-6' : 'opacity-0 max-h-0 pointer-events-none'}`}>
                    <div className="p-4 rounded-2xl bg-white border border-slate-100 shadow-sm">
                      <div className="text-center text-xs font-bold text-slate-500 mb-3 uppercase tracking-wider">How well did you know this word? (SM-2)</div>
                      <div className="grid grid-cols-6 gap-2">
                        {SCORE_LABELS.map((label, i) => {
                          const colors = [
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
                              <span style={{ fontSize: "9px", color: c.text, textAlign: "center", fontWeight: 700, lineHeight: 1.1, marginTop: "2px" }}>{label}</span>
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
                        className={`p-3 rounded-full transition-all ${isShuffled ? 'bg-indigo-50 text-indigo-600' : 'hover:bg-slate-100 text-slate-500'}`}
                        title="Shuffle Deck"
                      >
                        <Shuffle size={18} />
                      </button>
                      <button
                        onClick={() => setIsPlaying(!isPlaying)}
                        className={`p-3 rounded-full transition-all ${isPlaying ? 'bg-indigo-50 text-indigo-600' : 'hover:bg-slate-100 text-slate-500'}`}
                        title={isPlaying ? "Pause Slideshow" : "Play Slideshow"}
                      >
                        {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                      </button>
                    </div>

                    {/* Centered Controls */}
                    <div className="flex items-center gap-6">
                      <button
                        onClick={handlePrevCard}
                        disabled={currentStudyIndex === 0}
                        className="p-3 rounded-full hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none transition-colors text-slate-600"
                      >
                        <ArrowLeft size={20} />
                      </button>
                      
                      <span className="text-sm font-semibold tracking-wide text-slate-600">
                        {currentStudyIndex + 1} / {dueCards.length}
                      </span>

                      <button
                        onClick={handleNextCard}
                        disabled={currentStudyIndex + 1 >= dueCards.length}
                        className="p-3 rounded-full hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none transition-colors text-slate-600 border border-slate-200"
                      >
                        <ArrowRight size={20} />
                      </button>
                    </div>

                    {/* Fullscreen Button */}
                    <button
                      onClick={toggleFullscreen}
                      className="p-3 rounded-full hover:bg-slate-100 transition-colors text-slate-500"
                      title="Fullscreen Mode"
                    >
                      <Maximize2 size={18} />
                    </button>
                  </div>

                  {/* Horizontal Linear Progress Bar */}
                  <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
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
              <h2 style={{ fontSize: "18px", fontWeight: 800 }}>{modal === "add" ? "Add New Flashcard" : "Edit Flashcard"}</h2>
              <button onClick={() => setModal(null)} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={16} /></button>
            </div>

            <form onSubmit={handleSaveCard} className="space-y-4">
              <div>
                <label className="block text-xs font-bold mb-1.5" style={{ color: "var(--l-muted)" }}>English Word</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. apple"
                  value={formData.targetWord}
                  onChange={(e) => setFormData({ ...formData, targetWord: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl outline-none"
                  style={{ background: "var(--l-input-bg)", border: "1px solid var(--l-border)", color: "var(--l-text)" }}
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1.5" style={{ color: "var(--l-muted)" }}>Turkish Translation</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. elma"
                  value={formData.turkishTranslation}
                  onChange={(e) => setFormData({ ...formData, turkishTranslation: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl outline-none"
                  style={{ background: "var(--l-input-bg)", border: "1px solid var(--l-border)", color: "var(--l-text)" }}
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1.5" style={{ color: "var(--l-muted)" }}>Example Sentence (Optional)</label>
                <textarea
                  placeholder="e.g. I eat an apple every day."
                  value={formData.exampleSentence}
                  onChange={(e) => setFormData({ ...formData, exampleSentence: e.target.value })}
                  rows={2}
                  className="w-full px-4 py-2 rounded-xl outline-none resize-none"
                  style={{ background: "var(--l-input-bg)", border: "1px solid var(--l-border)", color: "var(--l-text)" }}
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1.5" style={{ color: "var(--l-muted)" }}>Note (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. irregular plural, spelling tip"
                  value={formData.note}
                  onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl outline-none"
                  style={{ background: "var(--l-input-bg)", border: "1px solid var(--l-border)", color: "var(--l-text)" }}
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModal(null)}
                  className="px-5 py-2.5 rounded-xl font-bold"
                  style={{ background: "var(--l-surface3)" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl font-bold text-white"
                  style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}
                >
                  Save Card
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
            <h3 style={{ fontSize: "16px", fontWeight: 800, marginBottom: "8px" }}>Delete Flashcard?</h3>
            <p style={{ fontSize: "13px", color: "var(--l-muted)", marginBottom: "20px" }}>
              Are you sure you want to permanently delete this card from your deck? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 rounded-xl font-bold"
                style={{ background: "var(--l-surface3)" }}
              >
                Cancel
              </button>
              <button
                onClick={() => deleteConfirmId && handleDeleteCard(deleteConfirmId)}
                className="px-4 py-2 rounded-xl font-bold text-white"
                style={{ background: "#EF4444" }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
