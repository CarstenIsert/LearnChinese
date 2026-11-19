import React from 'react';
import { PhoneCall } from 'lucide-react';
import { CurriculumScenario } from '../types.ts';

interface ScenariosViewProps {
  scenarios: CurriculumScenario[];
  onStartScenario: (personaId: string, scenarioId: string) => void;
}

export function ScenariosView({ scenarios, onStartScenario }: ScenariosViewProps) {
  return (
    <section aria-label="Themen und Szenarien">
      <div className="two-col-grid">
        {scenarios.map((scen) => (
          <article key={scen.id} className="panel-card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBlockEnd: '0.45rem',
              }}
            >
              <span className="badge">{scen.stage_title_de}</span>
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
