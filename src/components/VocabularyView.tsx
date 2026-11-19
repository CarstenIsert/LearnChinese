import React, { useMemo, useState } from 'react';
import { CheckCircle2, Plus } from 'lucide-react';
import { VocabularyWord } from '../types.ts';

interface VocabularyViewProps {
  allVocabulary: VocabularyWord[];
  dueCount: number;
  onAddVocabulary: (hanzi: string, pinyin: string, german: string) => Promise<void>;
  onReviewVocabulary: (
    simplifiedHanzi: string,
    outcome: 'used_actively' | 'recognized' | 'forgotten'
  ) => Promise<void>;
}

export function VocabularyView({
  allVocabulary,
  dueCount,
  onAddVocabulary,
  onReviewVocabulary,
}: VocabularyViewProps) {
  const [vocabSearch, setVocabSearch] = useState<string>('');
  const [newVocabHanzi, setNewVocabHanzi] = useState<string>('');
  const [newVocabPinyin, setNewVocabPinyin] = useState<string>('');
  const [newVocabGerman, setNewVocabGerman] = useState<string>('');

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

  return (
    <section aria-label="Vokabeln">
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
            {dueCount} Wörter stehen aktuell zur Wiederholung im Gespräch an.
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
    </section>
  );
}
