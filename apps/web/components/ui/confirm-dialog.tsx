'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Called when the user confirms the destructive action. */
  onConfirm: () => void;
  /** Called when the user cancels — Cancel button, Escape, or overlay click. */
  onCancel: () => void;
}

/**
 * App-owned confirmation dialog for destructive actions. Replaces the native
 * `window.confirm`, which blocks browser automation and breaks out of the app's
 * visual surface (#165). Minimal: overlay + card, dismiss via Cancel / Escape /
 * overlay click; focus lands on the non-destructive button so a stray Enter never
 * confirms a destructive op, and Tab is trapped between the two actions so the
 * keyboard can't reach the page behind the overlay while a confirm is pending
 * (Codex P2).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      // Trap focus between the two actions so the keyboard can't reach the page
      // behind the overlay while a destructive confirm is pending (Codex P2).
      const targets = [cancelRef.current, confirmRef.current].filter(
        (el): el is HTMLButtonElement => el !== null,
      );
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-medium">{title}</h2>
        {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="ghost" ref={cancelRef} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button size="sm" ref={confirmRef} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
