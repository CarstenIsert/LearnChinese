import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Brain, GraduationCap, Home, PhoneCall, Sparkles } from 'lucide-react';
import { LiveAudioManager } from './audio.ts';
import { AuthView } from './components/AuthView.tsx';
import { FreeTalkView } from './components/FreeTalkView.tsx';
import { HomeView } from './components/HomeView.tsx';
import { InviteDialog } from './components/InviteDialog.tsx';
import { MemoryView } from './components/MemoryView.tsx';
import { OnboardingDialog } from './components/OnboardingDialog.tsx';
import { PersonaEditorDialog } from './components/PersonaEditorDialog.tsx';
import { ScenariosView } from './components/ScenariosView.tsx';
import { SessionRecapDialog } from './components/SessionRecapDialog.tsx';
import { UserMenu } from './components/UserMenu.tsx';
import { VocabularyView } from './components/VocabularyView.tsx';
import { useTopicAndCurriculum } from './hooks/useTopicAndCurriculum.ts';
import {
  AuthStatusResponse,
  AuthUser,
  BootstrapData,
  CurriculumScenario,
  Persona,
  SessionReflection,
  TranscriptTurn,
  VocabularyWord,
} from './types.ts';

type ActiveTab = 'home' | 'talk' | 'vocab' | 'curriculum' | 'memory';

