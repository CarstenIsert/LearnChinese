import React, { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { getErrorMessage } from '../api.ts';
import { Persona } from '../types.ts';
import { ModalDialog } from './ModalDialog.tsx';

interface PersonaEditorDialogProps {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  isOpen: boolean;
  editingPersona: Persona | null;
  onClose: () => void;
  onSaved: (persona: Persona) => void;
}

const AVATAR_OPTIONS = ['👩🏻', '👨🏻', '👵🏻', '👴🏻', '👧🏻', '👦🏻', '🧑‍🏫', '🧑'];

const VOICE_OPTIONS = [
  { value: 'Aoede', label: 'Weiblich – warm (Aoede)' },
  { value: 'Kore', label: 'Weiblich – klar (Kore)' },
  { value: 'Puck', label: 'Männlich – locker (Puck)' },
  { value: 'Charon', label: 'Männlich – ruhig (Charon)' },
];

const SIMPLE_NAME_SUGGESTIONS: Array<{ hanzi: string; pinyin: string; emoji: string; voice: string }> = [
  { hanzi: '小明', pinyin: 'Xiǎomíng', emoji: '👨🏻', voice: 'Puck' },
  { hanzi: '小美', pinyin: 'Xiǎoměi', emoji: '👩🏻', voice: 'Aoede' },
  { hanzi: '林妈妈', pinyin: 'Lín Māmā', emoji: '👵🏻', voice: 'Aoede' },
  { hanzi: '王老师', pinyin: 'Wáng Lǎoshī', emoji: '🧑‍🏫', voice: 'Kore' },
  { hanzi: '大卫', pinyin: 'Dàwèi', emoji: '👨🏻', voice: 'Charon' },
];

export function PersonaEditorDialog({
  dialogRef,
  isOpen,
  editingPersona,
  onClose,
  onSaved,
}: PersonaEditorDialogProps) {
  const [relationshipDe, setRelationshipDe] = useState('');
  const [nameHanzi, setNameHanzi] = useState('');
  const [namePinyin, setNamePinyin] = useState('');
  const [ageGroup, setAgeGroup] = useState('Erwachsene');
  const [avatarEmoji, setAvatarEmoji] = useState('🧑');
  const [voiceName, setVoiceName] = useState('Aoede');
  const [personalityPrompt, setPersonalityPrompt] = useState('');
  const [speakingStyle, setSpeakingStyle] = useState('');
  const [initialHook, setInitialHook] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    if (editingPersona) {
      setRelationshipDe(editingPersona.relationship_de);
      setNameHanzi(editingPersona.name_hanzi);
      setNamePinyin(editingPersona.name_pinyin);
      setAgeGroup(editingPersona.age_group || 'Erwachsene');
      setAvatarEmoji(editingPersona.avatar_emoji || '🧑');
      setVoiceName(editingPersona.voice_name || 'Aoede');
      setPersonalityPrompt(editingPersona.personality_prompt || '');
      setSpeakingStyle(editingPersona.speaking_style || '');
      setInitialHook(editingPersona.initial_hook || '');
    } else {
      setRelationshipDe('');
      setNameHanzi('');
      setNamePinyin('');
      setAgeGroup('ca. 30–50 Jahre');
      setAvatarEmoji('🧑');
      setVoiceName('Aoede');
      setPersonalityPrompt('');
      setSpeakingStyle('');
      setInitialHook('');
    }
  }, [isOpen, editingPersona]);

  const handleSuggestName = () => {
    const idx = Math.floor(Math.random() * SIMPLE_NAME_SUGGESTIONS.length);
    const pick = SIMPLE_NAME_SUGGESTIONS[idx];
    setNameHanzi(pick.hanzi);
    setNamePinyin(pick.pinyin);
    if (!editingPersona) {
      setAvatarEmoji(pick.emoji);
      setVoiceName(pick.voice);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!relationshipDe.trim() || !nameHanzi.trim()) {
      setError('Bitte gib mindestens die Beziehung (auf Deutsch) und einen chinesischen Namen an.');
      return;
    }

    setIsSaving(true);
    setError('');
    try {
      const url = editingPersona
        ? `/api/personas/${encodeURIComponent(editingPersona.id)}`
        : '/api/personas';
      const method = editingPersona ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name_hanzi: nameHanzi.trim(),
          name_pinyin: namePinyin.trim() || nameHanzi.trim(),
          relationship_de: relationshipDe.trim(),
          age_group: ageGroup.trim() || 'Erwachsene',
          avatar_emoji: avatarEmoji,
          voice_name: voiceName,
          personality_prompt: personalityPrompt.trim() || undefined,
          speaking_style: speakingStyle.trim() || undefined,
          initial_hook: initialHook.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Person konnte nicht gespeichert werden.');
      }
      onSaved(json.persona);
      dialogRef.current?.close();
      onClose();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Fehler beim Speichern.'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ModalDialog
      dialogRef={dialogRef}
      isOpen={isOpen}
      onClose={onClose}
      aria-labelledby="persona-editor-title"
    >
      <div className="dialog-header">
        <div>
          <h2 id="persona-editor-title" style={{ margin: 0 }}>
            {editingPersona ? 'Person bearbeiten' : 'Neue Person anlegen'}
          </h2>
          <p className="muted-text" style={{ margin: '0.25rem 0 0', fontSize: '0.86rem' }}>
            Lege fest, mit wem du auf Chinesisch sprechen möchtest.
          </p>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Schließen"
          onClick={() => {
            dialogRef.current?.close();
            onClose();
          }}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="persona-editor-form">
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}

        <label className="form-field">
          <span>Rolle / Beziehung (auf Deutsch) *</span>
          <input
            type="text"
            required
            placeholder="z. B. Cousin, Schwiegermutter, Kollegin, Lehrer"
            value={relationshipDe}
            onChange={(e) => setRelationshipDe(e.target.value)}
          />
        </label>

        <div className="persona-name-row">
          <label className="form-field" style={{ flex: 1 }}>
            <span>Chinesischer Name (Hanzi) *</span>
            <input
              type="text"
              required
              lang="zh-Hans"
              placeholder="z. B. 表哥小明"
              value={nameHanzi}
              onChange={(e) => setNameHanzi(e.target.value)}
            />
          </label>
          <label className="form-field" style={{ flex: 1 }}>
            <span>Aussprache (Pinyin)</span>
            <input
              type="text"
              placeholder="z. B. Biǎogē Xiǎomíng"
              value={namePinyin}
              onChange={(e) => setNamePinyin(e.target.value)}
            />
          </label>
        </div>

        <div>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={handleSuggestName}
          >
            <Sparkles size={14} aria-hidden="true" /> Einfachen Namen vorschlagen
          </button>
        </div>

        <div className="persona-name-row">
          <label className="form-field" style={{ flex: 1 }}>
            <span>Alter / Generation</span>
            <input
              type="text"
              placeholder="z. B. ca. 50 Jahre"
              value={ageGroup}
              onChange={(e) => setAgeGroup(e.target.value)}
            />
          </label>
          <label className="form-field" style={{ flex: 1 }}>
            <span>Stimme</span>
            <select value={voiceName} onChange={(e) => setVoiceName(e.target.value)}>
              {VOICE_OPTIONS.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="form-field">
          <span>Symbol</span>
          <div className="emoji-picker-row">
            {AVATAR_OPTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className={`emoji-option ${avatarEmoji === emoji ? 'is-selected' : ''}`}
                onClick={() => setAvatarEmoji(emoji)}
                aria-pressed={avatarEmoji === emoji}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        <details className="advanced-details">
          <summary>Erweiterte Einstellungen (optional)</summary>
          <div className="advanced-details-body">
            <label className="form-field">
              <span>Persönlichkeit &amp; Hintergrund (KI-Prompt)</span>
              <textarea
                rows={3}
                placeholder="Wird automatisch ausgefüllt, wenn leer gelassen."
                value={personalityPrompt}
                onChange={(e) => setPersonalityPrompt(e.target.value)}
              />
            </label>
            <label className="form-field">
              <span>Sprechstil</span>
              <input
                type="text"
                placeholder="z. B. Lockeres Alltags-Mandarin"
                value={speakingStyle}
                onChange={(e) => setSpeakingStyle(e.target.value)}
              />
            </label>
            <label className="form-field">
              <span>Erstes Gesprächsthema</span>
              <input
                type="text"
                placeholder="z. B. Über den Alltag und Reisepläne sprechen"
                value={initialHook}
                onChange={(e) => setInitialHook(e.target.value)}
              />
            </label>
          </div>
        </details>

        <div className="dialog-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              dialogRef.current?.close();
              onClose();
            }}
          >
            Abbrechen
          </button>
          <button type="submit" className="btn-primary" disabled={isSaving}>
            {isSaving ? 'Speichert...' : 'Speichern'}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
