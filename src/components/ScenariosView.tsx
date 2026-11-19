import React, { useMemo, useState } from 'react';
import { PhoneCall, Plus, Sparkles } from 'lucide-react';
import { CurriculumScenario } from '../types.ts';

interface ScenariosViewProps {
  scenarios: CurriculumScenario[];
  remainingCurated: number;
  hasApiKey: boolean;
  onStartScenario: (personaId: string, scenarioId: string) => void;
  onExpandCurriculum: (targetLevel?: 'HSK 3' | 'HSK 4') => Promise<void>;
}

type ScenarioFilter = 'all' | 'hsk3' | 'hsk4' | 'unpracticed';

const EXPAND_BUTTONS: Array<{
  level: 'HSK 3' | 'HSK 4';
  label: string;
  title: string;
  primary?: boolean;
}> = [
  {
    level: 'HSK 3',
    label: 'HSK 3 erweitern',
    title: 'Curriculum um ein weiteres HSK-3-Thema erweitern',
  },
  {
    level: 'HSK 4',
    label: 'HSK 4 erweitern',
    title: 'Curriculum um ein weiteres HSK-4-Thema erweitern',
    primary: true,
  },
];

export function ScenariosView({
  scenarios,
  remainingCurated,
  hasApiKey,
  onStartScenario,
  onExpandCurriculum,
}: ScenariosViewProps) {
  const [filter, setFilter] = useState<ScenarioFilter>('all');
  const [isExpanding, setIsExpanding] = useState<'HSK 3' | 'HSK 4' | null>(null);

  const { counts, filteredScenarios } = useMemo(() => {
    let hsk3 = 0;
    let hsk4 = 0;
    let unpracticed = 0;
    const list: CurriculumScenario[] = [];

    for (const scen of scenarios) {
      const level = scen.hsk_level || 'HSK 3';
      if (level === 'HSK 3') hsk3 += 1;
      if (level === 'HSK 4') hsk4 += 1;
      if (scen.times_practiced === 0) unpracticed += 1;

      const matches =
        filter === 'all' ||
        (filter === 'hsk3' && level === 'HSK 3') ||
        (filter === 'hsk4' && level === 'HSK 4') ||
        (filter === 'unpracticed' && scen.times_practiced === 0);

      if (matches) list.push(scen);
    }

    return {
      counts: { all: scenarios.length, hsk3, hsk4, unpracticed },
      filteredScenarios: list,
    };
  }, [scenarios, filter]);

  const handleExpand = async (level: 'HSK 3' | 'HSK 4') => {
    if (isExpanding) return;
    setIsExpanding(level);
    try {
      await onExpandCurriculum(level);
    } finally {
      setIsExpanding(null);
    }
  };

  return (
    <section aria-label="Themen und Szenarien">
      <div
        className="panel-card"
        style={{
          marginBlockEnd: '1rem',
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
          {(
            [
              { id: 'all', label: `Alle (${counts.all})` },
              { id: 'hsk3', label: `HSK 3 (${counts.hsk3})` },
              { id: 'hsk4', label: `HSK 4 (${counts.hsk4})` },
              { id: 'unpracticed', label: `Noch offen (${counts.unpracticed})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={filter === tab.id ? 'btn-primary' : ''}
              style={{ fontSize: '0.82rem', padding: '0.35rem 0.7rem' }}
              onClick={() => setFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
          {EXPAND_BUTTONS.map((btn) => (
            <button
              key={btn.level}
              type="button"
              className={btn.primary ? 'btn-primary' : undefined}
              disabled={isExpanding !== null || (remainingCurated === 0 && !hasApiKey)}
              onClick={() => handleExpand(btn.level)}
              style={{ fontSize: '0.82rem', padding: '0.4rem 0.75rem' }}
              title={btn.title}
            >
              {remainingCurated > 0 ? (
                <Plus size={14} aria-hidden="true" />
              ) : (
                <Sparkles size={14} aria-hidden="true" />
              )}
              {isExpanding === btn.level ? 'Erweitere...' : btn.label}
            </button>
          ))}
        </div>
      </div>

      <div className="two-col-grid">
        {filteredScenarios.map((scen) => (
          <article key={scen.id} className="panel-card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.4rem',
                flexWrap: 'wrap',
                marginBlockEnd: '0.45rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                <span className="badge">{scen.stage_title_de}</span>
                {scen.hsk_level && (
                  <span className="badge" style={{ opacity: 0.9 }}>
                    {scen.hsk_level}
                  </span>
                )}
              </div>
              <span className="badge badge-emerald">{scen.times_practiced}x geübt</span>
            </div>

            <h3 style={{ margin: '0.25rem 0 0.15rem' }}>{scen.title_de}</h3>
            <div
              lang="zh-Hans"
              style={{ color: 'var(--accent)', fontSize: '0.92rem', marginBlockEnd: '0.4rem' }}
            >
              {scen.title_hanzi}
            </div>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBlock: '0 0.7rem' }}>
              {scen.description_de}
            </p>

            <div
              style={{
                fontSize: '0.82rem',
                color: 'var(--text-muted)',
                marginBlockEnd: '0.85rem',
              }}
            >
              <div>
                <strong>Partner:</strong> {scen.persona_emoji} {scen.persona_name}
              </div>
              <div>
                <strong>Fokus:</strong> <span lang="zh-Hans">{scen.target_grammar}</span>
              </div>
            </div>

            <button
              type="button"
              className="btn-primary"
              onClick={() => onStartScenario(scen.persona_id, scen.id)}
            >
              <PhoneCall size={15} aria-hidden="true" />
              Thema starten
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
