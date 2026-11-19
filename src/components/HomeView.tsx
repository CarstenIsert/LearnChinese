import React from 'react';
import {
  ArrowRight,
  BookOpen,
  Brain,
  Clock,
  Flame,
  GraduationCap,
  MessageSquare,
  PhoneCall,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import {
  CurriculumScenario,
  LearnerProfile,
  LearningStats,
  Persona,
  RecentSession,
} from '../types.ts';

interface HomeViewProps {
  profile: LearnerProfile;
  stats: LearningStats;
  personas: Persona[];
  scenarios: CurriculumScenario[];
  recentSessions: RecentSession[];
  memoryFactsCount: number;
  selectedPersonaId: string;
  onSelectPersona: (personaId: string) => void;
  onStartFreeTalk: () => void;
  onNavigate: (tab: 'talk' | 'vocab' | 'curriculum' | 'memory') => void;
  onChangeComplexity: (pref: 'auto' | 'short' | 'medium' | 'natural') => void;
}

export function formatDurationDe(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds < 60) {
    return `${Math.max(0, Math.round(totalSeconds))} Sek.`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    return `${minutes} Min.`;
  }
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin > 0 ? `${hours} Std. ${remMin} Min.` : `${hours} Std.`;
}

export function HomeView({
  profile,
  stats,
  personas,
  scenarios,
  recentSessions,
  memoryFactsCount,
  selectedPersonaId,
  onSelectPersona,
  onStartFreeTalk,
  onNavigate,
  onChangeComplexity,
}: HomeViewProps) {
  const selectedPersona = personas.find((p) => p.id === selectedPersonaId) || personas[0];
  const practicedScenarios = scenarios.filter((s) => s.times_practiced > 0).length;

  return (
    <section aria-label="Startseite" className="home-view">
      {/* Hero Welcome Banner */}
      <div className="home-hero-card">
        <div className="home-hero-top">
          <div className="home-hero-identity">
            <img
              src="/logo.png"
              alt="C.AI Labs Logo"
              className="home-hero-logo"
              width={64}
              height={64}
            />
            <div>
              <div className="home-seal-row">
                <span className="chinese-seal" lang="zh-Hans">
                  中文口语
                </span>
                <span className="badge badge-gold">{profile.level}</span>
              </div>
              <h2 className="home-hero-title">
                Hallo {profile.name}, bereit für Chinesisch?
              </h2>
              <p className="home-hero-subtitle">
                Sprich locker mit deinen Lernpartnern, baue neue Vokabeln ein und verfolge deinen
                Fortschritt.
              </p>
            </div>
          </div>

          <div className="home-hero-actions">
            <button
              type="button"
              className="btn-primary btn-hero-cta"
              onClick={onStartFreeTalk}
            >
              <PhoneCall size={18} aria-hidden="true" />
              Free Talk mit {selectedPersona?.name_hanzi} starten
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => onNavigate('curriculum')}
            >
              <GraduationCap size={16} aria-hidden="true" />
              Thema wählen
            </button>
          </div>
        </div>

        {/* Quick partner picker right on start screen */}
        <div className="partner-pills" role="group" aria-label="Gesprächspartner wählen">
          {personas.map((p) => {
            const active = p.id === selectedPersona?.id;
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
      </div>

      {/* Time Tracking & Statistics */}
      <div className="stats-grid" aria-label="Lernstatistik">
        <article className="stat-card">
          <div className="stat-card-header">
            <Clock size={16} className="stat-icon-red" aria-hidden="true" />
            <span>Lernzeit</span>
          </div>
          <div className="stat-value">{formatDurationDe(stats.totalSeconds)}</div>
          <div className="stat-sub">
            Heute: {formatDurationDe(stats.todaySeconds)} · 7 Tage:{' '}
            {formatDurationDe(stats.weekSeconds)}
          </div>
        </article>

        <article className="stat-card">
          <div className="stat-card-header">
            <Sparkles size={16} className="stat-icon-gold" aria-hidden="true" />
            <span>Neue Wörter</span>
          </div>
          <div className="stat-value">+{stats.newWordsLast7Days}</div>
          <div className="stat-sub">
            Heute: +{stats.newWordsToday} · Gesamt: {stats.totalVocabulary} Wörter
          </div>
        </article>

        <article className="stat-card">
          <div className="stat-card-header">
            <BookOpen size={16} className="stat-icon-jade" aria-hidden="true" />
            <span>Wortschatz-Status</span>
          </div>
          <div className="stat-value">{stats.masteredWords} aktiv</div>
          <div className="stat-sub">{stats.dueWords} Wörter zur Wiederholung fällig</div>
        </article>

        <article className="stat-card">
          <div className="stat-card-header">
            <Flame size={16} className="stat-icon-red" aria-hidden="true" />
            <span>Gespräche & Serie</span>
          </div>
          <div className="stat-value">{stats.totalSessions} Gespräche</div>
          <div className="stat-sub">
            {stats.streakDays > 0
              ? `${stats.streakDays} ${stats.streakDays === 1 ? 'Tag' : 'Tage'} in Folge`
              : 'Starte heute deine Lernserie!'}
          </div>
        </article>
      </div>

      {/* Adaptive Sentence Length & Complexity Control */}
      <div className="panel-card complexity-bar">
        <div className="complexity-info">
          <div className="complexity-title">
            <SlidersHorizontal size={16} aria-hidden="true" />
            <span>Satzlänge &amp; Sprachkomplexität</span>
            <span className="badge badge-gold">{stats.progressionLabelDe}</span>
          </div>
          <p className="complexity-desc">
            Im Modus <strong>Auto</strong> beginnen deine Gesprächspartner mit kurzen, leicht
            verständlichen Sätzen und steigern Länge und Wortschatz automatisch mit deinem
            Fortschritt.
          </p>
        </div>

        <div className="complexity-pills" role="group" aria-label="Satzlänge wählen">
          {(
            [
              { id: 'auto', label: 'Auto (Empfohlen)' },
              { id: 'short', label: 'Kurz & Einfach' },
              { id: 'medium', label: 'Mittel' },
              { id: 'natural', label: 'Natürlich / Lang' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`partner-pill ${
                stats.sentenceComplexityPreference === opt.id ? 'active' : ''
              }`}
              onClick={() => onChangeComplexity(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Quick Navigation & Recent Sessions */}
      <div className="two-col-grid" style={{ marginBlockStart: '1rem' }}>
        <div className="panel-card">
          <h3 style={{ marginBlockEnd: '0.75rem' }}>Bereiche</h3>
          <div className="quick-nav-list">
            <button
              type="button"
              className="quick-nav-item"
              onClick={() => onNavigate('talk')}
            >
              <div>
                <strong>Free Talk</strong>
                <span>Freies Sprachgespräch mit Live-Vokabelkarten</span>
              </div>
              <ArrowRight size={16} aria-hidden="true" />
            </button>

            <button
              type="button"
              className="quick-nav-item"
              onClick={() => onNavigate('vocab')}
            >
              <div>
                <strong>Vokabeln ({stats.dueWords} fällig)</strong>
                <span>{stats.totalVocabulary} gespeicherte Wörter mit SRS-Wiederholung</span>
              </div>
              <ArrowRight size={16} aria-hidden="true" />
            </button>

            <button
              type="button"
              className="quick-nav-item"
              onClick={() => onNavigate('curriculum')}
            >
              <div>
                <strong>Themen &amp; Szenarien</strong>
                <span>
                  {practicedScenarios} von {scenarios.length} Alltagsszenarien geübt
                </span>
              </div>
              <ArrowRight size={16} aria-hidden="true" />
            </button>

            <button
              type="button"
              className="quick-nav-item"
              onClick={() => onNavigate('memory')}
            >
              <div>
                <strong>
                  <Brain size={14} aria-hidden="true" style={{ verticalAlign: 'middle' }} />{' '}
                  Gedächtnis ({memoryFactsCount})
                </strong>
                <span>Persönliche Fakten, Grammatik-Tipps &amp; Gesprächshistorie</span>
              </div>
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="panel-card">
          <h3 style={{ marginBlockEnd: '0.75rem' }}>
            <MessageSquare
              size={16}
              aria-hidden="true"
              style={{ verticalAlign: 'text-bottom', marginInlineEnd: '0.35rem' }}
            />
            Letzte Gespräche
          </h3>
          {recentSessions.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
              Noch keine abgeschlossenen Gespräche. Starte deinen ersten Free Talk!
            </p>
          ) : (
            <ul className="recent-sessions-list">
              {recentSessions.slice(0, 5).map((s) => (
                <li key={s.id} className="recent-session-item">
                  <div className="recent-session-meta">
                    <span>
                      {s.persona_emoji} <strong lang="zh-Hans">{s.persona_name}</strong>
                    </span>
                    <span className="badge">
                      {s.duration_seconds ? formatDurationDe(s.duration_seconds) : 'Gespräch'}
                    </span>
                  </div>
                  {s.summary_de && <p className="recent-session-summary">{s.summary_de}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
