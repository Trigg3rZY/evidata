'use client';

import { useState } from 'react';
import { Check, Lock } from 'lucide-react';
import type { UnblockAction, UnblockPath } from '@evidata/answer-contract';
import { Button } from '@/components/ui/button';

/**
 * The constructive "what's missing + next steps" panel for any non-Answered
 * result. M0: actions that create a Suggestion acknowledge inline; actions that
 * carry a follow-up question re-ask. Other actions are guidance (display-only).
 */
export function UnblockPathView({
  unblock,
  onFollowup,
  labels,
}: {
  unblock: UnblockPath;
  onFollowup: (question: string) => void;
  labels: { whatsMissing: string; recordedForAdmin: string; notExecuted: string };
}) {
  const [noted, setNoted] = useState<Set<number>>(new Set());
  const [openDraft, setOpenDraft] = useState<Set<number>>(new Set());

  const toggleDraft = (index: number): void =>
    setOpenDraft((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const handle = (action: UnblockAction, index: number): void => {
    if (action.kind === 'view_mutation_draft') {
      toggleDraft(index); // reveal the proposed write read-only — it never executes
      return;
    }
    if (action.createsSuggestion) {
      setNoted((prev) => new Set(prev).add(index));
      return;
    }
    const followup = action.choices?.find((c) => c.followupQuestion)?.followupQuestion;
    if (followup) onFollowup(followup);
  };

  return (
    <div className="rounded-md border border-border bg-secondary px-4 py-3">
      <div className="text-sm font-medium">{labels.whatsMissing}</div>
      <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
        {unblock.whatsMissing.map((m, i) => (
          <li key={i}>{m.description}</li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        {unblock.nextSteps.map((action, i) =>
          noted.has(i) ? (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 rounded-md bg-status-answered-bg px-3 py-1.5 text-xs font-medium text-status-answered"
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
              {labels.recordedForAdmin}
            </span>
          ) : (
            <Button
              key={i}
              variant="outline"
              size="sm"
              onClick={() => handle(action, i)}
              {...(action.kind === 'view_mutation_draft'
                ? { 'aria-expanded': openDraft.has(i) }
                : {})}
            >
              {action.label}
            </Button>
          ),
        )}
      </div>

      {/* Proposed write(s), shown read-only — rejected by the gate, never executed. */}
      {unblock.nextSteps.map((action, i) =>
        action.kind === 'view_mutation_draft' && action.draftSql && openDraft.has(i) ? (
          <div key={i} className="mt-2 overflow-hidden rounded-md border border-border bg-card">
            <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" aria-hidden />
              {labels.notExecuted}
            </div>
            <pre className="overflow-x-auto px-3 py-2 font-mono text-xs leading-relaxed">
              {action.draftSql}
            </pre>
          </div>
        ) : null,
      )}
    </div>
  );
}
