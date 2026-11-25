import React, { useCallback, useState } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { ModalDialog } from './ModalDialog.tsx';

interface DeleteAccountDialogProps {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  userEmail: string;
  onClose?: () => void;
  onDeleted: () => void;
}

export function DeleteAccountDialog({
  dialogRef,
  userEmail,
  onClose,
  onDeleted,
}: DeleteAccountDialogProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const handleClose = useCallback(() => {
    setPassword('');
    setError('');
    onClose?.();
  }, [onClose]);

  const closeDialog = () => {
    dialogRef.current?.close();
    handleClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsDeleting(true);
    try {
      const res = await fetch('/api/auth/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error || 'Konto konnte nicht gelöscht werden.');
        return;
      }
      dialogRef.current?.close();
      setPassword('');
      onDeleted();
    } catch {
      setError('Verbindung zum Server fehlgeschlagen.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <ModalDialog
      dialogRef={dialogRef}
      className="delete-account-dialog"
      aria-labelledby="delete-account-title"
      onClose={handleClose}
    >
      <div className="dialog-header">
        <h2 id="delete-account-title">Konto unwiderruflich löschen</h2>
        <button type="button" className="btn-icon" onClick={closeDialog} aria-label="Schließen">
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="delete-account-warning">
        <AlertTriangle size={18} aria-hidden="true" />
        <p>
          Alle Daten für <strong>{userEmail}</strong> (Vokabeln, Gesprächsverlauf,
          Gesprächspartner und Erinnerungen) werden sofort und dauerhaft gelöscht.
        </p>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
        </div>
      )}

      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="auth-field">
          <label htmlFor="delete-account-password">Zur Bestätigung Passwort eingeben</label>
          <input
            id="delete-account-password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="Dein Passwort"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <div className="dialog-actions">
          <button type="button" className="btn-secondary" onClick={closeDialog}>
            Abbrechen
          </button>
          <button type="submit" className="btn-danger" disabled={isDeleting || !password}>
            <Trash2 size={15} aria-hidden="true" />
            {isDeleting ? 'Lösche Konto...' : 'Endgültig löschen'}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
