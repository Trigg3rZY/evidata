'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { ModelPicker } from '@/components/model-picker';

export function Composer({
  onSubmit,
  onStop,
  streaming,
  disabled,
  placeholder,
  stopLabel,
  draft,
  draftVersion,
}: {
  onSubmit: (question: string) => void;
  onStop?: () => void;
  streaming?: boolean;
  disabled?: boolean;
  placeholder: string;
  stopLabel: string;
  draft?: string;
  draftVersion?: number;
}) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!draft) return;
    setValue(draft);
    textareaRef.current?.focus();
    textareaRef.current?.setSelectionRange(draft.length, draft.length);
  }, [draft, draftVersion]);

  const submit = (): void => {
    const question = value.trim();
    if (question && !disabled) {
      onSubmit(question);
      setValue('');
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card focus-within:border-primary focus-within:ring-2 focus-within:ring-ring">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Don't submit while an IME composition is active — the Enter that
          // confirms candidates (e.g. a Chinese IME) must not send the message.
          // `isComposing` covers modern browsers; keyCode 229 is the legacy signal.
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
            e.preventDefault();
            submit();
          }
        }}
        rows={2}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full resize-none rounded-2xl bg-transparent px-4 pt-3 text-sm outline-none placeholder:text-muted-foreground"
      />
      {/* Bottom action row: the model picker sits in the composer's bottom-right,
          just left of Send (#154) — closest to the act of asking, like Claude/Cursor. */}
      <div className="flex items-center justify-end gap-2 px-3 pb-2">
        <ModelPicker />
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label={stopLabel}
            title={stopLabel}
            className="grid h-8 w-8 place-items-center rounded-lg bg-secondary text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={disabled || !value.trim()}
            aria-label="Send"
            className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
