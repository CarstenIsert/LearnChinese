import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Brain, GraduationCap, PhoneCall, Sparkles } from 'lucide-react';
import { LiveAudioManager } from './audio.ts';
import { FreeTalkView } from './components/FreeTalkView.tsx';
import { MemoryView } from './components/MemoryView.tsx';
import { ScenariosView } from './components/ScenariosView.tsx';
import { SessionRecapDialog } from './components/SessionRecapDialog.tsx';
import { VocabularyView } from './components/VocabularyView.tsx';
import {
  BootstrapData,
  CurriculumScenario,
  Persona,
  SessionReflection,
  TranscriptTurn,
  VocabularyWord,
} from './types.ts';

type ActiveTab = 'talk' | 'vocab' | 'curriculum' | 'memory';

const RANDOM_TOPIC_POOL = [
  'Erzähl von deinem heutigen Tag und frag nach dem Wetter.',
  'Pläne für das kommende Wochenende und Lieblingsessen.',
  'Reiseroute mit dem Zug oder Mietwagen planen.',
  'Im Restaurant bestellen und über Lieblingsgerichte sprechen.',
  'Über zukünftige Reisepläne und das Chinesischlernen plaudern.',
  'Unterschiede im Alltag, Essen und Wetter vergleichen.',
  'Auf dem Abendmarkt Getränke und Snacks bestellen.',
  'Über frühere Reisen und schöne Ausflugsziele sprechen.',
  'Einladung zum Tee und lockerer Smalltalk.',
  'Hobbys, Sport und wie man nach der Arbeit entspannt.',
];

