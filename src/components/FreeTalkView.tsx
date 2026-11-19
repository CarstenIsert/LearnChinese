import React from 'react';
import {
  Eye,
  EyeOff,
  HelpCircle,
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  Shuffle,
} from 'lucide-react';
import {
  CurriculumScenario,
  Persona,
  TranscriptTurn,
  VocabularyWord,
} from '../types.ts';

interface FreeTalkViewProps {
  personas: Persona[];
  selectedPersona: Persona;
  selectedScenario?: CurriculumScenario;
  suggestedTopic: string;
  callState: 'idle' | 'connecting' | 'in_call' | 'analyzing';
  statusMessage: string;
  isMuted: boolean;
  micLevel: number;
  aiSpeaking: boolean;
  liveVocabPopups: VocabularyWord[];
  dueVocabulary: VocabularyWord[];
  transcriptTurns: TranscriptTurn[];
  liveDraftUser: string;
  liveDraftAi: string;
  isTranscriptRevealed: boolean;
  onSelectPersona: (personaId: string) => void;
  onShuffleTopic: () => void;
  onStartCall: () => void;
  onEndCall: () => void;
  onToggleMute: () => void;
  onRequestGermanHelp: () => void;
  onToggleTranscript: () => void;
}

export function FreeTalkView({
  personas,
  selectedPersona,
  selectedScenario,
  suggestedTopic,
  callState,
  statusMessage,
  isMuted,
  micLevel,
  aiSpeaking,
  liveVocabPopups,
  dueVocabulary,
  transcriptTurns,
  liveDraftUser,
  liveDraftAi,
  isTranscriptRevealed,
  onSelectPersona,
  onShuffleTopic,
  onStartCall,
  onEndCall,
  onToggleMute,
  onRequestGermanHelp,
  onToggleTranscript,
}: FreeTalkViewProps) {
  const displayedVocab =
    liveVocabPopups.length > 0 ? liveVocabPopups : dueVocabulary.slice(0, 4);

  return (
    <section aria-label="Free Talk">
      <div className="hero-talk-card">
        {callState === 'idle' && (
          <div className="partner-pills" role="group" aria-label="Gesprächspartner wählen">
            {personas.map((p) => {
              const active = p.id === selectedPersona.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`partner-pill ${active ? 'active' : ''}`}
                  onClick={() => onSelectPersona(p.id)}
                >
                  <span aria-hidden="true">{p.avatar_emoji}</span>
                  <span lang="zh-Hans">{p.name_hanzi}</span>
                  <span style={{ opacity: 0.75, fontSize: '0.8rem' }}>
                    ({p.relationship_de.split(' ')[0]})
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div
          className="voice-orb-wrapper"
          style={
            {
              '--orb-scale': callState === 'in_call' ? micLevel : 0,
              '--orb-glow': callState === 'in_call' ? micLevel : 0,
            } as React.CSSProperties
          }
        >
          <div className={`voice-orb ${aiSpeaking ? 'ai-speaking' : ''}`}>
            <span aria-hidden="true">{selectedPersona.avatar_emoji}</span>
          </div>
        </div>

        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem' }} lang="zh-Hans">
            {selectedPersona.name_hanzi}{' '}
            <span style={{ fontSize: '0.95rem', color: 'var(--accent)', fontWeight: 400 }}>
              ({selectedPersona.name_pinyin})
            </span>
          </h2>
          <p style={{ margin: '0.15rem 0 0', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
            {selectedPersona.relationship_de} · Stimme: {selectedPersona.voice_name}
          </p>
        </div>

        {callState === 'idle' && (
          <div className="topic-suggestion-bar">
            <div style={{ flex: 1, textAlign: 'left' }}>
              <span
                style={{
                  fontSize: '0.75rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--accent)',
                  display: 'block',
                  fontWeight: 600,
                }}
              >
                {selectedScenario ? 'Gewähltes Thema' : 'Vorgeschlagenes Thema für heute'}
              </span>
              <span>{selectedScenario ? selectedScenario.title_de : suggestedTopic}</span>
            </div>
            <button
              type="button"
              onClick={onShuffleTopic}
              title="Neues zufälliges Thema vorschlagen"
              style={{ fontSize: '0.82rem', padding: '0.4rem 0.75rem' }}
            >
              <Shuffle size={14} aria-hidden="true" />
              Anderes Thema
            </button>
          </div>
        )}

        {callState === 'idle' ? (
          <div className="call-controls">
            <button
              type="button"
              className="btn-primary"
              style={{ padding: '0.75rem 1.75rem', fontSize: '1.05rem' }}
              onClick={onStartCall}
            >
              <PhoneCall size={18} aria-hidden="true" />
              Free Talk starten
            </button>
          </div>
        ) : (
          <>
            <p style={{ margin: 0, color: 'var(--accent)', fontSize: '0.92rem' }}>
              {statusMessage}
            </p>

            {callState === 'in_call' && (
              <div className="call-controls">
                <button type="button" onClick={onToggleMute}>
                  {isMuted ? (
                    <>
                      <MicOff size={16} aria-hidden="true" /> Stumm
                    </>
                  ) : (
                    <>
                      <Mic size={16} aria-hidden="true" /> Mikrofon an
                    </>
                  )}
                </button>

                <button type="button" onClick={onRequestGermanHelp}>
                  <HelpCircle size={16} aria-hidden="true" />
                  Auf Deutsch erklären
                </button>

                <button type="button" className="btn-danger" onClick={onEndCall}>
                  <PhoneOff size={16} aria-hidden="true" />
                  Beenden
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="two-col-grid">
        <div className="panel-card">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBlockEnd: '0.65rem',
            }}
          >
            <h3 style={{ margin: 0 }}>
              {liveVocabPopups.length > 0
                ? 'Neue Vokabeln im Gespräch'
                : 'Fällige Vokabeln für heute'}
            </h3>
            <span className="badge">
              {liveVocabPopups.length > 0
                ? `${liveVocabPopups.length} neu`
                : `${dueVocabulary.length} zum Einbauen`}
            </span>
          </div>

          <div className="vocab-popup-list">
            {displayedVocab.map((w) => (
              <div key={w.simplified_hanzi} className="vocab-flashcard">
                <div>
                  <span className="vocab-hanzi" lang="zh-Hans">
                    {w.simplified_hanzi}
                  </span>
                  <span className="vocab-pinyin">{w.pinyin}</span>
                </div>
                <div className="vocab-german">{w.german}</div>
                {w.example_hanzi && (
                  <div className="vocab-example">
                    <div lang="zh-Hans">{w.example_hanzi}</div>
                    {w.example_pinyin && <div>{w.example_pinyin}</div>}
                    {w.example_de && <div>{w.example_de}</div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="panel-card">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBlockEnd: '0.65rem',
            }}
          >
            <h3 style={{ margin: 0 }}>Live-Transkript</h3>
            <button
              type="button"
              onClick={onToggleTranscript}
              style={{ padding: '0.3rem 0.65rem', fontSize: '0.8rem' }}
            >
              {isTranscriptRevealed ? (
                <>
                  <EyeOff size={14} aria-hidden="true" /> Ausblenden
                </>
              ) : (
                <>
                  <Eye size={14} aria-hidden="true" /> Anzeigen
                </>
              )}
            </button>
          </div>

          <div className={`transcript-box ${isTranscriptRevealed ? '' : 'blurred'}`}>
            <div className="transcript-content">
              {transcriptTurns.length === 0 && !liveDraftAi && !liveDraftUser ? (
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Standardmäßig unscharf für besseres Hörverständnis. Klicke auf „Anzeigen“, wenn
                  du mitlesen möchtest.
                </p>
              ) : (
                <>
                  {transcriptTurns.map((t, idx) => (
                    <div key={idx} className={`transcript-turn ${t.speaker}`}>
                      <strong>
                        {t.speaker === 'user' ? 'Du:' : `${selectedPersona.name_hanzi}:`}
                      </strong>{' '}
                      <span lang="zh-Hans">{t.text}</span>
                    </div>
                  ))}
                  {liveDraftUser && (
                    <div className="transcript-turn user">
                      <strong>Du:</strong> <span lang="zh-Hans">{liveDraftUser}</span>
                    </div>
                  )}
                  {liveDraftAi && (
                    <div className="transcript-turn ai">
                      <strong>{selectedPersona.name_hanzi}:</strong>{' '}
                      <span lang="zh-Hans">{liveDraftAi}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
