'use client';

import { useId, type ReactNode } from 'react';

/** A labeled input — shared by the auth + connection forms. */
export function Field({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  autoComplete,
  placeholder,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  placeholder?: string;
  /** Optional control (e.g. a <select>) rendered instead of the default input. */
  children?: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children ? (
        children(id)
      ) : (
        <input
          id={id}
          type={type}
          value={value}
          required={required}
          autoComplete={autoComplete}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring"
        />
      )}
    </label>
  );
}
