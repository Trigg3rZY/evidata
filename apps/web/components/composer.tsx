'use client';

import { useState } from 'react';
import { ArrowUp, Database, Square } from 'lucide-react';

export function Composer({
  onSubmit,
  onStop,
  streaming,
  disabled,
  dataSourceName,
  dataSources,
  dataSourceId,
  onDataSourceChange,
  dataSourceLabel,
  sourceLocked,
  placeholder,
  stopLabel,
}: {
  onSubmit: (question: string) => void;
  onStop?: () => void;
  streaming?: boolean;
  disabled?: boolean;
  dataSourceName: string;
  /** Available sources; a real selector renders only when there's more than one. */
  dataSources?: ReadonlyArray<{ id: string; name: string }>;
  dataSourceId?: string;
  onDataSourceChange?: (id: string) => void;
  dataSourceLabel?: string;
  /** Lock the selector once a thread is active — a source is bound for its lifetime. */
  sourceLocked?: boolean;
  placeholder: string;
  stopLabel: string;
}) {
  const [value, setValue] = useState('');

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
      <div className="flex items-center justify-between px-3 pb-2">
        {dataSources && dataSources.length > 1 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">
            <Database className="h-3 w-3" aria-hidden />
            <select
              value={dataSourceId}
              onChange={(e) => onDataSourceChange?.(e.target.value)}
              disabled={sourceLocked}
              aria-label={dataSourceLabel ?? 'Data source'}
              className="bg-transparent text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-100"
            >
              {dataSources.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
            <Database className="h-3 w-3" aria-hidden />
            {dataSourceName}
          </span>
        )}
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
