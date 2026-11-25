import React, { useEffect, useRef } from 'react';

interface ModalDialogProps {
  dialogRef?: React.RefObject<HTMLDialogElement | null>;
  isOpen?: boolean;
  onClose?: () => void;
  className?: string;
  'aria-labelledby'?: string;
  children: React.ReactNode;
}

export function ModalDialog({
  dialogRef,
  isOpen,
  onClose,
  className,
  'aria-labelledby': ariaLabelledBy,
  children,
}: ModalDialogProps) {
  const internalRef = useRef<HTMLDialogElement | null>(null);
  const resolvedRef = dialogRef ?? internalRef;

  useEffect(() => {
    if (isOpen === undefined) return;
    const dialog = resolvedRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen, resolvedRef]);

  useEffect(() => {
    const dialog = resolvedRef.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      e.preventDefault();
      if (dialog.open) dialog.close();
      onClose?.();
    };

    let pressedOutside = false;
    const isOutside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    const onPointerDown = (e: PointerEvent) => {
      pressedOutside = e.target === dialog && isOutside(e);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.target === dialog && pressedOutside && isOutside(e)) {
        if (dialog.open) dialog.close();
        onClose?.();
      }
    };
    const handleClick = (e: MouseEvent) => {
      if (e.target === dialog) {
        if (dialog.open) dialog.close();
        onClose?.();
      }
    };

    dialog.addEventListener('cancel', handleCancel);
    dialog.addEventListener('click', handleClick);
    const hasNativeClosedBy =
      typeof window !== 'undefined' &&
      'HTMLDialogElement' in window &&
      'closedBy' in HTMLDialogElement.prototype;
    if (!hasNativeClosedBy) {
      dialog.addEventListener('pointerdown', onPointerDown);
      dialog.addEventListener('pointerup', onPointerUp);
    }

    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('click', handleClick);
      if (!hasNativeClosedBy) {
        dialog.removeEventListener('pointerdown', onPointerDown);
        dialog.removeEventListener('pointerup', onPointerUp);
      }
    };
  }, [onClose, resolvedRef]);

  return (
    <dialog
      ref={resolvedRef}
      closedby="any"
      className={className}
      aria-labelledby={ariaLabelledBy}
    >
      {children}
    </dialog>
  );
}