export default function App() {
  const [data, setData] = useState<BootstrapData | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('talk');
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('');
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('');
  const [suggestedTopic, setSuggestedTopic] = useState<string>(() => {
    return RANDOM_TOPIC_POOL[Math.floor(Math.random() * RANDOM_TOPIC_POOL.length)];
  });

  // Call state
  const [callState, setCallState] = useState<'idle' | 'connecting' | 'in_call' | 'analyzing'>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [micLevel, setMicLevel] = useState<number>(0);
  const [aiSpeaking, setAiSpeaking] = useState<boolean>(false);

  // Live Vocab Popups & Blurred Transcript
  const [liveVocabPopups, setLiveVocabPopups] = useState<VocabularyWord[]>([]);
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
      if (!res.ok) throw new Error('Backend nicht erreichbar');
      const json = (await res.json()) as BootstrapData;
      setData(json);
      setSelectedPersonaId((prev) => prev || json.personas[0]?.id || '');
    } catch (err: any) {
      setErrorMessage(
        `Backend-Server nicht erreichbar (${err?.message || 'Verbindungsfehler'}).`
      );
    }
  }, []);

  useEffect(() => {
    fetchBootstrap();
  }, [fetchBootstrap]);

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

  const shuffleTopic = useCallback(() => {
    setSelectedScenarioId('');
    const pool = [...RANDOM_TOPIC_POOL];
    if (data?.personas) {
      for (const p of data.personas) {
        if (p.initial_hook) pool.push(p.initial_hook);
      }
    }
    if (data?.recentEpisodes) {
      for (const ep of data.recentEpisodes) {
        if (ep.next_hook) pool.push(ep.next_hook);
      }
    }
    const candidates = pool.filter((t) => t !== suggestedTopic);
    const next = candidates[Math.floor(Math.random() * candidates.length)] || RANDOM_TOPIC_POOL[0];
    setSuggestedTopic(next);
  }, [data, suggestedTopic]);

  const startCall = useCallback(
    async (personaIdOverride?: string, scenarioIdOverride?: string) => {
      const targetPersonaId = personaIdOverride || selectedPersonaId || data?.personas[0]?.id || '';
      const targetScenarioId =
        scenarioIdOverride !== undefined ? scenarioIdOverride : selectedScenarioId;

      setSelectedPersonaId(targetPersonaId);
      setSelectedScenarioId(targetScenarioId);
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
              topic: targetScenarioId ? undefined : suggestedTopic,
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
    [data, fetchBootstrap, selectedPersonaId, selectedScenarioId, showToast, suggestedTopic]
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
          text: 'Kannst du deinen letzten Satz bitte noch einmal langsamer auf Chinesisch sagen und kurz auf Deutsch erklären?',
        })
      );
    }
  }, []);

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

  if (!data) {
    return (
      <main className="app-shell">
        {errorMessage ? (
          <div className="error-banner" role="alert">
            <span>{errorMessage}</span>
          </div>
        ) : (
          <p>Lade Learn Chinese...</p>
        )}
      </main>
    );
  }

  const selectedPersona: Persona =
    data.personas.find((p) => p.id === selectedPersonaId) || data.personas[0];
  const selectedScenario: CurriculumScenario | undefined = data.scenarios.find(
    (s) => s.id === selectedScenarioId
  );

  return (
    <div className="app-shell">
      <header className="top-header">
        <h1 className="brand-title">Learn Chinese</h1>

        <nav className="tab-nav" aria-label="Hauptnavigation">
          <button
            type="button"
            className="btn-tab"
            aria-current={activeTab === 'talk' ? 'page' : undefined}
            onClick={() => setActiveTab('talk')}
          >
            <PhoneCall size={15} aria-hidden="true" />
            Free Talk
          </button>
          <button
            type="button"
            className="btn-tab"
            aria-current={activeTab === 'vocab' ? 'page' : undefined}
            onClick={() => setActiveTab('vocab')}
          >
            <BookOpen size={15} aria-hidden="true" />
            Vokabeln ({data.dueVocabulary.length} fällig)
          </button>
          <button
            type="button"
            className="btn-tab"
            aria-current={activeTab === 'curriculum' ? 'page' : undefined}
            onClick={() => setActiveTab('curriculum')}
          >
            <GraduationCap size={15} aria-hidden="true" />
            Themen ({data.scenarios.length})
          </button>
          <button
            type="button"
            className="btn-tab"
            aria-current={activeTab === 'memory' ? 'page' : undefined}
            onClick={() => setActiveTab('memory')}
          >
            <Brain size={15} aria-hidden="true" />
            Gedächtnis ({data.memoryFacts.length})
          </button>
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
        {activeTab === 'talk' && (
          <FreeTalkView
            personas={data.personas}
            selectedPersona={selectedPersona}
            selectedScenario={selectedScenario}
            suggestedTopic={suggestedTopic}
            callState={callState}
            statusMessage={statusMessage}
            isMuted={isMuted}
            micLevel={micLevel}
            aiSpeaking={aiSpeaking}
            liveVocabPopups={liveVocabPopups}
            dueVocabulary={data.dueVocabulary}
            transcriptTurns={transcriptTurns}
            liveDraftUser={liveDraftUser}
            liveDraftAi={liveDraftAi}
            isTranscriptRevealed={isTranscriptRevealed}
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
            dueCount={data.dueVocabulary.length}
            onAddVocabulary={handleAddVocabulary}
            onReviewVocabulary={handleManualVocabReview}
          />
        )}

        {activeTab === 'curriculum' && (
          <ScenariosView
            scenarios={data.scenarios}
            onStartScenario={(personaId, scenarioId) => startCall(personaId, scenarioId)}
          />
        )}

        {activeTab === 'memory' && (
          <MemoryView
            memoryFacts={data.memoryFacts}
            recentEpisodes={data.recentEpisodes}
            skills={data.skills}
            onAddMemoryFact={handleAddMemoryFact}
            onDeleteMemoryFact={handleDeleteMemoryFact}
          />
        )}
      </main>

      <SessionRecapDialog dialogRef={recapDialogRef} recap={lastRecap} />
    </div>
  );
}