export default function App() {
  const [authStatus, setAuthStatus] = useState<'loading' | 'unauthenticated' | 'authenticated'>('loading');
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [requiresBootstrapAdmin, setRequiresBootstrapAdmin] = useState<boolean>(false);
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState<boolean>(false);
  const inviteDialogRef = useRef<HTMLDialogElement | null>(null);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState<boolean>(false);
  const onboardingDialogRef = useRef<HTMLDialogElement | null>(null);
  const [isPersonaEditorOpen, setIsPersonaEditorOpen] = useState<boolean>(false);
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);
  const personaEditorDialogRef = useRef<HTMLDialogElement | null>(null);
  const hasAutoOpenedOnboardingRef = useRef<boolean>(false);

  const [data, setData] = useState<BootstrapData | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('');
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('');

  // Call state
  const [callState, setCallState] = useState<'idle' | 'connecting' | 'in_call' | 'analyzing'>('idle');
  const [callDurationSeconds, setCallDurationSeconds] = useState<number>(0);
  const [enableToneAnalysis, setEnableToneAnalysis] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [micLevel, setMicLevel] = useState<number>(0);
  const [aiSpeaking, setAiSpeaking] = useState<boolean>(false);

  // Live Vocab Popups & Blurred Transcript
  const [liveVocabPopups, setLiveVocabPopups] = useState<VocabularyWord[]>([]);
  const [vocabQuizWords, setVocabQuizWords] = useState<VocabularyWord[]>([]);
  const [vocabQuizReviewed, setVocabQuizReviewed] = useState<
    Record<string, 'used_actively' | 'recognized' | 'forgotten'>
  >({});
  const [transcriptTurns, setTranscriptTurns] = useState<TranscriptTurn[]>([]);
  const [liveDraftUser, setLiveDraftUser] = useState<string>('');
  const [liveDraftAi, setLiveDraftAi] = useState<string>('');
  const [isTranscriptRevealed, setIsTranscriptRevealed] = useState<boolean>(false);
  const [memoryToast, setMemoryToast] = useState<string | null>(null);

  // Post-session recap modal
  const [lastRecap, setLastRecap] = useState<SessionReflection | null>(null);
  const recapDialogRef = useRef<HTMLDialogElement | null>(null);

  // WebSocket, Audio & Toast Timer refs
  const wsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<LiveAudioManager | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((message: string, durationMs = 4200) => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    setMemoryToast(message);
    toastTimerRef.current = window.setTimeout(() => {
      setMemoryToast(null);
      toastTimerRef.current = null;
    }, durationMs);
  }, []);

  const fetchBootstrap = useCallback(async () => {
    try {
      const res = await fetch('/api/bootstrap');
      if (res.status === 401) {
        setAuthStatus('unauthenticated');
        setData(null);
        return;
      }
      if (!res.ok) throw new Error('Backend nicht erreichbar');
      const json = (await res.json()) as BootstrapData;
      setData(json);
      setSelectedPersonaId((prev) => {
        if (prev && json.personas.some((p) => p.id === prev)) return prev;
        return json.personas[0]?.id || '';
      });
      if (!hasAutoOpenedOnboardingRef.current && json.profile?.onboarding_completed === 0) {
        hasAutoOpenedOnboardingRef.current = true;
        window.setTimeout(() => {
          setIsOnboardingOpen(true);
          if (onboardingDialogRef.current && !onboardingDialogRef.current.open) {
            onboardingDialogRef.current.showModal();
          }
        }, 120);
      }
    } catch (err: any) {
      setErrorMessage(
        `Backend-Server nicht erreichbar (${err?.message || 'Verbindungsfehler'}).`
      );
    }
  }, []);

  const checkAuthAndBootstrap = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      const auth = (await res.json()) as AuthStatusResponse;
      setRequiresBootstrapAdmin(Boolean(auth.requiresBootstrapAdmin));

      if (auth.authenticated && auth.user) {
        setCurrentUser(auth.user);
        setAuthStatus('authenticated');
        await fetchBootstrap();
      } else if (!auth.authEnforced) {
        setCurrentUser(null);
        setAuthStatus('authenticated');
        await fetchBootstrap();
      } else {
        setCurrentUser(null);
        setAuthStatus('unauthenticated');
      }
    } catch (err: any) {
      setAuthStatus('authenticated');
      setErrorMessage(
        `Backend-Server nicht erreichbar (${err?.message || 'Verbindungsfehler'}).`
      );
    }
  }, [fetchBootstrap]);

  useEffect(() => {
    checkAuthAndBootstrap();
  }, [checkAuthAndBootstrap]);

  const handleLogout = useCallback(async () => {
    audioRef.current?.stopAll();
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close();
    }
    setCallState('idle');
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    hasAutoOpenedOnboardingRef.current = false;
    setCurrentUser(null);
    setData(null);
    setAuthStatus('unauthenticated');
  }, []);

  // Live call duration timer
  useEffect(() => {
    if (callState !== 'in_call') return;
    setCallDurationSeconds(0);
    const id = window.setInterval(() => {
      setCallDurationSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [callState]);

  // Clean up microphone, audio playback, WebSocket, and timers on unmount
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      audioRef.current?.stopAll();
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    };
  }, []);

  const {
    suggestedTopic,
    isShufflingTopic,
    shuffleTopic,
    cancelPendingTopicFetch,
    expandCurriculum: handleExpandCurriculum,
  } = useTopicAndCurriculum({
    data,
    selectedPersonaId,
    setData,
    setSelectedScenarioId,
    showToast,
  });

  const startCall = useCallback(
    async (
      personaIdOverride?: string,
      scenarioIdOverride?: string,
      vocabQuizOverride?: VocabularyWord[]
    ) => {
      cancelPendingTopicFetch();
      const targetPersonaId = personaIdOverride || selectedPersonaId || data?.personas[0]?.id || '';
      const activeQuizWords =
        vocabQuizOverride && vocabQuizOverride.length > 0 ? vocabQuizOverride.slice(0, 15) : [];
      const targetScenarioId =
        activeQuizWords.length > 0
          ? ''
          : scenarioIdOverride !== undefined
          ? scenarioIdOverride
          : selectedScenarioId;

      setSelectedPersonaId(targetPersonaId);
      setSelectedScenarioId(targetScenarioId);
      setVocabQuizWords(activeQuizWords);
      setVocabQuizReviewed({});
      setActiveTab('talk');
      setErrorMessage('');
      setTranscriptTurns([]);
      setLiveDraftUser('');
      setLiveDraftAi('');
      setLiveVocabPopups([]);
      setIsTranscriptRevealed(false);

      if (data && !data.hasApiKey) {
        setErrorMessage(
          'GEMINI_API_KEY fehlt oder ist ungültig. Bitte prüfe deine lokale .env Datei.'
        );
        return;
      }

      try {
        setCallState('connecting');
        setStatusMessage('Verbinde...');

        const audioManager = new LiveAudioManager();
        audioRef.current = audioManager;

        audioManager.onVolumeChange = (vol, speaking) => {
          setMicLevel(vol);
          setAiSpeaking(speaking);
        };

        await audioManager.startMicrophone();

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/live`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        audioManager.onAudioInputChunk = (base64Pcm) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'audio_input', data: base64Pcm }));
          }
        };

        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              type: 'start_session',
              personaId: targetPersonaId,
              scenarioId: targetScenarioId || undefined,
              topic: targetScenarioId || activeQuizWords.length > 0 ? undefined : suggestedTopic,
              vocabQuizWords:
                activeQuizWords.length > 0
                  ? activeQuizWords.map((w) => ({
                      simplified_hanzi: w.simplified_hanzi,
                      pinyin: w.pinyin,
                      german: w.german,
                    }))
                  : undefined,
              enableToneAnalysis,
            })
          );
        };

        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data);

          if (msg.type === 'session_started') {
            setCallState('in_call');
            setStatusMessage('Verbunden — sprich einfach drauflos (Chinesisch oder Deutsch).');
          } else if (msg.type === 'audio_chunk') {
            audioManager.playPcm24kChunk(msg.data);
          } else if (msg.type === 'interrupted') {
            audioManager.interruptPlayback();
          } else if (msg.type === 'transcript_delta') {
            if (msg.speaker === 'user') {
              setLiveDraftUser(msg.fullTurnText || '');
            } else {
              setLiveDraftAi(msg.fullTurnText || '');
            }
          } else if (msg.type === 'transcript_turn_complete') {
            if (msg.speaker === 'user') {
              setLiveDraftUser('');
            } else {
              setLiveDraftAi('');
            }
            setTranscriptTurns((prev) => [...prev, { speaker: msg.speaker, text: msg.text }]);
          } else if (msg.type === 'vocab_card_popup' && msg.word) {
            setLiveVocabPopups((prev) => {
              const filtered = prev.filter(
                (w) => w.simplified_hanzi !== msg.word.simplified_hanzi
              );
              return [msg.word, ...filtered];
            });
            fetchBootstrap();
          } else if (msg.type === 'vocab_review_recorded') {
            setVocabQuizReviewed((prev) => ({
              ...prev,
              [msg.simplified_hanzi]: msg.outcome,
            }));
            showToast(
              `Vokabel: ${msg.simplified_hanzi} (${
                msg.outcome === 'used_actively'
                  ? 'Aktiv genutzt!'
                  : msg.outcome === 'recognized'
                  ? 'Verstanden!'
                  : 'Wiederholen'
              })`
            );
            fetchBootstrap();
          } else if (msg.type === 'memory_saved_toast' && msg.fact) {
            showToast(`Erinnerung gespeichert: "${msg.fact.fact}"`, 4800);
            fetchBootstrap();
          } else if (msg.type === 'analyzing_session') {
            setCallState('analyzing');
            setStatusMessage(msg.message || 'Gespräch wird ausgewertet...');
          } else if (msg.type === 'session_recap') {
            audioManager.stopAll();
            setCallState('idle');
            setLastRecap(msg.reflection);
            fetchBootstrap();
            window.setTimeout(() => {
              if (recapDialogRef.current && !recapDialogRef.current.open) {
                recapDialogRef.current.showModal();
              }
            }, 80);
          } else if (msg.type === 'error') {
            setErrorMessage(msg.message || 'Fehler bei der Verbindung zum Sprachmodell.');
            audioManager.stopAll();
            setCallState('idle');
          }
        };

        ws.onerror = () => {
          setErrorMessage('WebSocket-Verbindungsfehler zum lokalen Server.');
          audioManager.stopAll();
          setCallState('idle');
        };
      } catch (err: any) {
        setErrorMessage(
          `Mikrofon- oder Verbindungsfehler: ${err?.message || 'Bitte Mikrofonzugriff erlauben.'}`
        );
        audioRef.current?.stopAll();
        setCallState('idle');
      }
    },
    [
      cancelPendingTopicFetch,
      data,
      enableToneAnalysis,
      fetchBootstrap,
      selectedPersonaId,
      selectedScenarioId,
      showToast,
      suggestedTopic,
    ]
  );

  const endCall = useCallback(() => {
    audioRef.current?.stopAll();
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      setCallState('analyzing');
      setStatusMessage('Gespräch wird ausgewertet & Erinnerungen aktualisiert...');
      wsRef.current.send(JSON.stringify({ type: 'end_session' }));
    } else {
      setCallState('idle');
    }
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      audioRef.current?.setMuted(next);
      return next;
    });
  }, []);

  const handleRequestGermanHelp = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'text_input',
          text: 'Ich habe das nicht verstanden. Bitte nenne mir die chinesischen Wörter/Begriffe einzeln, erkläre sie mir klar auf Deutsch (und zeige sie als Vokabelkarte), und wiederhole den Satz danach noch einmal langsam auf Chinesisch.',
        })
      );
    }
  }, []);

  const handleChangeComplexity = useCallback(
    async (preference: 'auto' | 'short' | 'medium' | 'natural') => {
      await fetch('/api/profile/complexity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preference }),
      });
      await fetchBootstrap();
    },
    [fetchBootstrap]
  );

  const handleAddMemoryFact = useCallback(
    async (category: string, fact: string) => {
      await fetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, fact }),
      });
      await fetchBootstrap();
    },
    [fetchBootstrap]
  );

  const handleDeleteMemoryFact = useCallback(
    async (id: number) => {
      await fetch(`/api/memories/${id}`, { method: 'DELETE' });
      await fetchBootstrap();
    },
    [fetchBootstrap]
  );

  const handleAddVocabulary = useCallback(
    async (simplifiedHanzi: string, pinyin: string, german: string) => {
      await fetch('/api/vocabulary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          simplified_hanzi: simplifiedHanzi,
          pinyin,
          german,
        }),
      });
      await fetchBootstrap();
    },
    [fetchBootstrap]
  );

  const handleManualVocabReview = useCallback(
    async (
      simplifiedHanzi: string,
      outcome: 'used_actively' | 'recognized' | 'forgotten'
    ) => {
      await fetch('/api/vocabulary/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simplified_hanzi: simplifiedHanzi, outcome }),
      });
      await fetchBootstrap();
    },
    [fetchBootstrap]
  );

  if (authStatus === 'loading') {
    return (
      <main className="app-shell">
        <p>Lade CAI Labs Learn Chinese...</p>
      </main>
    );
  }

  if (authStatus === 'unauthenticated') {
    return (
      <AuthView
        requiresBootstrapAdmin={requiresBootstrapAdmin}
        onAuthenticated={(user) => {
          setCurrentUser(user);
          setRequiresBootstrapAdmin(false);
          setAuthStatus('authenticated');
          setErrorMessage('');
          fetchBootstrap();
        }}
      />
    );
  }

  if (!data) {
    return (
      <main className="app-shell">
        {errorMessage ? (
          <div className="error-banner" role="alert">
            <span>{errorMessage}</span>
          </div>
        ) : (
          <p>Lade CAI Labs Learn Chinese...</p>
        )}
      </main>
    );
  }

  const selectedPersona: Persona =
    data.personas.find((p) => p.id === selectedPersonaId) || data.personas[0];
  const selectedScenario: CurriculumScenario | undefined = data.scenarios.find(
    (s) => s.id === selectedScenarioId
  );

  const isInActiveCall = activeTab === 'talk' && callState !== 'idle';
  const navItems: Array<{
    id: ActiveTab;
    desktopLabel: string;
    mobileLabel: string;
    Icon: typeof Home;
    badgeCount?: number;
  }> = [
    { id: 'home', desktopLabel: 'Startseite', mobileLabel: 'Start', Icon: Home },
    { id: 'talk', desktopLabel: 'Free Talk', mobileLabel: 'Sprechen', Icon: PhoneCall },
    {
      id: 'vocab',
      desktopLabel: `Vokabeln (${data.dueVocabulary.length} fällig)`,
      mobileLabel: 'Vokabeln',
      Icon: BookOpen,
      badgeCount: data.dueVocabulary.length,
    },
    {
      id: 'curriculum',
      desktopLabel: `Themen (${data.scenarios.length})`,
      mobileLabel: 'Themen',
      Icon: GraduationCap,
    },
    {
      id: 'memory',
      desktopLabel: `Gedächtnis (${data.memoryFacts.length})`,
      mobileLabel: 'Gedächtnis',
      Icon: Brain,
    },
  ];

  return (
    <div className={`app-shell${isInActiveCall ? ' is-in-call' : ''}`}>
      <header className="top-header">
        <div className="header-top-row">
          <button
            type="button"
            className="brand-button"
            aria-label="Zurück zur Startseite"
            onClick={() => setActiveTab('home')}
          >
            <img src="/logo.png" alt="C.AI Labs" className="brand-logo" width={38} height={38} />
            <div className="brand-text">
              <h1 className="brand-title">CAI Labs Learn Chinese</h1>
              <span className="brand-subtitle" lang="zh-Hans">
                中文对话
              </span>
            </div>
          </button>

          {currentUser && (
            <UserMenu
              user={currentUser}
              onOpenOnboarding={() => {
                setIsOnboardingOpen(true);
                onboardingDialogRef.current?.showModal();
              }}
              onOpenInvites={() => {
                setIsInviteDialogOpen(true);
                inviteDialogRef.current?.showModal();
              }}
              onLogout={handleLogout}
            />
          )}
        </div>

        <nav className="tab-nav" aria-label="Hauptnavigation">
          {navItems.map(({ id, desktopLabel, Icon }) => (
            <button
              key={id}
              type="button"
              className="btn-tab"
              aria-current={activeTab === id ? 'page' : undefined}
              onClick={() => setActiveTab(id)}
            >
              <Icon size={15} aria-hidden="true" />
              {desktopLabel}
            </button>
          ))}
        </nav>
      </header>

      {!data.hasApiKey && (
        <div className="error-banner" role="alert">
          <span>
            GEMINI_API_KEY wurde nicht gefunden oder funktioniert nicht. Bitte prüfe deine lokale{' '}
            <code>.env</code> Datei.
          </span>
        </div>
      )}

      {errorMessage && (
        <div className="error-banner" role="alert">
          <span>{errorMessage}</span>
          <button type="button" onClick={() => setErrorMessage('')}>
            Schließen
          </button>
        </div>
      )}

      {memoryToast && (
        <div className="toast-banner" role="status">
          <span>
            <Sparkles size={15} aria-hidden="true" /> {memoryToast}
          </span>
        </div>
      )}

      <main>
        {activeTab === 'home' && (
          <HomeView
            profile={data.profile}
            stats={data.stats}
            personas={data.personas}
            scenarios={data.scenarios}
            recentSessions={data.recentSessions}
            memoryFactsCount={data.memoryFacts.length}
            selectedPersonaId={selectedPersona.id}
            onSelectPersona={(id) => {
              setSelectedPersonaId(id);
              if (selectedScenario && selectedScenario.persona_id !== id) {
                setSelectedScenarioId('');
              }
            }}
            onStartFreeTalk={() => {
              setActiveTab('talk');
              startCall();
            }}
            onNavigate={(tab) => setActiveTab(tab)}
            onChangeComplexity={handleChangeComplexity}
            onOpenOnboarding={() => {
              setIsOnboardingOpen(true);
              onboardingDialogRef.current?.showModal();
            }}
          />
        )}

        {activeTab === 'talk' && (
          <FreeTalkView
            personas={data.personas}
            selectedPersona={selectedPersona}
            selectedScenario={selectedScenario}
            suggestedTopic={suggestedTopic}
            isShufflingTopic={isShufflingTopic}
            callState={callState}
            callDurationSeconds={callDurationSeconds}
            enableToneAnalysis={enableToneAnalysis}
            onToggleToneAnalysis={() => setEnableToneAnalysis((v) => !v)}
            statusMessage={statusMessage}
            isMuted={isMuted}
            micLevel={micLevel}
            aiSpeaking={aiSpeaking}
            liveVocabPopups={liveVocabPopups}
            dueVocabulary={data.dueVocabulary}
            vocabQuizWords={vocabQuizWords}
            vocabQuizReviewed={vocabQuizReviewed}
            transcriptTurns={transcriptTurns}
            liveDraftUser={liveDraftUser}
            liveDraftAi={liveDraftAi}
            isTranscriptRevealed={isTranscriptRevealed}
            onBackHome={() => setActiveTab('home')}
            onSelectPersona={(id) => {
              setSelectedPersonaId(id);
              if (selectedScenario && selectedScenario.persona_id !== id) {
                setSelectedScenarioId('');
              }
            }}
            onShuffleTopic={shuffleTopic}
            onStartCall={() => startCall()}
            onEndCall={endCall}
            onToggleMute={toggleMute}
            onRequestGermanHelp={handleRequestGermanHelp}
            onToggleTranscript={() => setIsTranscriptRevealed((r) => !r)}
          />
        )}

        {activeTab === 'vocab' && (
          <VocabularyView
            allVocabulary={data.allVocabulary}
            dueVocabulary={data.dueVocabulary}
            dueCount={data.dueVocabulary.length}
            onAddVocabulary={handleAddVocabulary}
            onReviewVocabulary={handleManualVocabReview}
            onStartVocabQuiz={(words) => startCall(undefined, '', words)}
          />
        )}

        {activeTab === 'curriculum' && (
          <ScenariosView
            scenarios={data.scenarios}
            remainingCurated={data.curriculumMeta?.remainingCurated ?? 0}
            hasApiKey={data.hasApiKey}
            onStartScenario={(personaId, scenarioId) => startCall(personaId, scenarioId)}
            onExpandCurriculum={handleExpandCurriculum}
          />
        )}

        {activeTab === 'memory' && (
          <MemoryView
            personas={data.personas}
            memoryFacts={data.memoryFacts}
            recentEpisodes={data.recentEpisodes}
            skills={data.skills}
            onAddMemoryFact={handleAddMemoryFact}
            onDeleteMemoryFact={handleDeleteMemoryFact}
            onOpenPersonaEditor={(persona) => {
              setEditingPersona(persona ?? null);
              setIsPersonaEditorOpen(true);
              personaEditorDialogRef.current?.showModal();
            }}
            onDeletePersona={async (personaId) => {
              const res = await fetch(`/api/personas/${encodeURIComponent(personaId)}`, {
                method: 'DELETE',
              });
              const json = await res.json();
              if (!res.ok) {
                setErrorMessage(json.error || 'Person konnte nicht gelöscht werden.');
                return;
              }
              showToast('Person entfernt.');
              await fetchBootstrap();
            }}
            onOpenOnboarding={() => {
              setIsOnboardingOpen(true);
              onboardingDialogRef.current?.showModal();
            }}
          />
        )}
      </main>

      <SessionRecapDialog dialogRef={recapDialogRef} recap={lastRecap} />
      <InviteDialog
        dialogRef={inviteDialogRef}
        isOpen={isInviteDialogOpen}
        onClose={() => setIsInviteDialogOpen(false)}
      />
      <OnboardingDialog
        dialogRef={onboardingDialogRef}
        isOpen={isOnboardingOpen}
        hasApiKey={data.hasApiKey}
        profile={data.profile}
        personas={data.personas}
        onClose={() => setIsOnboardingOpen(false)}
        onRefreshBootstrap={fetchBootstrap}
        onOpenPersonaEditor={(persona) => {
          setEditingPersona(persona ?? null);
          setIsPersonaEditorOpen(true);
          personaEditorDialogRef.current?.showModal();
        }}
      />
      <PersonaEditorDialog
        dialogRef={personaEditorDialogRef}
        isOpen={isPersonaEditorOpen}
        editingPersona={editingPersona}
        onClose={() => {
          setIsPersonaEditorOpen(false);
          setEditingPersona(null);
        }}
        onSaved={async (saved) => {
          showToast(`${saved.avatar_emoji} ${saved.name_hanzi} gespeichert.`);
          await fetchBootstrap();
        }}
      />
      {!isInActiveCall && (
        <nav className="mobile-bottom-nav" aria-label="Mobile Navigation">
          {navItems.map(({ id, mobileLabel, Icon, badgeCount }) => (
            <button
              key={id}
              type="button"
              className="mobile-nav-btn"
              aria-current={activeTab === id ? 'page' : undefined}
              onClick={() => setActiveTab(id)}
            >
              <span className="mobile-nav-icon-wrap">
                <Icon size={20} aria-hidden="true" />
                {badgeCount !== undefined && badgeCount > 0 && (
                  <span className="mobile-nav-badge" aria-label={`${badgeCount} fällig`}>
                    {badgeCount > 99 ? '99+' : badgeCount}
                  </span>
                )}
              </span>
              <span>{mobileLabel}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
