import React, { useCallback, useEffect, useState } from 'react';
import { Check, Mic, MicOff, PencilLine, Plus, Sparkles, Volume2, X } from 'lucide-react';
import { apiFetch, getErrorMessage } from '../api.ts';
import { useLiveVoiceSession } from '../hooks/useLiveVoiceSession.ts';
import { LearnerProfile, Persona } from '../types.ts';
import { ModalDialog } from './ModalDialog.tsx';

interface OnboardingDialogProps {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  isOpen: boolean;
  hasApiKey: boolean;
  profile: LearnerProfile;
  personas: Persona[];
  onClose: () => void;
  onRefreshBootstrap: () => Promise<void>;
  onOpenPersonaEditor: (persona?: Persona) => void;
}

type OnboardingStep = 'intro' | 'voice' | 'form';

export function OnboardingDialog({
  dialogRef,
  isOpen,
  hasApiKey,
  profile,
  personas,
  onClose,
  onRefreshBootstrap,
  onOpenPersonaEditor,
}: OnboardingDialogProps) {
  const [step, setStep] = useState<OnboardingStep>('intro');
  const [voiceState, setVoiceState] = useState<'connecting' | 'active' | 'done'>('connecting');
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState('');
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [transcript, setTranscript] = useState<Array<{ speaker: 'user' | 'ai'; text: string }>>([]);
  const [draftUser, setDraftUser] = useState('');
  const [draftAi, setDraftAi] = useState('');
  const [savedPeopleInVoice, setSavedPeopleInVoice] = useState<Persona[]>([]);
  const [savedProfileName, setSavedProfileName] = useState('');

  // Form state
  const [formName, setFormName] = useState(profile.name);
  const [formLevel, setFormLevel] = useState(profile.level || 'HSK 3');
  const [formSummary, setFormSummary] = useState(profile.summary || '');
  const [isSavingForm, setIsSavingForm] = useState(false);

  const { micMeterRef, startSession, stopSession } = useLiveVoiceSession();

  const stopVoiceSession = useCallback(() => {
    stopSession({ sendEndSession: true });
    setAiSpeaking(false);
  }, [stopSession]);

  useEffect(() => {
    if (!isOpen) {
      stopVoiceSession();
      return;
    }
    setStep('intro');
    setError('');
    setTranscript([]);
    setDraftUser('');
    setDraftAi('');
    setSavedPeopleInVoice([]);
    setSavedProfileName('');
    setFormName(profile.name);
    setFormLevel(profile.level || 'HSK 3');
    setFormSummary(profile.summary || '');
  }, [isOpen, profile.level, profile.name, profile.summary, stopVoiceSession]);

  const handleDismissForLater = async () => {
    stopVoiceSession();
    try {
      await apiFetch('/api/profile/onboarding', {
        method: 'POST',
        body: JSON.stringify({ onboarding_completed: true }),
      });
      await onRefreshBootstrap();
    } catch {
      // non-blocking
    }
    dialogRef.current?.close();
    onClose();
  };

  const startVoiceOnboarding = async () => {
    if (!hasApiKey) {
      setError('GEMINI_API_KEY fehlt. Du kannst dein Profil stattdessen einfach kurz eintippen.');
      return;
    }
    setStep('voice');
    setVoiceState('connecting');
    setStatusText('Verbinde mit dem deutschen Einrichtungs-Assistenten...');
    setError('');
    setTranscript([]);
    setSavedPeopleInVoice([]);

    await startSession({
      startPayload: { type: 'start_onboarding' },
      onAiSpeakingChange: setAiSpeaking,
      onMessage: (msg) => {
        if (msg.type === 'session_started') {
          setVoiceState('active');
          setStatusText('Verbunden — antworte einfach ganz normal auf Deutsch.');
        } else if (msg.type === 'transcript_delta') {
          if (msg.speaker === 'user') setDraftUser(msg.fullTurnText || '');
          else setDraftAi(msg.fullTurnText || '');
        } else if (msg.type === 'transcript_turn_complete') {
          if (msg.speaker === 'user') setDraftUser('');
          else setDraftAi('');
          setTranscript((prev) => [...prev, { speaker: msg.speaker, text: msg.text }]);
        } else if (msg.type === 'onboarding_profile_updated' && msg.profile) {
          setSavedProfileName(msg.profile.name);
          void onRefreshBootstrap();
        } else if (msg.type === 'onboarding_person_saved' && msg.persona) {
          setSavedPeopleInVoice((prev) => {
            const exists = prev.some((p) => p.id === msg.persona.id);
            return exists
              ? prev.map((p) => (p.id === msg.persona.id ? msg.persona : p))
              : [...prev, msg.persona];
          });
          void onRefreshBootstrap();
        } else if (msg.type === 'onboarding_completed') {
          setVoiceState('done');
          setStatusText(msg.summary_de || 'Einrichtung abgeschlossen!');
          void onRefreshBootstrap();
        } else if (msg.type === 'error') {
          setError(msg.message || 'Verbindungsfehler zum Sprachmodell.');
          stopVoiceSession();
        }
      },
      onError: (message) => {
        setError(`Mikrofon/Verbindung fehlgeschlagen: ${message}`);
      },
      onUnexpectedClose: () => {
        setError('Verbindung zum Einrichtungs-Assistenten unerwartet getrennt.');
      },
    });
  };

  const handleFinishVoice = async () => {
    stopVoiceSession();
    try {
      await apiFetch('/api/profile/onboarding', {
        method: 'POST',
        body: JSON.stringify({ onboarding_completed: true }),
      });
      await onRefreshBootstrap();
      dialogRef.current?.close();
      onClose();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Einrichtung konnte nicht abgeschlossen werden.'));
    }
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingForm(true);
    setError('');
    try {
      await apiFetch('/api/profile/onboarding', {
        method: 'POST',
        body: JSON.stringify({
          name: formName.trim() || profile.name,
          level: formLevel,
          summary: formSummary.trim() || profile.summary,
          onboarding_completed: true,
        }),
      });
      await onRefreshBootstrap();
      dialogRef.current?.close();
      onClose();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Fehler beim Speichern.'));
    } finally {
      setIsSavingForm(false);
    }
  };

  return (
    <ModalDialog
      dialogRef={dialogRef}
      isOpen={isOpen}
      onClose={() => {
        stopVoiceSession();
        onClose();
      }}
      className="onboarding-dialog"
      aria-labelledby="onboarding-dialog-title"
    >
      <div className="dialog-header">
        <div>
          <h2 id="onboarding-dialog-title" style={{ margin: 0 }}>
            Willkommen — App kurz einrichten
          </h2>
          <p className="muted-text" style={{ margin: '0.25rem 0 0', fontSize: '0.86rem' }}>
            Optional &amp; jederzeit änderbar
          </p>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Schließen"
          onClick={() => {
            stopVoiceSession();
            dialogRef.current?.close();
            onClose();
          }}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      {error && (
        <div className="error-banner" role="alert" style={{ marginBlockEnd: '0.75rem' }}>
          {error}
        </div>
      )}

      {step === 'intro' && (
        <div className="onboarding-intro">
          <p style={{ marginTop: 0, lineHeight: 1.55 }}>
            Schön, dass du da bist! Damit sich die Chinesisch-Gespräche direkt nach deinem echten
            Alltag anfühlen, kannst du jetzt kurz festlegen, <strong>wer du bist</strong> und{' '}
            <strong>mit wem du üben möchtest</strong>.
          </p>

          <div className="onboarding-checklist">
            <div>
              <strong>1. Kurz über dich:</strong> Dein Name, dein Lernstand (z. B. Anfänger oder
              Mittelstufe) und dein Ziel.
            </div>
            <div>
              <strong>2. Deine Personen:</strong> Familie, Freunde oder Kollegen – der Assistent
              schlägt bei Bedarf einfache chinesische Namen vor.
            </div>
            <div>
              <strong>3. Ganz entspannt:</strong> Wenn du möchtest, kannst du auch{' '}
              <em>sofort ohne Einrichtung starten</em> und später wiederkommen.
            </div>
          </div>

          <p className="muted-text" style={{ fontSize: '0.84rem', marginBlockEnd: '1rem' }}>
            Hinweis zum Sprach-Assistenten: Nach dem Klick auf „Mit Sprach-Assistent starten“
            verbindet sich die App auf Deutsch per Mikrofon (Gemini Live) und stellt dir 3–4 kurze
            Fragen.
          </p>

          <div className="onboarding-cta-stack">
            <button type="button" className="btn-primary btn-lg" onClick={startVoiceOnboarding}>
              <Mic size={18} aria-hidden="true" /> Mit Sprach-Assistent starten (Deutsch)
            </button>
            <div className="onboarding-secondary-row">
              <button type="button" className="btn-secondary" onClick={() => setStep('form')}>
                <PencilLine size={16} aria-hidden="true" /> Lieber kurz eintippen
              </button>
              <button type="button" className="btn-secondary" onClick={handleDismissForLater}>
                Sofort starten (später einrichten)
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 'voice' && (
        <div className="onboarding-voice">
          <div className="onboarding-voice-status">
            <div className="onboarding-voice-indicator">
              {aiSpeaking ? (
                <>
                  <Volume2 size={18} aria-hidden="true" />
                  <span>Assistent spricht...</span>
                </>
              ) : voiceState === 'done' ? (
                <>
                  <Check size={18} aria-hidden="true" />
                  <span>Einrichtung abgeschlossen!</span>
                </>
              ) : (
                <>
                  {voiceState === 'active' ? (
                    <Mic size={18} aria-hidden="true" />
                  ) : (
                    <MicOff size={18} aria-hidden="true" />
                  )}
                  <span>{statusText}</span>
                </>
              )}
            </div>
            <div className="mic-meter" aria-hidden="true" style={{ width: '100%', height: 6 }}>
              <div
                ref={micMeterRef}
                className="mic-meter-fill"
                style={{ width: '0%' }}
              />
            </div>
          </div>

          {(savedProfileName || savedPeopleInVoice.length > 0) && (
            <div className="onboarding-saved-chips">
              {savedProfileName && (
                <span className="badge badge-gold">
                  <Check size={12} aria-hidden="true" /> Profil: {savedProfileName}
                </span>
              )}
              {savedPeopleInVoice.map((p) => (
                <span key={p.id} className="badge">
                  {p.avatar_emoji} {p.name_hanzi} ({p.relationship_de})
                </span>
              ))}
            </div>
          )}

          <div className="onboarding-transcript-box">
            {transcript.length === 0 && !draftAi && !draftUser && (
              <p className="muted-text" style={{ margin: 0, fontSize: '0.86rem' }}>
                Der Assistent begrüßt dich gleich auf Deutsch...
              </p>
            )}
            {transcript.map((t, i) => (
              <div key={i} className={`onboarding-turn ${t.speaker === 'user' ? 'is-user' : 'is-ai'}`}>
                <strong>{t.speaker === 'user' ? 'Du' : 'Assistent'}:</strong> {t.text}
              </div>
            ))}
            {draftUser && (
              <div className="onboarding-turn is-user is-draft">
                <strong>Du:</strong> {draftUser}
              </div>
            )}
            {draftAi && (
              <div className="onboarding-turn is-ai is-draft">
                <strong>Assistent:</strong> {draftAi}
              </div>
            )}
          </div>

          <div className="dialog-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                stopVoiceSession();
                setStep('intro');
              }}
            >
              Zurück
            </button>
            <button type="button" className="btn-primary" onClick={handleFinishVoice}>
              <Check size={16} aria-hidden="true" /> Fertig &amp; Übernehmen
            </button>
          </div>
        </div>
      )}

      {step === 'form' && (
        <form onSubmit={handleSaveForm} className="persona-editor-form">
          <div className="persona-name-row">
            <label className="form-field" style={{ flex: 1 }}>
              <span>Dein Name</span>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="z. B. Anna"
              />
            </label>
            <label className="form-field" style={{ flex: 1 }}>
              <span>Dein Chinesisch-Niveau</span>
              <select value={formLevel} onChange={(e) => setFormLevel(e.target.value)}>
                <option value="Anfänger (HSK 1-2)">Anfänger (HSK 1–2)</option>
                <option value="HSK 3">Mittelstufe (HSK 3)</option>
                <option value="HSK 4">Fortgeschritten (HSK 4+)</option>
              </select>
            </label>
          </div>

          <label className="form-field">
            <span>Wofür lernst du Chinesisch? (kurzer Satz)</span>
            <textarea
              rows={2}
              value={formSummary}
              onChange={(e) => setFormSummary(e.target.value)}
              placeholder="z. B. Für Gespräche mit der Familie meines Partners und für eine Reise nach Taiwan."
            />
          </label>

          <div className="form-field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Deine Gesprächspartner ({personas.length})</span>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => onOpenPersonaEditor()}
              >
                <Plus size={14} aria-hidden="true" /> Person hinzufügen
              </button>
            </div>
            <div className="onboarding-persona-mini-list">
              {personas.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="onboarding-persona-chip"
                  onClick={() => onOpenPersonaEditor(p)}
                  title="Klicken zum Bearbeiten"
                >
                  <span>{p.avatar_emoji}</span>
                  <span lang="zh-Hans">{p.name_hanzi}</span>
                  <span className="muted-text">({p.relationship_de})</span>
                </button>
              ))}
            </div>
          </div>

          <div className="dialog-actions">
            <button type="button" className="btn-secondary" onClick={() => setStep('intro')}>
              Zurück
            </button>
            <button type="submit" className="btn-primary" disabled={isSavingForm}>
              <Sparkles size={15} aria-hidden="true" />{' '}
              {isSavingForm ? 'Speichert...' : 'Speichern & Loslegen'}
            </button>
          </div>
        </form>
      )}
    </ModalDialog>
  );
}
