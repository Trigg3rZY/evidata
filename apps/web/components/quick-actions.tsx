'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, RotateCcw } from 'lucide-react';
import type { Answer } from '@evidata/answer-contract';

/** Plain-text rendering of an Answer for the clipboard: the conclusion + findings. */
function answerToText(a: Answer): string {
  return [a.directAnswer, ...a.keyFindings.map((f) => `• ${f.text}`)].join('\n');
}

/** Per-answer quick actions (issues #39, #56): copy the answer, and (latest answer
 *  only) regenerate it in place — a new version with no new user turn. */
export function QuickActions({
  answer,
  onRerun,
  labels,
}: {
  answer: Answer;
  /** Regenerate the latest answer in place; absent on older turns. */
  onRerun?: (() => void) | undefined;
  labels: { copy: string; copied: string; rerun: string };
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const copy = (): void => {
    void navigator.clipboard?.writeText(answerToText(answer)).then(
      () => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      },
      () => {
        /* clipboard blocked (e.g. insecure context) — no-op */
      },
    );
  };

  const cls =
    'inline-flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="flex gap-1 text-xs text-muted-foreground">
      <button type="button" onClick={copy} aria-label={labels.copy} className={cls}>
        {copied ? (
          <Check className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden />
        )}
        {copied ? labels.copied : labels.copy}
      </button>
      {onRerun && (
        <button type="button" onClick={onRerun} aria-label={labels.rerun} className={cls}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          {labels.rerun}
        </button>
      )}
    </div>
  );
}
