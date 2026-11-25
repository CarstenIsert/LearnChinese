import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Brain, GraduationCap, Home, PhoneCall, Sparkles } from 'lucide-react';
import { apiFetch, getErrorMessage } from './api.ts';
import { AuthView } from './components/AuthView.tsx';
import { DeleteAccountDialog } from './components/DeleteAccountDialog.tsx';
import { FreeTalkView } from './components/FreeTalkView.tsx';
import { HomeView } from './components/HomeView.tsx';
import { InviteDialog } from './components/InviteDialog.tsx';
import { LegalDialog, LegalTab } from './components/LegalDialog.tsx';
import { MemoryView } from './components/MemoryView.tsx';
import { OnboardingDialog } from './components/OnboardingDialog.tsx';
import { PersonaEditorDialog } from './components/PersonaEditorDialog.tsx';
import { ScenariosView } from './components/ScenariosView.tsx';
import { SessionRecapDialog } from './components/SessionRecapDialog.tsx';
import { UserMenu } from './components/UserMenu.tsx';
import { VocabularyView } from './components/VocabularyView.tsx';
import { useLiveVoiceSession } from './hooks/useLiveVoiceSession.ts';
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
  const [isLegalDialogOpen, setIsLegalDialogOpen] = useState<boolean>(false);
  const [legalTab, setLegalTab] = useState<LegalTab>('impressum');
  const legalDialogRef = useRef<HTMLDialogElement | null>(null);
  const deleteAccountDialogRef = useRef<HTMLDialogElement | null>(null);
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
  const callStateRef = useRef<'idle' | 'connecting' | 'in_call' | 'analyzing'>('idle');
  callStateRef.current = callState;
  const [enableToneAnalysis, setEnableToneAnalysis] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

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

  // Toast timer & shared live voice session hook
  const toastTimerRef = useRef<number | null>(null);
  const {
    orbWrapperRef,
    orbCircleRef,
    isMuted,
    startSession,
    stopSession,
    sendJson,
    toggleMute,
    markIntentionalClose,
  } = useLiveVoiceSession();

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
        setIsOnboardingOpen(true);
      }
    } catch (err: unknown) {
      setErrorMessage(
        `Backend-Server nicht erreichbar (${getErrorMessage(err, 'Verbindungsfehler')}).`
      );
    }
  }, []);

  const checkAuthAndBootstrap = useCallback(async () => {
    try {
      const auth = await apiFetch<AuthStatusResponse>('/api/auth/me').catch(async () => {
        const res = await fetch('/api/auth/me');
        return (await res.json()) as AuthStatusResponse;
      });
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
    } catch (err: unknown) {
      setAuthStatus('authenticated');
      setErrorMessage(
        `Backend-Server nicht erreichbar (${getErrorMessage(err, 'Verbindungsfehler')}).`
      );
    }
  }, [fetchBootstrap]);

  useEffect(() => {
    checkAuthAndBootstrap();
  }, [checkAuthAndBootstrap]);

  const openLegalDialog = useCallback((tab: LegalTab) => {
    setLegalTab(tab);
    setIsLegalDialogOpen(true);
  }, []);

  const handleLogout = useCallback(async () => {
    stopSession();
    setCallState('idle');
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    hasAutoOpenedOnboardingRef.current = false;
    setCurrentUser(null);
    setData(null);
    setAuthStatus('unauthenticated');
  }, [stopSession]);

  // Clean up toast timer on unmount
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
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

      setCallState('connecting');
      setStatusMessage('Verbinde...');

      await startSession({
        startPayload: {
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
        },
        onMessage: (msg) => {
          if (msg.type === 'session_started') {
            setCallState('in_call');
            setStatusMessage('Verbunden — sprich einfach drauflos (Chinesisch oder Deutsch).');
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
            setData((prev) => {
              if (!prev) return prev;
              const exists = prev.allVocabulary.some(
                (w) => w.simplified_hanzi === msg.word.simplified_hanzi
              );
              const nextAll = exists
                ? prev.allVocabulary.map((w) =>
                    w.simplified_hanzi === msg.word.simplified_hanzi ? msg.word : w
                  )
                : [msg.word, ...prev.allVocabulary];
              return { ...prev, allVocabulary: nextAll };
            });
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
            const updatedWord = msg.word;
            if (updatedWord) {
              setData((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  allVocabulary: prev.allVocabulary.map((w) =>
                    w.id === updatedWord.id ? updatedWord : w
                  ),
                  dueVocabulary:
                    msg.outcome === 'forgotten'
                      ? prev.dueVocabulary
                      : prev.dueVocabulary.filter((w) => w.id !== updatedWord.id),
                };
              });
            }
          } else if (msg.type === 'memory_saved_toast' && msg.fact) {
            showToast(`Erinnerung gespeichert: "${msg.fact.fact}"`, 4800);
            setData((prev) => {
              if (!prev) return prev;
              const newFact = {
                id: msg.fact.id,
                category: msg.fact.category,
                fact: msg.fact.fact,
                source_persona_id: null,
                created_at: new Date().toISOString(),
              };
              const exists = prev.memoryFacts.some((f) => f.id === newFact.id);
              return exists
                ? prev
                : { ...prev, memoryFacts: [newFact, ...prev.memoryFacts] };
            });
          } else if (msg.type === 'analyzing_session') {
            setCallState('analyzing');
            setStatusMessage(msg.message || 'Gespräch wird ausgewertet...');
          } else if (msg.type === 'session_recap') {
            markIntentionalClose();
            stopSession();
            setCallState('idle');
            setLastRecap(msg.reflection);
            void fetchBootstrap();
            if (recapDialogRef.current && !recapDialogRef.current.open) {
              recapDialogRef.current.showModal();
            }
          } else if (msg.type === 'error') {
            setErrorMessage(msg.message || 'Fehler bei der Verbindung zum Sprachmodell.');
            stopSession();
            setCallState('idle');
          }
        },
        onError: (message) => {
          setErrorMessage(`Mikrofon- oder Verbindungsfehler: ${message}`);
          setCallState('idle');
        },
        onUnexpectedClose: () => {
          if (callStateRef.current !== 'idle') {
            setErrorMessage('Verbindung zum Server wurde unerwartet getrennt.');
            setCallState('idle');
          }
        },
      });
    },
    [
      cancelPendingTopicFetch,
      data,
      enableToneAnalysis,
      fetchBootstrap,
      markIntentionalClose,
      selectedPersonaId,
      selectedScenarioId,
      showToast,
      startSession,
      stopSession,
      suggestedTopic,
    ]
  );

  const endCall = useCallback(() => {
    const sent = sendJson({ type: 'end_session' });
    if (sent) {
      stopSession({ keepSocketOpenForRecap: true });
      setCallState('analyzing');
      setStatusMessage('Gespräch wird ausgewertet & Erinnerungen aktualisiert...');
    } else {
      stopSession();
      setCallState('idle');
    }
  }, [sendJson, stopSession]);

  const handleRequestGermanHelp = useCallback(() => {
    sendJson({
      type: 'text_input',
      text: 'Ich habe das nicht verstanden. Bitte nenne mir die chinesischen Wörter/Begriffe einzeln, erkläre sie mir klar auf Deutsch (und zeige sie als Vokabelkarte), und wiederhole den Satz danach noch einmal langsam auf Chinesisch.',
    });
  }, [sendJson]);

  const handleChangeComplexity = useCallback(
    async (preference: 'auto' | 'short' | 'medium' | 'natural') => {
      try {
        await apiFetch('/api/profile/complexity', {
          method: 'POST',
          body: JSON.stringify({ preference }),
        });
        await fetchBootstrap();
      } catch (err: unknown) {
        setErrorMessage(getErrorMessage(err, 'Satzkomplexität konnte nicht gespeichert werden.'));
      }
    },
    [fetchBootstrap]
  );

  const handleAddMemoryFact = useCallback(
    async (category: string, fact: string) => {
      try {
        await apiFetch('/api/memories', {
          method: 'POST',
          body: JSON.stringify({ category, fact }),
        });
        await fetchBootstrap();
      } catch (err: unknown) {
        setErrorMessage(getErrorMessage(err, 'Erinnerung konnte nicht gespeichert werden.'));
      }
    },
    [fetchBootstrap]
  );

  const handleDeleteMemoryFact = useCallback(
    async (id: number) => {
      try {
        await apiFetch(`/api/memories/${id}`, { method: 'DELETE' });
        await fetchBootstrap();
      } catch (err: unknown) {
        setErrorMessage(getErrorMessage(err, 'Erinnerung konnte nicht gelöscht werden.'));
      }
    },
    [fetchBootstrap]
  );

  const handleAddVocabulary = useCallback(
    async (simplifiedHanzi: string, pinyin: string, german: string) => {
      try {
        await apiFetch('/api/vocabulary', {
          method: 'POST',
          body: JSON.stringify({
            simplified_hanzi: simplifiedHanzi,
            pinyin,
            german,
          }),
        });
        await fetchBootstrap();
      } catch (err: unknown) {
        setErrorMessage(getErrorMessage(err, 'Vokabel konnte nicht gespeichert werden.'));
      }
    },
    [fetchBootstrap]
  );

  const handleManualVocabReview = useCallback(
    async (
      simplifiedHanzi: string,
      outcome: 'used_actively' | 'recognized' | 'forgotten'
    ) => {
      try {
        await apiFetch('/api/vocabulary/review', {
          method: 'POST',
          body: JSON.stringify({ simplified_hanzi: simplifiedHanzi, outcome }),
        });
        await fetchBootstrap();
      } catch (err: unknown) {
        setErrorMessage(getErrorMessage(err, 'Vokabelbewertung konnte nicht gespeichert werden.'));
      }
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
      <>
        <AuthView
          requiresBootstrapAdmin={requiresBootstrapAdmin}
          onAuthenticated={(user) => {
            setCurrentUser(user);
            setRequiresBootstrapAdmin(false);
            setAuthStatus('authenticated');
            setErrorMessage('');
            fetchBootstrap();
          }}
          onOpenLegal={openLegalDialog}
        />
        <LegalDialog
          dialogRef={legalDialogRef}
          isOpen={isLegalDialogOpen}
          activeTab={legalTab}
          onChangeTab={setLegalTab}
          onClose={() => setIsLegalDialogOpen(false)}
        />
      </>
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

  const selectedPersona: Persona | undefined =
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
              onOpenDeleteAccount={() => {
                deleteAccountDialogRef.current?.showModal();
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
            selectedPersonaId={selectedPersona?.id || ''}
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
            enableToneAnalysis={enableToneAnalysis}
            onToggleToneAnalysis={() => setEnableToneAnalysis((v) => !v)}
            statusMessage={statusMessage}
            isMuted={isMuted}
            orbWrapperRef={orbWrapperRef}
            orbCircleRef={orbCircleRef}
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
              try {
                await apiFetch(`/api/personas/${encodeURIComponent(personaId)}`, {
                  method: 'DELETE',
                });
                showToast('Person entfernt.');
                await fetchBootstrap();
              } catch (err: unknown) {
                setErrorMessage(getErrorMessage(err, 'Person konnte nicht gelöscht werden.'));
              }
            }}
            onOpenOnboarding={() => {
              setIsOnboardingOpen(true);
              onboardingDialogRef.current?.showModal();
            }}
          />
        )}
      </main>

      {!isInActiveCall && (
        <footer className="app-legal-footer">
          <span className="app-legal-ai-note">
            KI-gestützter Sprachtutor (Google Gemini · EU AI Act Art. 50)
          </span>
          <div className="legal-links-row">
            <button type="button" className="btn-link" onClick={() => openLegalDialog('impressum')}>
              Impressum
            </button>
            <span aria-hidden="true">·</span>
            <button type="button" className="btn-link" onClick={() => openLegalDialog('privacy')}>
              Datenschutz &amp; KI-Hinweis
            </button>
          </div>
        </footer>
      )}

      <SessionRecapDialog dialogRef={recapDialogRef} recap={lastRecap} />
      <InviteDialog
        dialogRef={inviteDialogRef}
        isOpen={isInviteDialogOpen}
        onClose={() => setIsInviteDialogOpen(false)}
      />
      <LegalDialog
        dialogRef={legalDialogRef}
        isOpen={isLegalDialogOpen}
        activeTab={legalTab}
        onChangeTab={setLegalTab}
        onClose={() => setIsLegalDialogOpen(false)}
      />
      {currentUser && (
        <DeleteAccountDialog
          dialogRef={deleteAccountDialogRef}
          userEmail={currentUser.email}
          onDeleted={() => {
            stopSession();
            setCallState('idle');
            hasAutoOpenedOnboardingRef.current = false;
            setCurrentUser(null);
            setData(null);
            setAuthStatus('unauthenticated');
          }}
        />
      )}
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
