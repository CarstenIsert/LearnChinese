import React, { useEffect, useId } from 'react';
import { formatFactCategoryDe } from '../labels.ts';
import { SessionReflection } from '../types.ts';
import { formatDurationDe } from './HomeView.tsx';

interface SessionRecapDialogProps {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  recap: SessionReflection | null;
}

export function SessionRecapDialog({ dialogRef, recap }: SessionRecapDialogProps) {
  const titleId = useId();

  // Light-dismiss fallback for browsers without native HTMLDialogElement.prototype.closedBy
  useEffect(() => {
    if (typeof window === 'undefined' || !('HTMLDialogElement' in window)) return;
    if ('closedBy' in HTMLDialogElement.prototype) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    let pressedOutside = false;
    const isOutside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.target !== dialog) {
        pressedOutside = false;
        return;
      }
      pressedOutside = isOutside(e);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.target === dialog && pressedOutside && isOutside(e)) {
        dialog.close();
      }
    };
    dialog.addEventListener('pointerdown', onPointerDown);
    dialog.addEventListener('pointerup', onPointerUp);
    return () => {
      dialog.removeEventListener('pointerdown', onPointerDown);
      dialog.removeEventListener('pointerup', onPointerUp);
    };
  }, [dialogRef]);

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as any)}
      aria-labelledby={titleId}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          marginBlockEnd: '0.85rem',
        }}
      >
        <h2 id={titleId} style={{ margin: 0 }}>
          Gesprächs-Auswertung
        </h2>
        {recap?.duration_seconds !== undefined && recap.duration_seconds > 0 && (
          <span className="badge badge-gold">Dauer: {formatDurationDe(recap.duration_seconds)}</span>
        )}
      </div>
      {recap && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <div className="panel-card">
            <p style={{ margin: 0 }}>{recap.summary_de}</p>
          </div>

          {recap.tone_feedback && recap.tone_feedback.length > 0 && (
            <div className="panel-card">
              <h3 style={{ marginBlockEnd: '0.45rem' }}>Ton- &amp; Aussprache-Analyse (Audio)</h3>
              {recap.tone_feedback.map((tf, i) => (
                <div
                  key={i}
                  style={{
                    paddingBlock: '0.45rem',
                    borderBlockEnd:
                      i < recap.tone_feedback!.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--amber)' }}>
                    <span lang="zh-Hans">{tf.word_or_phrase}</span> ({tf.pinyin})
                  </div>
                  <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                    Gehört: {tf.what_was_heard}
                  </div>
                  <div style={{ fontSize: '0.86rem', marginBlockStart: '0.15rem' }}>
                    {tf.correction_de}
                  </div>
                </div>
              ))}
            </div>
          )}

          {recap.new_facts && recap.new_facts.length > 0 && (
            <div className="panel-card">
              <h3 style={{ marginBlockEnd: '0.35rem' }}>Neue Erinnerungen</h3>
              <ul style={{ margin: 0, paddingInlineStart: '1.2rem' }}>
                {recap.new_facts.map((nf, i) => (
                  <li key={i}>
                    <span className="badge">{formatFactCategoryDe(nf.category)}</span> {nf.fact}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {recap.coaching_tips && recap.coaching_tips.length > 0 && (
            <div className="panel-card">
              <h3 style={{ marginBlockEnd: '0.45rem' }}>Tipps zum Ausdruck</h3>
              {recap.coaching_tips.map((tip, i) => (
                <div
                  key={i}
                  style={{
                    paddingBlock: '0.45rem',
                    borderBlockEnd:
                      i < recap.coaching_tips.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                    Dein Satz: <span lang="zh-Hans">{tip.what_you_said}</span>
                  </div>
                  <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--emerald)' }}>
                    Besser: <span lang="zh-Hans">{tip.better_taiwan_mandarin}</span> ({tip.pinyin})
                  </div>
                  <div style={{ fontSize: '0.86rem', marginBlockStart: '0.15rem' }}>
                    {tip.explanation_de}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <form method="dialog" style={{ marginBlockStart: '1rem', textAlign: 'right' }}>
        <button type="submit" className="btn-primary" autoFocus>
          Schließen
        </button>
      </form>
    </dialog>
  );
}
