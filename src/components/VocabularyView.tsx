import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  GraduationCap,
  List,
  Mic,
  PhoneCall,
  Plus,
  RefreshCw,
  RotateCcw,
  Shuffle,
  Square,
  Volume2,
} from 'lucide-react';
import { getErrorMessage } from '../api.ts';
import { VocabularyWord } from '../types.ts';

interface PronunciationResult {
  passed: boolean;
  heard_text: string;
  tone_accuracy_de: string;
  tip_de: string;
}

interface VocabularyViewProps {
  allVocabulary: VocabularyWord[];
  dueVocabulary: VocabularyWord[];
  onAddVocabulary: (hanzi: string, pinyin: string, german: string) => Promise<void>;
  onReviewVocabulary: (
    simplifiedHanzi: string,
    outcome: 'used_actively' | 'recognized' | 'forgotten'
  ) => Promise<void>;
  onStartVocabQuiz?: (words: VocabularyWord[]) => void;
}

type VocabMode = 'trainer' | 'list';
type DeckFilter = 'due' | 'weak_random' | 'struggling' | 'all';
type CardDirection = 'zh-to-de' | 'de-to-zh';

let activeAudio: HTMLAudioElement | null = null;
const audioVersionMap = new Map<string, number>();

function fisherYatesShuffle<T>(items: T[], seed: number): T[] {
  const copy = [...items];
  let s = (seed || 1) >>> 0;
  const nextRand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(nextRand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pickWeakRandomWords(words: VocabularyWord[], count: number): VocabularyWord[] {
  if (words.length === 0) return [];
  const scored = words.map((w) => {
    // Strongly favor words with low streak, low stability, and few active uses
    const streakPenalty = w.streak * 2.5;
    const activePenalty = w.times_used_actively * 0.6;
    const stabilityPenalty = w.stability * 0.15;
    const zeroStreakBoost = w.streak === 0 ? 2.0 : 1.0;
    const weight = Math.max(
      0.01,
      zeroStreakBoost / (1 + streakPenalty + activePenalty + stabilityPenalty)
    );
    // Efraimidis-Spirakis weighted random sampling without replacement
    const key = Math.pow(Math.random() || 1e-9, 1 / weight);
    return { word: w, key };
  });
  scored.sort((a, b) => b.key - a.key);
  return scored.slice(0, Math.min(count, scored.length)).map((item) => item.word);
}

async function speakMandarin(
  text: string,
  onStateChange?: (loading: boolean) => void,
  options?: { forceRefresh?: boolean; onRegeneratingChange?: (regenerating: boolean) => void }
) {
  const cleanText = text.replace(/\(.*?\)|（.*?）/g, '').trim();
  if (!cleanText) return;

  if (activeAudio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio = null;
  }

  const forceRefresh = Boolean(options?.forceRefresh);
  if (forceRefresh) {
    audioVersionMap.set(cleanText, Date.now());
  }
  const version = audioVersionMap.get(cleanText);

  try {
    onStateChange?.(true);
    if (forceRefresh) options?.onRegeneratingChange?.(true);
    const params = new URLSearchParams({ text: cleanText });
    if (forceRefresh) params.set('refresh', '1');
    if (version) params.set('v', String(version));
    const url = `/api/tts?${params.toString()}`;
    const audio = new Audio(url);
    activeAudio = audio;
    audio.onended = () => {
      if (activeAudio === audio) activeAudio = null;
      onStateChange?.(false);
    };
    audio.onerror = () => {
      if (activeAudio === audio) activeAudio = null;
      onStateChange?.(false);
      if (forceRefresh) options?.onRegeneratingChange?.(false);
    };
    await audio.play();
  } catch {
    onStateChange?.(false);
  } finally {
    if (forceRefresh) options?.onRegeneratingChange?.(false);
  }
}

export function VocabularyView({
  allVocabulary,
  dueVocabulary,
  onAddVocabulary,
  onReviewVocabulary,
  onStartVocabQuiz,
}: VocabularyViewProps) {
  const [mode, setMode] = useState<VocabMode>('trainer');
  const [deckFilter, setDeckFilter] = useState<DeckFilter>(
    dueVocabulary.length > 0 ? 'due' : 'all'
  );
  const [direction, setDirection] = useState<CardDirection>('zh-to-de');
  const [showPinyin, setShowPinyin] = useState<boolean>(false);
  const [voiceMode, setVoiceMode] = useState<boolean>(false);
  const [cardIndex, setCardIndex] = useState<number>(0);
  const [isRevealed, setIsRevealed] = useState<boolean>(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState<boolean>(false);
  const [regeneratingTarget, setRegeneratingTarget] = useState<'word' | 'example' | null>(null);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isCheckingPronunciation, setIsCheckingPronunciation] = useState<boolean>(false);
  const [pronunciationResult, setPronunciationResult] = useState<PronunciationResult | null>(null);
  const [pronunciationError, setPronunciationError] = useState<string>('');
  const [sessionCompleted, setSessionCompleted] = useState<number>(0);
  const [sessionKnown, setSessionKnown] = useState<number>(0);
  const [shuffleSeed, setShuffleSeed] = useState<number>(0);
  const [weakRandomSeed, setWeakRandomSeed] = useState<number>(1);
  const [weakBatchSize, setWeakBatchSize] = useState<number>(20);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const autoStopTimerRef = useRef<number | null>(null);

  const stopMediaTracks = () => {
    if (autoStopTimerRef.current !== null) {
      window.clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
  };

  useEffect(() => {
    return () => {
      stopMediaTracks();
      if (activeAudio) {
        activeAudio.pause();
        activeAudio.currentTime = 0;
        activeAudio = null;
      }
    };
  }, []);

  // List mode state
  const [vocabSearch, setVocabSearch] = useState<string>('');
  const [newVocabHanzi, setNewVocabHanzi] = useState<string>('');
  const [newVocabPinyin, setNewVocabPinyin] = useState<string>('');
  const [newVocabGerman, setNewVocabGerman] = useState<string>('');

  const [weakRandomIds, setWeakRandomIds] = useState<number[]>(() =>
    pickWeakRandomWords(allVocabulary, 20).map((w) => w.id)
  );

  useEffect(() => {
    setWeakRandomIds(pickWeakRandomWords(allVocabulary, weakBatchSize).map((w) => w.id));
    // Re-draw when user requests a new weak-random selection, changes batch size, or vocab count changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weakRandomSeed, weakBatchSize, allVocabulary.length]);

  const trainerDeck = useMemo(() => {
    let base: VocabularyWord[];
    if (deckFilter === 'due') {
      base = dueVocabulary.length > 0 ? [...dueVocabulary] : [];
    } else if (deckFilter === 'weak_random') {
      const byId = new Map(allVocabulary.map((w) => [w.id, w]));
      base = weakRandomIds
        .map((id) => byId.get(id))
        .filter((w): w is VocabularyWord => Boolean(w));
    } else if (deckFilter === 'struggling') {
      base = allVocabulary.filter((w) => w.streak === 0);
    } else {
      base = [...allVocabulary];
    }

    if (shuffleSeed > 0 && deckFilter !== 'weak_random') {
      base = fisherYatesShuffle(base, shuffleSeed);
    }
    return base;
  }, [allVocabulary, deckFilter, dueVocabulary, shuffleSeed, weakRandomIds]);

  const currentCard = trainerDeck[cardIndex] || null;
  const isDeckDone = trainerDeck.length > 0 && cardIndex >= trainerDeck.length;

  const resetTrainer = (newFilter?: DeckFilter) => {
    if (newFilter) setDeckFilter(newFilter);
    stopMediaTracks();
    setIsRecording(false);
    setCardIndex(0);
    setIsRevealed(false);
    setPronunciationResult(null);
    setPronunciationError('');
    setSessionCompleted(0);
    setSessionKnown(0);
  };

  const handleRateCard = async (outcome: 'used_actively' | 'recognized' | 'forgotten') => {
    if (!currentCard) return;
    stopMediaTracks();
    setIsRecording(false);
    await onReviewVocabulary(currentCard.simplified_hanzi, outcome);
    setSessionCompleted((c) => c + 1);
    if (outcome === 'used_actively' || outcome === 'recognized') {
      setSessionKnown((k) => k + 1);
    }
    setIsRevealed(false);
    setPronunciationResult(null);
    setPronunciationError('');
    setCardIndex((i) => i + 1);
  };

  const startVoiceCheck = async () => {
    if (!currentCard || isRecording || isCheckingPronunciation) return;
    setPronunciationError('');
    setPronunciationResult(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : '';

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recordChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const blobType = recorder.mimeType || mimeType || 'audio/webm';
        const audioBlob = new Blob(recordChunksRef.current, { type: blobType });
        stopMediaTracks();
        setIsRecording(false);

        if (audioBlob.size < 400) {
          setPronunciationError('Aufnahme war zu kurz. Bitte sprich deutlich ins Mikrofon.');
          return;
        }

        setIsCheckingPronunciation(true);
        try {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const res = String(reader.result || '');
              const idx = res.indexOf(',');
              resolve(idx >= 0 ? res.slice(idx + 1) : res);
            };
            reader.onerror = () => reject(new Error('Audio-Lesefehler'));
            reader.readAsDataURL(audioBlob);
          });

          const resp = await fetch('/api/vocabulary/check-pronunciation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              targetHanzi: currentCard.simplified_hanzi,
              targetPinyin: currentCard.pinyin,
              targetGerman: currentCard.german,
              audioBase64: base64,
              mimeType: blobType.split(';')[0],
            }),
          });

          if (!resp.ok) {
            const errJson = await resp.json().catch(() => ({}));
            throw new Error(errJson.error || 'Aussprache-Prüfung fehlgeschlagen');
          }

          const result = (await resp.json()) as PronunciationResult;
          setPronunciationResult(result);
        } catch (err: unknown) {
          setPronunciationError(getErrorMessage(err, 'Fehler bei der Aussprache-Prüfung.'));
        } finally {
          setIsCheckingPronunciation(false);
        }
      };

      recorder.start();
      setIsRecording(true);
      autoStopTimerRef.current = window.setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
      }, 6000);
    } catch (err: unknown) {
      stopMediaTracks();
      setIsRecording(false);
      setPronunciationError(
        `Mikrofonzugriff fehlgeschlagen: ${getErrorMessage(err, 'Bitte Mikrofon erlauben.')}`
      );
    }
  };

  const stopVoiceCheck = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const filteredVocab = useMemo(() => {
    if (!vocabSearch.trim()) return allVocabulary;
    const q = vocabSearch.toLowerCase();
    return allVocabulary.filter(
      (w) =>
        w.simplified_hanzi.includes(q) ||
        w.pinyin.toLowerCase().includes(q) ||
        w.german.toLowerCase().includes(q)
    );
  }, [allVocabulary, vocabSearch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVocabHanzi.trim() || !newVocabPinyin.trim() || !newVocabGerman.trim()) return;
    await onAddVocabulary(
      newVocabHanzi.trim(),
      newVocabPinyin.trim(),
      newVocabGerman.trim()
    );
    setNewVocabHanzi('');
    setNewVocabPinyin('');
    setNewVocabGerman('');
  };

  const strugglingCount = useMemo(
    () => allVocabulary.filter((w) => w.streak === 0).length,
    [allVocabulary]
  );

  return (
    <section aria-label="Vokabeln">
      <div className="vocab-mode-bar">
        <div className="partner-pills" role="tablist" aria-label="Vokabel-Ansicht">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'trainer'}
            className={`partner-pill ${mode === 'trainer' ? 'active' : ''}`}
            onClick={() => setMode('trainer')}
          >
            <GraduationCap size={15} aria-hidden="true" />
            Vokabeltrainer ({dueVocabulary.length} fällig)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'list'}
            className={`partner-pill ${mode === 'list' ? 'active' : ''}`}
            onClick={() => setMode('list')}
          >
            <List size={15} aria-hidden="true" />
            Alle Vokabeln ({allVocabulary.length})
          </button>
        </div>
      </div>

      {mode === 'trainer' ? (
        <div className="panel-card trainer-shell">
          <div className="trainer-controls">
            <div className="partner-pills" role="group" aria-label="Karten-Auswahl">
              <button
                type="button"
                className={`partner-pill ${deckFilter === 'due' ? 'active' : ''}`}
                onClick={() => resetTrainer('due')}
              >
                Fällig ({dueVocabulary.length})
              </button>
              <button
                type="button"
                className={`partner-pill ${deckFilter === 'weak_random' ? 'active' : ''}`}
                onClick={() => {
                  setWeakRandomSeed((s) => s + 1);
                  resetTrainer('weak_random');
                }}
              >
                Zufällig (noch unsicher)
              </button>
              <button
                type="button"
                className={`partner-pill ${deckFilter === 'struggling' ? 'active' : ''}`}
                onClick={() => resetTrainer('struggling')}
              >
                Neu / Schwierig ({strugglingCount})
              </button>
              <button
                type="button"
                className={`partner-pill ${deckFilter === 'all' ? 'active' : ''}`}
                onClick={() => resetTrainer('all')}
              >
                Alle ({allVocabulary.length})
              </button>
            </div>

            {deckFilter === 'weak_random' && (
              <div className="partner-pills" role="group" aria-label="Anzahl Karten">
                {[10, 20, 30].map((size) => (
                  <button
                    key={size}
                    type="button"
                    className={`partner-pill ${weakBatchSize === size ? 'active' : ''}`}
                    onClick={() => {
                      setWeakBatchSize(size);
                      resetTrainer('weak_random');
                    }}
                  >
                    {size} Wörter
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="partner-pill"
                onClick={() => {
                  setDirection((d) => (d === 'zh-to-de' ? 'de-to-zh' : 'zh-to-de'));
                  setIsRevealed(false);
                }}
              >
                {direction === 'zh-to-de' ? 'Chinesisch → Deutsch' : 'Deutsch → Chinesisch'}
              </button>
              <button
                type="button"
                className={`partner-pill ${showPinyin ? 'active' : ''}`}
                onClick={() => setShowPinyin((p) => !p)}
              >
                Pinyin: {showPinyin ? 'An' : 'Aus'}
              </button>
              <button
                type="button"
                className={`partner-pill ${voiceMode ? 'active' : ''}`}
                onClick={() => {
                  setVoiceMode((v) => !v);
                  setPronunciationResult(null);
                  setPronunciationError('');
                }}
              >
                <Mic size={14} aria-hidden="true" />
                Sprach-Modus: {voiceMode ? 'An' : 'Aus'}
              </button>
              <button
                type="button"
                className="partner-pill"
                onClick={() => {
                  if (deckFilter === 'weak_random') {
                    setWeakRandomSeed((s) => s + 1);
                  } else {
                    setShuffleSeed((s) => s + 1);
                  }
                  resetTrainer();
                }}
              >
                <Shuffle size={14} aria-hidden="true" />{' '}
                {deckFilter === 'weak_random' ? 'Neue Auswahl' : 'Mischen'}
              </button>
              {onStartVocabQuiz && trainerDeck.length > 0 && (
                <button
                  type="button"
                  className="btn-primary"
                  style={{ padding: '0.35rem 0.8rem', fontSize: '0.82rem' }}
                  onClick={() => {
                    const startIdx = cardIndex < trainerDeck.length ? cardIndex : 0;
                    const quizSlice = trainerDeck.slice(startIdx, startIdx + 10);
                    onStartVocabQuiz(quizSlice.length > 0 ? quizSlice : trainerDeck.slice(0, 10));
                  }}
                  title="Die nächsten bis zu 10 Wörter dieser Auswahl im Live-Gespräch abfragen lassen"
                >
                  <PhoneCall size={14} aria-hidden="true" /> Mit Lehrerin üben
                </button>
              )}
            </div>
          </div>

          {trainerDeck.length === 0 ? (
            <div className="trainer-empty">
              <p>Keine Karten in dieser Auswahl vorhanden.</p>
              <button type="button" className="btn-primary" onClick={() => resetTrainer('all')}>
                Alle Vokabeln üben
              </button>
            </div>
          ) : isDeckDone ? (
            <div className="trainer-empty">
              <h3 style={{ margin: 0 }}>Runde abgeschlossen!</h3>
              <p style={{ color: 'var(--text-muted)' }}>
                Du hast {sessionCompleted} Karten geübt ({sessionKnown} sicher erkannt/gewusst).
              </p>
              <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    if (deckFilter === 'weak_random') {
                      setWeakRandomSeed((s) => s + 1);
                    }
                    resetTrainer();
                  }}
                >
                  <RotateCcw size={15} aria-hidden="true" />{' '}
                  {deckFilter === 'weak_random' ? 'Nächste Zufallsrunde' : 'Nochmal üben'}
                </button>
                <button type="button" onClick={() => resetTrainer('all')}>
                  Alle Vokabeln durchsehen
                </button>
              </div>
            </div>
          ) : (
            currentCard && (
              <div className="trainer-card">
                <div className="trainer-progress">
                  <span className="badge badge-gold">
                    Karte {cardIndex + 1} von {trainerDeck.length}
                  </span>
                  {voiceMode && <span className="badge badge-emerald">Sprach-Modus aktiv</span>}
                </div>

                <div className="trainer-front">
                  {direction === 'zh-to-de' ? (
                    <>
                      <div className="trainer-hanzi" lang="zh-Hans">
                        {currentCard.simplified_hanzi}
                      </div>
                      {showPinyin && <div className="trainer-pinyin">{currentCard.pinyin}</div>}
                    </>
                  ) : (
                    <>
                      <div className="trainer-german-prompt">{currentCard.german}</div>
                      {showPinyin && <div className="trainer-pinyin">{currentCard.pinyin}</div>}
                    </>
                  )}
                </div>

                <div className="trainer-primary-actions">
                  <button
                    type="button"
                    className="btn-primary btn-listen-hero"
                    onClick={() => speakMandarin(currentCard.simplified_hanzi, setIsAudioPlaying)}
                    title="Mit Gemini-Stimme vorlesen"
                  >
                    <Volume2 size={22} aria-hidden="true" />
                    {isAudioPlaying ? 'Spielt ab...' : 'Anhören'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ padding: '0.65rem 0.85rem', borderRadius: '14px' }}
                    disabled={regeneratingTarget === 'word'}
                    onClick={() =>
                      speakMandarin(currentCard.simplified_hanzi, setIsAudioPlaying, {
                        forceRefresh: true,
                        onRegeneratingChange: (loading) =>
                          setRegeneratingTarget(loading ? 'word' : null),
                      })
                    }
                    title="Audio neu generieren (falls fehlerhaft oder abgeschnitten)"
                    aria-label="Audio neu generieren"
                  >
                    <RefreshCw
                      size={18}
                      className={regeneratingTarget === 'word' ? 'spin' : undefined}
                      aria-hidden="true"
                    />
                  </button>

                  {voiceMode && (
                    <button
                      type="button"
                      className={`btn-listen-hero ${isRecording ? 'btn-danger' : 'btn-secondary'}`}
                      onClick={isRecording ? stopVoiceCheck : startVoiceCheck}
                      disabled={isCheckingPronunciation}
                    >
                      {isRecording ? (
                        <>
                          <Square size={20} aria-hidden="true" /> Stopp &amp; Prüfen
                        </>
                      ) : (
                        <>
                          <Mic size={22} aria-hidden="true" />
                          {isCheckingPronunciation ? 'Prüfe Töne...' : 'Sprechen & Prüfen'}
                        </>
                      )}
                    </button>
                  )}
                </div>

                {pronunciationError && (
                  <div className="error-banner" role="alert" style={{ width: '100%', maxInlineSize: 520, margin: 0 }}>
                    <span>{pronunciationError}</span>
                  </div>
                )}

                {pronunciationResult && (
                  <div className="pronunciation-result-card">
                    <div className="pronunciation-result-header">
                      <span
                        className={`badge ${
                          pronunciationResult.passed ? 'badge-emerald' : 'badge-amber'
                        }`}
                      >
                        {pronunciationResult.passed ? 'Aussprache gut!' : 'Töne noch üben'}
                      </span>
                      <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                        Gehört: <strong lang="zh-Hans">{pronunciationResult.heard_text}</strong>
                      </span>
                    </div>
                    <div style={{ fontSize: '0.88rem' }}>
                      <strong>Töne:</strong> {pronunciationResult.tone_accuracy_de}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {pronunciationResult.tip_de}
                    </div>
                  </div>
                )}

                {!isRevealed ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ padding: '0.55rem 1.25rem' }}
                    onClick={() => setIsRevealed(true)}
                  >
                    <Eye size={16} aria-hidden="true" /> Antwort aufdecken
                  </button>
                ) : (
                  <div className="trainer-back">
                    {direction === 'de-to-zh' && (
                      <div className="trainer-hanzi" lang="zh-Hans">
                        {currentCard.simplified_hanzi}
                      </div>
                    )}
                    <div className="trainer-pinyin">{currentCard.pinyin}</div>
                    {direction === 'zh-to-de' && (
                      <div className="trainer-german-answer">{currentCard.german}</div>
                    )}
                    {currentCard.taiwan_note && (
                      <div className="trainer-note">Hinweis: {currentCard.taiwan_note}</div>
                    )}
                    {currentCard.example_hanzi && (
                      <div className="vocab-example" style={{ marginBlockStart: '0.65rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                          <span lang="zh-Hans">{currentCard.example_hanzi}</span>
                          <button
                            type="button"
                            className="btn-back-home"
                            style={{ padding: '0.15rem 0.45rem', fontSize: '0.75rem' }}
                            onClick={() =>
                              speakMandarin(currentCard.example_hanzi!, setIsAudioPlaying)
                            }
                            title="Beispielsatz vorlesen"
                          >
                            <Volume2 size={13} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="btn-back-home"
                            style={{ padding: '0.15rem 0.45rem', fontSize: '0.75rem' }}
                            disabled={regeneratingTarget === 'example'}
                            onClick={() =>
                              speakMandarin(currentCard.example_hanzi!, setIsAudioPlaying, {
                                forceRefresh: true,
                                onRegeneratingChange: (loading) =>
                                  setRegeneratingTarget(loading ? 'example' : null),
                              })
                            }
                            title="Beispielsatz-Audio neu generieren"
                            aria-label="Beispielsatz-Audio neu generieren"
                          >
                            <RefreshCw
                              size={12}
                              className={regeneratingTarget === 'example' ? 'spin' : undefined}
                              aria-hidden="true"
                            />
                          </button>
                        </div>
                        {currentCard.example_pinyin && <div>{currentCard.example_pinyin}</div>}
                        {currentCard.example_de && <div>{currentCard.example_de}</div>}
                      </div>
                    )}

                    <div className="trainer-rating-row">
                      <button
                        type="button"
                        className="btn-danger"
                        onClick={() => handleRateCard('forgotten')}
                      >
                        Vergessen (Nochmal)
                      </button>
                      <button type="button" onClick={() => handleRateCard('recognized')}>
                        Erkannt
                      </button>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => handleRateCard('used_actively')}
                      >
                        <CheckCircle2 size={15} aria-hidden="true" /> Sicher gewusst!
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          )}
        </div>
      ) : (
        <>
          <div className="two-col-grid" style={{ marginBlockEnd: '1.25rem' }}>
            <div className="panel-card">
              <h2>Neues Wort speichern</h2>
              <form onSubmit={handleSubmit}>
                <div className="input-row">
                  <input
                    type="text"
                    placeholder="Hanzi (简体)"
                    value={newVocabHanzi}
                    onChange={(e) => setNewVocabHanzi(e.target.value)}
                    required
                  />
                  <input
                    type="text"
                    placeholder="Pinyin"
                    value={newVocabPinyin}
                    onChange={(e) => setNewVocabPinyin(e.target.value)}
                    required
                  />
                </div>
                <div className="input-row" style={{ marginBlockEnd: 0 }}>
                  <input
                    type="text"
                    placeholder="Deutsche Bedeutung"
                    value={newVocabGerman}
                    onChange={(e) => setNewVocabGerman(e.target.value)}
                    required
                  />
                  <button type="submit" className="btn-primary">
                    <Plus size={16} aria-hidden="true" /> Speichern
                  </button>
                </div>
              </form>
            </div>

            <div className="panel-card">
              <h2>Vokabeln durchsuchen</h2>
              <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)', marginBlockStart: 0 }}>
                {dueVocabulary.length} Wörter stehen aktuell zur Wiederholung im Gespräch an.
              </p>
              <search>
                <input
                  type="search"
                  aria-label="Vokabeln durchsuchen"
                  placeholder="Suche nach Hanzi, Pinyin oder Deutsch..."
                  value={vocabSearch}
                  onChange={(e) => setVocabSearch(e.target.value)}
                  style={{ width: '100%' }}
                />
              </search>
            </div>
          </div>

          <div className="two-col-grid">
            {filteredVocab.map((w) => (
              <article key={w.id} className="panel-card">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: '0.5rem',
                  }}
                >
                  <div>
                    <span className="vocab-hanzi" lang="zh-Hans">
                      {w.simplified_hanzi}
                    </span>
                    <span className="vocab-pinyin">{w.pinyin}</span>
                  </div>
                  <span className="badge badge-emerald">
                    Aktiv: {w.times_used_actively}x · Verstanden: {w.times_recognized}x
                  </span>
                </div>

                <div className="vocab-german" style={{ marginBlock: '0.3rem' }}>
                  {w.german}
                </div>
                {w.example_hanzi && (
                  <div className="vocab-example">
                    <div lang="zh-Hans">{w.example_hanzi}</div>
                    {w.example_pinyin && <div>{w.example_pinyin}</div>}
                    {w.example_de && <div>{w.example_de}</div>}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.4rem', marginBlockStart: '0.7rem' }}>
                  <button
                    type="button"
                    style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}
                    onClick={() => onReviewVocabulary(w.simplified_hanzi, 'used_actively')}
                  >
                    <CheckCircle2 size={14} aria-hidden="true" /> Sitzt sicher
                  </button>
                  <button
                    type="button"
                    style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}
                    onClick={() => onReviewVocabulary(w.simplified_hanzi, 'forgotten')}
                  >
                    Wiederholen
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
