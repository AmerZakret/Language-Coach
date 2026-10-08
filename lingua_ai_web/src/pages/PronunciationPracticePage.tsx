import { targetLanguageCode, targetLanguageTtsLocale } from '../utils/targetLanguage';
import { useState, useEffect, useRef } from "react";
import { Mic, Square, Sparkles, AlertCircle, Volume2, Loader, CheckCircle2, WifiOff } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { useTargetLanguage } from "../context/TargetLanguageContext";
import { useNetwork } from "../context/NetworkContext";
import { assessPronunciation } from "../api/pronunciationApi";
import type { PronunciationAssessmentResult } from "../api/pronunciationApi";
import apiClient from "../api/apiClient";

interface Flashcard {
  _id: string;
  targetWord: string;
  turkishTranslation: string;
}

function ScoreRing({ value, color, label }: { value: number; color: string; label: string }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-24 h-24">
        <svg width="96" height="96" className="-rotate-90">
          <circle cx="48" cy="48" r={r} fill="none" stroke="var(--l-surface3)" strokeWidth="8" />
          <circle cx="48" cy="48" r={r} fill="none" stroke={color} strokeWidth="8" strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" style={{ transition: "stroke-dashoffset 1s ease" }} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span style={{ fontSize: "20px", fontWeight: 900, color }}>{value}</span>
        </div>
      </div>
      <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--l-muted)" }}>{label}</span>
    </div>
  );
}

