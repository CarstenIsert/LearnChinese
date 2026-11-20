import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Plus, X } from 'lucide-react';
import { InviteCode } from '../types.ts';

interface InviteDialogProps {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  isOpen: boolean;
  onClose: () => void;
}

export function InviteDialog({ dialogRef, isOpen, onClose }: InviteDialogProps) {
  const [invites, setInvites] = useState<InviteCode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadInvites = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/invites');
      if (!res.ok) throw new Error('Konnte Einladungen nicht laden.');
      const data = (await res.json()) as { invites: InviteCode[] };
      setInvites(data.invites || []);
    } catch (err: any) {
      setError(err?.message || 'Fehler beim Laden.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadInvites();
    }
  }, [isOpen, loadInvites]);

  const handleCreateInvite = async () => {
    setIsCreating(true);
    setError('');
    try {
      const res = await fetch('/api/auth/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresInDays: 7 }),
      });
      if (!res.ok) throw new Error('Einladung konnte nicht erstellt werden.');
      await loadInvites();
    } catch (err: any) {
      setError(err?.message || 'Fehler beim Erstellen.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopyInviteLink = async (code: string) => {
    const link = `${window.location.origin}/?invite=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedCode(code);
      window.setTimeout(() => setCopiedCode((prev) => (prev === code ? null : prev)), 2200);
    } catch {
      // Fallback if clipboard is unavailable
      window.prompt('Einladungslink kopieren:', link);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      closedby="any"
      aria-labelledby="invite-dialog-title"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          dialogRef.current.close();
          onClose();
        }
      }}
    >
      <div className="dialog-header">
        <div>
          <h2 id="invite-dialog-title" style={{ margin: 0 }}>
            Einladungscodes
          </h2>
          <p className="muted-text" style={{ margin: '0.25rem 0 0' }}>
            Jeder Code gilt für eine einmalige Registrierung (7 Tage gültig).
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost"
          aria-label="Schließen"
          onClick={() => {
            dialogRef.current?.close();
            onClose();
          }}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      {error && (
        <div className="error-banner" role="alert" style={{ marginBlock: '0.75rem' }}>
          <span>{error}</span>
        </div>
      )}

      <div style={{ marginBlock: '1rem' }}>
        <button
          type="button"
          className="btn-primary"
          onClick={handleCreateInvite}
          disabled={isCreating}
        >
          <Plus size={16} aria-hidden="true" />
          {isCreating ? 'Erstelle...' : 'Neuen Einladungslink erstellen'}
        </button>
      </div>

      {isLoading ? (
        <p className="muted-text">Lade Einladungen...</p>
      ) : invites.length === 0 ? (
        <p className="muted-text">Noch keine Einladungscodes erstellt.</p>
      ) : (
        <ul className="invite-list">
          {invites.map((inv) => {
            const isUsed = inv.used_by_user_id !== null;
            const isExpired =
              !isUsed && inv.expires_at ? Date.parse(inv.expires_at) <= Date.now() : false;
            const statusLabel = isUsed ? 'Eingelöst' : isExpired ? 'Abgelaufen' : 'Aktiv';

            return (
              <li key={inv.code} className="invite-row">
                <div>
                  <code className="invite-code">{inv.code}</code>
                  <span
                    className={`invite-badge ${
                      isUsed ? 'is-used' : isExpired ? 'is-expired' : 'is-active'
                    }`}
                  >
                    {statusLabel}
                  </span>
                </div>
                {!isUsed && !isExpired && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => handleCopyInviteLink(inv.code)}
                  >
                    {copiedCode === inv.code ? (
                      <>
                        <Check size={14} aria-hidden="true" /> Kopiert
                      </>
                    ) : (
                      <>
                        <Copy size={14} aria-hidden="true" /> Link kopieren
                      </>
                    )}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </dialog>
  );
}
