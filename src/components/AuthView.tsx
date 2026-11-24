import React, { useEffect, useState } from 'react';
import { Bot, KeyRound, LogIn, UserPlus } from 'lucide-react';
import { AuthUser } from '../types.ts';
import { LegalTab } from './LegalDialog.tsx';

interface AuthViewProps {
  requiresBootstrapAdmin: boolean;
  onAuthenticated: (user: AuthUser) => void;
  onOpenLegal: (tab: LegalTab) => void;
}

export function AuthView({
  requiresBootstrapAdmin,
  onAuthenticated,
  onOpenLegal,
}: AuthViewProps) {
  const [mode, setMode] = useState<'login' | 'register'>(() => {
    if (requiresBootstrapAdmin) return 'register';
    const params = new URLSearchParams(window.location.search);
    return params.get('invite') ? 'register' : 'login';
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('invite') || '';
  });
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (requiresBootstrapAdmin) {
      setMode('register');
    }
  }, [requiresBootstrapAdmin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const payload =
        mode === 'login'
          ? { email, password }
          : {
              email,
              password,
              displayName,
              inviteCode: requiresBootstrapAdmin ? undefined : inviteCode,
            };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = (await res.json().catch(() => ({}))) as {
        user?: AuthUser;
        error?: string;
      };

      if (!res.ok || !data.user) {
        setError(data.error || 'Anmeldung fehlgeschlagen.');
        return;
      }

      if (window.location.search.includes('invite=')) {
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);
      }

      onAuthenticated(data.user);
    } catch {
      setError('Verbindung zum Server fehlgeschlagen.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <img src="/logo.png" alt="C.AI Labs" className="brand-logo" width={44} height={44} />
          <div>
            <h1 className="brand-title">CAI Labs Learn Chinese</h1>
            <p className="brand-subtitle" lang="zh-Hans">
              中文对话
            </p>
          </div>
        </div>

        <div className="auth-tabs" role="tablist" aria-label="Anmeldung oder Registrierung">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={`btn-tab ${mode === 'login' ? 'is-active' : ''}`}
            onClick={() => {
              setMode('login');
              setError('');
            }}
          >
            <LogIn size={15} aria-hidden="true" />
            Anmelden
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={`btn-tab ${mode === 'register' ? 'is-active' : ''}`}
            onClick={() => {
              setMode('register');
              setError('');
            }}
          >
            <UserPlus size={15} aria-hidden="true" />
            Registrieren
          </button>
        </div>

        {requiresBootstrapAdmin && mode === 'register' && (
          <div className="auth-notice" role="status">
            <KeyRound size={16} aria-hidden="true" />
            <span>
              Erster Account: Du wirst automatisch als <strong>Admin</strong> eingerichtet (kein
              Einladungscode nötig).
            </span>
          </div>
        )}

        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="auth-field">
              <label htmlFor="auth-display-name">Dein Name</label>
              <input
                id="auth-display-name"
                type="text"
                autoComplete="name"
                required
                placeholder="z. B. Alex"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
          )}

          <div className="auth-field">
            <label htmlFor="auth-email">E-Mail</label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              required
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="auth-field">
            <label htmlFor="auth-password">Passwort</label>
            <input
              id="auth-password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'register' ? 8 : undefined}
              placeholder={mode === 'register' ? 'Mindestens 8 Zeichen' : '••••••••'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {mode === 'register' && !requiresBootstrapAdmin && (
            <div className="auth-field">
              <label htmlFor="auth-invite-code">Einladungscode</label>
              <input
                id="auth-invite-code"
                type="text"
                required
                placeholder="Code vom Admin"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
              />
            </div>
          )}

          <button type="submit" className="btn-primary auth-submit" disabled={isSubmitting}>
            {isSubmitting
              ? 'Bitte warten...'
              : mode === 'login'
                ? 'Anmelden'
                : 'Account erstellen'}
          </button>
        </form>

        <p className="ai-disclosure-note">
          <Bot size={14} aria-hidden="true" />
          <span>
            KI-Hinweis (EU AI Act): Gesprächspartner werden durch Google Gemini simuliert;
            Sprache und Antworten werden KI-gestützt erzeugt.
          </span>
        </p>

        <div className="legal-links-row">
          <button type="button" className="btn-link" onClick={() => onOpenLegal('impressum')}>
            Impressum
          </button>
          <span aria-hidden="true">·</span>
          <button type="button" className="btn-link" onClick={() => onOpenLegal('privacy')}>
            Datenschutz &amp; KI-Hinweis
          </button>
        </div>
      </div>
    </main>
  );
}
