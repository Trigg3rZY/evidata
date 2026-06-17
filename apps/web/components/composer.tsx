'use client';

import { useState } from 'react';
import { ArrowUp, Database } from 'lucide-react';

export function Composer({
  onSubmit,
  disabled,
  dataSourceName,
  placeholder,
}: {
  onSubmit: (question: string) => void;
  disabled?: boolean;
  dataSourceName: string;
  placeholder: string;
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
          if (e.key === 'Enter' && !e.shiftKey) {
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
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
          <Database className="h-3 w-3" aria-hidden />
          {dataSourceName}
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !value.trim()}
          aria-label="Send"
          className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
