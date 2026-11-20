import React, { useState } from 'react';
import { Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { LearnerSkill, MemoryFact, Persona, PersonaEpisode } from '../types.ts';

interface MemoryViewProps {
  personas: Persona[];
  memoryFacts: MemoryFact[];
  recentEpisodes: PersonaEpisode[];
  skills: LearnerSkill[];
  onAddMemoryFact: (category: string, fact: string) => Promise<void>;
  onDeleteMemoryFact: (id: number) => Promise<void>;
  onOpenPersonaEditor: (persona?: Persona) => void;
  onDeletePersona: (personaId: string) => Promise<void>;
  onOpenOnboarding: () => void;
}

export function MemoryView({
  personas,
  memoryFacts,
  recentEpisodes,
  skills,
  onAddMemoryFact,
  onDeleteMemoryFact,
  onOpenPersonaEditor,
  onDeletePersona,
  onOpenOnboarding,
}: MemoryViewProps) {
  const [newFactCategory, setNewFactCategory] = useState<string>('travel_plans');
  const [newFactText, setNewFactText] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFactText.trim()) return;
    await onAddMemoryFact(newFactCategory, newFactText.trim());
    setNewFactText('');
  };

  return (
    <section aria-label="Gedächtnis">
      <div className="panel-card" style={{ marginBlockEnd: '1rem' }}>
        <div className="personas-panel-header">
          <div>
            <h2 style={{ margin: 0 }}>Gesprächspartner &amp; Umfeld</h2>
            <p className="muted-text" style={{ margin: '0.2rem 0 0', fontSize: '0.85rem' }}>
              Lege fest, mit wem du Chinesisch übst, oder starte den deutschen Einrichtungs-Assistenten.
            </p>
          </div>
          <div className="personas-panel-actions">
            <button type="button" className="btn-secondary btn-sm" onClick={onOpenOnboarding}>
              <Sparkles size={14} aria-hidden="true" /> Einrichtungs-Assistent
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={() => onOpenPersonaEditor()}>
              <Plus size={14} aria-hidden="true" /> Neue Person
            </button>
          </div>
        </div>

        <div className="personas-manage-grid">
          {personas.map((p) => (
            <div key={p.id} className="persona-manage-card">
              <div className="persona-manage-info">
                <span className="persona-manage-emoji" aria-hidden="true">
                  {p.avatar_emoji}
                </span>
                <div>
                  <div className="persona-manage-name">
                    <strong lang="zh-Hans">{p.name_hanzi}</strong>{' '}
                    <span className="muted-text">({p.name_pinyin})</span>
                  </div>
                  <div className="persona-manage-rel">
                    {p.relationship_de} · {p.age_group}
                  </div>
                </div>
              </div>
              <div className="persona-manage-buttons">
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  aria-label={`${p.name_hanzi} bearbeiten`}
                  onClick={() => onOpenPersonaEditor(p)}
                >
                  <Pencil size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  aria-label={`${p.name_hanzi} löschen`}
                  disabled={personas.length <= 1}
                  title={
                    personas.length <= 1
                      ? 'Mindestens eine Person muss bleiben'
                      : 'Person entfernen'
                  }
                  onClick={() => {
                    if (window.confirm(`„${p.name_hanzi} (${p.relationship_de})“ wirklich entfernen?`)) {
                      onDeletePersona(p.id);
                    }
                  }}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="two-col-grid">
        <div className="panel-card">
          <h2>Gespeicherte Fakten</h2>
          <form onSubmit={handleSubmit} className="input-row">
            <select
              aria-label="Kategorie"
              value={newFactCategory}
              onChange={(e) => setNewFactCategory(e.target.value)}
              style={{ flex: '0 1 130px' }}
            >
              <option value="family">Familie</option>
              <option value="travel_plans">Reisepläne</option>
              <option value="germany_life">Alltag</option>
              <option value="preferences">Vorlieben</option>
              <option value="past_trips">Erfahrungen</option>
            </select>
            <input
              type="text"
              placeholder="Neuen Fakt ergänzen..."
              value={newFactText}
              onChange={(e) => setNewFactText(e.target.value)}
            />
            <button type="submit" className="btn-primary">
              <Plus size={16} aria-hidden="true" />
            </button>
          </form>

          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {memoryFacts.map((f) => (
              <li
                key={f.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.5rem',
                  paddingBlock: '0.5rem',
                  borderBlockEnd: '1px solid var(--border)',
                  fontSize: '0.88rem',
                }}
              >
                <div>
                  <span className="badge" style={{ marginInlineEnd: '0.45rem' }}>
                    {f.category}
                  </span>
                  <span>{f.fact}</span>
                </div>
                <button
                  type="button"
                  aria-label={`Löschen: ${f.fact}`}
                  onClick={() => onDeleteMemoryFact(f.id)}
                  style={{ padding: '0.25rem 0.45rem' }}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="panel-card">
            <h2>Letzte Gespräche</h2>
            {recentEpisodes.length === 0 ? (
              <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)', margin: 0 }}>
                Noch keine Gespräche aufgezeichnet.
              </p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {recentEpisodes.map((ep) => (
                  <li
                    key={ep.id}
                    style={{
                      paddingBlock: '0.55rem',
                      borderBlockEnd: '1px solid var(--border)',
                      fontSize: '0.86rem',
                    }}
                  >
                    <strong>{ep.persona_name}</strong>: {ep.summary}
                    {ep.next_hook && (
                      <div style={{ color: 'var(--accent)', marginBlockStart: '0.15rem' }}>
                        ↳ Nächstes Mal: {ep.next_hook}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="panel-card">
            <h2>Sprach-Fokus & Grammatik</h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {skills.map((s) => (
                <li
                  key={s.id}
                  style={{
                    paddingBlock: '0.55rem',
                    borderBlockEnd: '1px solid var(--border)',
                    fontSize: '0.86rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>{s.skill_name}</strong>
                    <span className="badge">{s.status}</span>
                  </div>
                  <div style={{ color: 'var(--text-muted)', marginBlockStart: '0.15rem' }}>
                    {s.notes_de}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