export function PronunciationPracticePage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { targetLanguage } = useTargetLanguage();
  const { isOffline } = useNetwork();

  // Mode/Source State
  const [sourceType, setSourceType] = useState<"manual" | "flashcard">("manual");
  const [targetText, setTargetText] = useState("");
  const [nativeTranslation, setNativeTranslation] = useState("");

  if (isOffline) {
    return (
      <div className="flex flex-col items-center justify-center text-center p-8 border rounded-2xl h-[450px]" style={{ background: "var(--l-surface)", borderColor: "var(--l-border)", color: "var(--l-text)" }}>
        <WifiOff size={48} className="text-amber-500 mb-4 animate-bounce" />
        <h2 style={{ fontSize: "20px", fontWeight: 800 }}>{t("offline_only_title")}</h2>
        <p style={{ fontSize: "14px", color: "var(--l-muted)", marginTop: "8px", maxWidth: "340px" }}>{t("offline_only_desc")}</p>
      </div>
    );
  }
  
  // Dynamic Sources Data
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);

  // Audio Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [recordDuration, setRecordDuration] = useState(0);
  const [micPermissionError, setMicPermissionError] = useState<string | null>(null);
  
  // API Assessment State
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PronunciationAssessmentResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<any>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Fetch Flashcards on load
  useEffect(() => {
    const fetchSources = async () => {
      try {
        if (user?.id && user.id !== "guest") {
          const fcRes = await apiClient.get(`/flashcards/all?targetLanguage=${targetLanguageCode(targetLanguage)}`);
          setFlashcards(fcRes.data || []);
        }
      } catch (e) {
        console.error("Failed to load pronunciation sources", e);
      }
    };
    fetchSources();
  }, [targetLanguage, user]);

  // Reset audio & results when targetText changes
  useEffect(() => {
    setAudioBlob(null);
    setAudioUrl(null);
    setResult(null);
    setError(null);
  }, [targetText]);

  // Reset targetText & translation on sourceType switch
  useEffect(() => {
    setTargetText("");
    setNativeTranslation("");
  }, [sourceType]);

  // Timer for recording duration
  useEffect(() => {
    if (isRecording) {
      setRecordDuration(0);
      timerRef.current = setInterval(() => {
        setRecordDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  // Text-To-Speech playback
  const handleListen = () => {
    if (!targetText.trim()) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(targetText);
    const voiceCode = targetLanguageTtsLocale(targetLanguage);
    utterance.lang = voiceCode;

    // Load available voices
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find(v => v.lang.startsWith(voiceCode));
    if (voice) {
      utterance.voice = voice;
    }
    window.speechSynthesis.speak(utterance);
  };

  const startRecording = async () => {
    setMicPermissionError(null);
    setAudioBlob(null);
    setAudioUrl(null);
    setResult(null);
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const options = MediaRecorder.isTypeSupported("audio/webm")
        ? { mimeType: "audio/webm" }
        : undefined;

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || "audio/webm" });
        const audioUrl = URL.createObjectURL(audioBlob);
        setAudioBlob(audioBlob);
        setAudioUrl(audioUrl);

        // Turn off microphone tracks
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (e: any) {
      console.error(e);
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        setMicPermissionError(t('mic_permission_denied'));
      } else {
        setMicPermissionError(t('mic_not_supported'));
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleSubmitAssessment = async () => {
    if (!audioBlob || !targetText.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    const langCode = targetLanguageCode(targetLanguage);

    try {
      const assessment = await assessPronunciation({
        audio: audioBlob,
        targetText: targetText.trim(),
        targetLanguage: langCode,
        nativeTranslation: nativeTranslation.trim() || undefined,
        nativeLanguage: "tr",
        sourceType: sourceType,
      });

      setResult(assessment);
    } catch (e: any) {
      console.error(e);
      setError(e.response?.data?.message || t('failed_pronunciation'));
    } finally {
      setLoading(false);
    }
  };

  const getResultColor = (score: number) => {
    if (score >= 90) return "#22C55E"; // Green
    if (score >= 70) return "#F59E0B"; // Orange
    return "#EF4444"; // Red
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6 animate-fade-in" style={{ background: "var(--l-bg)", minHeight: "100vh" }}>
      <div>
        <h1 style={{ color: "var(--l-text)", fontWeight: 800, fontSize: "26px", letterSpacing: "-0.02em" }}>{t('pronunciation_practice')}</h1>
        <p style={{ fontSize: "14px", color: "var(--l-muted)", marginTop: "4px" }}>{t('pronunciation_subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        {/* Left Column: Source selector, Input card, and practice area (Spans 7 of 12) */}
        <div className="md:col-span-7 space-y-6">
          
          {/* Source Tabs */}
          <div className="flex gap-2 p-1.5 rounded-xl w-full" style={{ background: "var(--l-surface2)", border: "1px solid var(--l-border)" }}>
            {(["manual", "flashcard"] as const).map((type) => (
              <button
                key={type}
                onClick={() => setSourceType(type)}
                className="flex-1 py-2 px-4 rounded-lg text-sm font-bold capitalize transition-all"
                style={{
                  background: sourceType === type ? "var(--l-surface)" : "transparent",
                  color: sourceType === type ? "#6366F1" : "var(--l-muted)",
                  boxShadow: sourceType === type ? "0 4px 12px rgba(99, 102, 241, 0.08)" : "none",
                  cursor: "pointer"
                }}
              >
                {type === "manual" ? t('manual_input') : t('from_flashcards')}
              </button>
            ))}
          </div>

          {/* Input Area Card */}
          <div className="p-6 rounded-2xl space-y-5" style={{ background: "var(--l-surface)", border: "1px solid var(--l-border)", boxShadow: "0 4px 20px rgba(0,0,0,0.02)" }}>
            {sourceType === "manual" ? (
              <div className="space-y-3.5 animate-fade-in">
                <label style={{ fontSize: "11px", fontWeight: 800, color: "var(--l-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{t('target_sentence')}</label>
                <textarea
                  value={targetText}
                  onChange={(e) => setTargetText(e.target.value)}
                  placeholder={`${t('target_sentence')}...`}
                  rows={3}
                  className="form-textarea resize-none"
                />
                
                <label style={{ fontSize: "11px", fontWeight: 800, color: "var(--l-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{t('translation_optional')}</label>
                <input
                  type="text"
                  value={nativeTranslation}
                  onChange={(e) => setNativeTranslation(e.target.value)}
                  placeholder={t('translation_optional_placeholder')}
                  className="form-input"
                />
              </div>
            ) : (
              <div className="space-y-3.5 animate-fade-in">
                <label style={{ fontSize: "11px", fontWeight: 800, color: "var(--l-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{t('select_flashcard_word')}</label>
                {flashcards.length === 0 ? (
                  <div className="p-8 text-center rounded-xl" style={{ background: "var(--l-surface2)", color: "var(--l-muted)", fontSize: "14px" }}>
                    {t('no_flashcards_available')}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-48 overflow-y-auto pr-1">
                    {flashcards.map((card) => (
                      <button
                        key={card._id}
                        onClick={() => {
                          setTargetText(card.targetWord);
                          setNativeTranslation(card.turkishTranslation);
                        }}
                        className="p-3.5 rounded-xl text-left transition-all border flex flex-col hover:bg-[var(--l-card-hover)] cursor-pointer"
                        style={{
                          background: targetText === card.targetWord ? "rgba(99,102,241,0.06)" : "transparent",
                          borderColor: targetText === card.targetWord ? "#6366F1" : "var(--l-border)",
                          color: "var(--l-text)",
                        }}
                      >
                        <span className="font-bold text-sm">{card.targetWord}</span>
                        <span className="text-xs" style={{ color: "var(--l-muted)" }}>{card.turkishTranslation}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Active Speaking Practice Panel */}
          {targetText.trim() && (
            <div className="p-8 rounded-2xl space-y-6 text-center animate-fade-in" style={{ background: "var(--l-surface)", border: "1px solid var(--l-border)", boxShadow: "0 10px 30px rgba(0,0,0,0.02)" }}>
              <div className="space-y-2.5">
                <span className="text-[11px] font-bold uppercase tracking-widest text-indigo-500">{t('practice_phrase')}</span>
                <h2
                  dir={targetLanguage === 'Arabic' ? 'rtl' : 'ltr'}
                  style={{ fontSize: "32px", fontWeight: 900, color: "var(--l-text)", lineHeight: 1.2, letterSpacing: "-0.015em", textAlign: targetLanguage === 'Arabic' ? 'right' : 'center' }}
                >
                  "{targetText}"
                </h2>
                {nativeTranslation && (
                  <p style={{ fontSize: "15px", color: "var(--l-muted)", fontWeight: 500 }}>({nativeTranslation})</p>
                )}
              </div>

              {/* Action Buttons: Listen & Record */}
              <div className="flex items-center justify-center gap-4">
                <button
                  onClick={handleListen}
                  className="btn-secondary py-3 px-6 text-xs font-bold"
                  style={{ border: "1px solid rgba(99, 102, 241, 0.4)", color: "#6366F1" }}
                >
                  <Volume2 size={16} />
                  {t('listen')}
                </button>

                {!isRecording ? (
                  <button
                    onClick={startRecording}
                    disabled={loading}
                    className="btn-primary py-3 px-6 text-xs font-bold shadow-lg shadow-indigo-500/20"
                  >
                    <Mic size={16} />
                    {t('record')}
                  </button>
                ) : (
                  <button
                    onClick={stopRecording}
                    className="btn-danger py-3 px-6 text-xs font-bold animate-pulse shadow-lg shadow-red-500/25"
                  >
                    <Square size={16} fill="white" />
                    {t('stop')} ({recordDuration}s)
                  </button>
                )}
              </div>

              {/* Error messages */}
              {micPermissionError && (
                <div className="flex items-center gap-2 p-4 rounded-xl text-red-600 bg-red-500/10 text-xs max-w-md mx-auto border border-red-500/20">
                  <AlertCircle size={16} className="shrink-0" />
                  <span className="text-left font-semibold">{micPermissionError}</span>
                </div>
              )}

              {/* Status Label & Submit Section (No Audio Player Preview!) */}
              {audioUrl && !isRecording && (
                <div className="pt-5 border-t space-y-4 animate-fade-in" style={{ borderColor: "var(--l-border-subtle)" }}>
                  {/* Simple Status instead of player */}
                  <div className="flex items-center justify-center gap-2 text-xs font-bold text-emerald-500 bg-emerald-500/8 px-4 py-2.5 rounded-xl border border-emerald-500/15 max-w-xs mx-auto">
                    <CheckCircle2 size={14} className="animate-pulse" />
                    <span>Recording ready for assessment</span>
                  </div>

                  <button
                    onClick={handleSubmitAssessment}
                    disabled={loading}
                    className="w-full btn-primary py-3.5 text-xs font-bold shadow-xl shadow-indigo-600/15"
                  >
                    {loading ? (
                      <>
                        <Loader size={16} className="animate-spin" />
                        {t('analyzing_speech')}
                      </>
                    ) : (
                      <>
                        <Sparkles size={16} />
                        {t('submit_for_assessment')}
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Helpful tip if not recorded yet */}
              {!audioUrl && !isRecording && (
                <p className="text-[11px] text-gray-400 font-medium">{t('click_record_tip')}</p>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Waiting State OR Assessment Results (Spans 5 of 12) */}
        <div className="md:col-span-5">
          {loading && (
            <div className="p-8 rounded-2xl flex flex-col items-center justify-center space-y-4 animate-fade-in" style={{ background: "var(--l-surface)", border: "1px solid var(--l-border)", minHeight: "360px" }}>
              <div className="relative w-14 h-14">
                <div className="absolute inset-0 rounded-full border-4 border-indigo-100 dark:border-indigo-950" />
                <div className="absolute inset-0 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin" />
              </div>
              <span className="font-bold text-sm" style={{ color: "var(--l-text)" }}>{t('analyzing_speech')}</span>
              <p className="text-xs text-center leading-relaxed" style={{ color: "var(--l-muted)", maxWidth: "240px" }}>{t('analyzing_speech_desc')}</p>
            </div>
          )}

          {error && !loading && (
            <div className="p-6 rounded-2xl space-y-4 text-center animate-fade-in border" style={{ background: "var(--l-surface)", borderColor: "#EF4444" }}>
              <AlertCircle size={36} className="mx-auto text-red-500" />
              <h3 className="font-bold text-sm text-red-600">{t('evaluation_failed')}</h3>
              <p className="text-xs leading-relaxed" style={{ color: "var(--l-text)" }}>{error}</p>
              <p className="text-[10px]" style={{ color: "var(--l-muted)" }}>Please verify that uvicorn/whisper is running at http://localhost:8001</p>
            </div>
          )}

          {result && !loading && (
            <div className="p-6 rounded-2xl space-y-5 animate-fade-in border" style={{ background: "var(--l-surface)", borderColor: "var(--l-border)" }}>
              <h3 className="font-bold text-sm text-center border-b pb-3" style={{ color: "var(--l-text)", borderColor: "var(--l-border-subtle)" }}>{t('assessment_result')}</h3>
              
              <div className="flex justify-center">
                <ScoreRing
                  value={result.pronunciationScore}
                  color={getResultColor(result.pronunciationScore)}
                  label={result.result === "correct" ? t('excellent') : result.result === "almost" ? t('good_job') : t('retry')}
                />
              </div>

              {/* Text Comparisons */}
              <div className="space-y-3 text-xs">
                <div className="p-3.5 rounded-xl space-y-1" style={{ background: "var(--l-surface2)" }}>
                  <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest">{t('expected')}</span>
                  <div
                    dir={targetLanguage === 'Arabic' ? 'rtl' : 'ltr'}
                    className="font-bold text-sm"
                    style={{ color: "var(--l-text)", textAlign: targetLanguage === 'Arabic' ? 'right' : 'left' }}
                  >
                    {result.targetText}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl space-y-1" style={{ background: "var(--l-surface2)" }}>
                  <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: getResultColor(result.pronunciationScore) }}>{t('transcribed')}</span>
                  <div
                    dir={targetLanguage === 'Arabic' ? 'rtl' : 'ltr'}
                    className="font-bold text-sm"
                    style={{ color: "var(--l-text)", textAlign: targetLanguage === 'Arabic' ? 'right' : 'left' }}
                  >
                    {result.recognizedText || "(No speech detected)"}
                  </div>
                </div>
              </div>

              {/* Gemini Feedback */}
              <div className="p-4 rounded-xl border space-y-2" style={{ background: "rgba(99,102,241,0.03)", borderColor: "rgba(99,102,241,0.15)" }}>
                <div className="flex items-center gap-1.5 text-indigo-600">
                  <Sparkles size={13} />
                  <span className="text-[10px] font-bold uppercase tracking-wider">{t('ai_coaching_feedback')}</span>
                </div>
                <p className="text-xs leading-relaxed font-semibold" style={{ color: "var(--l-text2)" }}>{result.aiFeedback}</p>
              </div>


            </div>
          )}

          {!result && !loading && !error && (
            <div className="p-8 rounded-2xl text-center border border-dashed flex flex-col items-center justify-center space-y-3 min-h-[360px]" style={{ borderColor: "var(--l-border)", color: "var(--l-muted)", background: "var(--l-surface)" }}>
              <Mic size={32} className="opacity-30" />
              <div className="font-bold text-sm" style={{ color: "var(--l-text)" }}>{t('waiting_for_speech')}</div>
              <p className="text-xs leading-relaxed max-w-[220px]" style={{ color: "var(--l-muted)" }}>{t('waiting_for_speech_desc')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
