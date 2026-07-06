'use client';

import { useState } from 'react';
import { Check, Lock } from 'lucide-react';
import type { UnblockAction, UnblockPath } from '@evidata/answer-contract';
import { Button } from '@/components/ui/button';

/**
 * The constructive "what's missing + next steps" panel for any non-Answered
 * result. Suggestion actions (`request_access` / `notify_admin_verify` /
 * `pick_definition`)
 * persist a real Suggestion to the investigation's review queue (M2-B4, #123) and
 * then acknowledge inline; actions that carry a follow-up question re-ask.
 */
const CORRECTION_KINDS = new Set(['notify_admin_verify', 'pick_definition']);

export const shouldFileSuggestion = (action: Pick<UnblockAction, 'kind' | 'createsSuggestion'>) =>
  action.createsSuggestion === true || CORRECTION_KINDS.has(action.kind);

export const canRevealMutationDraft = (action: Pick<UnblockAction, 'kind' | 'draftSql'>) =>
  action.kind === 'view_mutation_draft' && Boolean(action.draftSql);

type CorrectionAck = 'recorded' | 'sample';
type CorrectionStatus = CorrectionAck | 'pending';

export const correctionAckFromResponse = (res: Pick<Response, 'ok'> | null): CorrectionAck =>
  res?.ok ? 'recorded' : 'sample';

export function UnblockPathView({
  unblock,
  investigationId,
  onFollowup,
  onNarrowQuestion,
  labels,
}: {
  unblock: UnblockPath;
  /** The investigation this answer belongs to — the correction is filed against it. */
  investigationId?: string;
  onFollowup: (question: string) => void;
  onNarrowQuestion?: (() => void) | undefined;
  labels: {
    whatsMissing: string;
    recordedForAdmin: string;
    sampleNotReviewed: string;
    notExecuted: string;
  };
}) {
  const [correctionStatus, setCorrectionStatus] = useState<Record<number, CorrectionStatus>>({});
  const [openDraft, setOpenDraft] = useState<Set<number>>(new Set());

  const toggleDraft = (index: number): void =>
    setOpenDraft((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  // File a correction against the investigation's review queue when we can; Sample /
  // anonymous paths are acknowledged separately because nothing is persisted there.
  const fileCorrection = async (action: UnblockAction, index: number): Promise<void> => {
    if (correctionStatus[index] === 'pending') return;
    setCorrectionStatus((prev) => ({ ...prev, [index]: 'pending' }));
    const res = investigationId
      ? await fetch(`/api/investigations/${encodeURIComponent(investigationId)}/suggestions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: action.kind,
            description: unblock.whatsMissing.map((m) => m.description).join('; '),
            targetRef: unblock.whatsMissing[0]?.description ?? null,
          }),
        }).catch(() => null)
      : null;
    setCorrectionStatus((prev) => ({ ...prev, [index]: correctionAckFromResponse(res) }));
  };

  const handle = (action: UnblockAction, index: number): void => {
    if (action.kind === 'view_mutation_draft') {
      if (!canRevealMutationDraft(action)) return;
      toggleDraft(index); // reveal the proposed write read-only — it never executes
      return;
    }
    if (action.kind === 'narrow_question') {
      onNarrowQuestion?.();
      return;
    }
    if (shouldFileSuggestion(action)) {
      void fileCorrection(action, index);
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
        {unblock.nextSteps.map((action, i) => {
          const status = correctionStatus[i];
          return status && status !== 'pending' ? (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 rounded-md bg-status-answered-bg px-3 py-1.5 text-xs font-medium text-status-answered"
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
              {status === 'recorded' ? labels.recordedForAdmin : labels.sampleNotReviewed}
            </span>
          ) : (
            <Button
              key={i}
              variant="outline"
              size="sm"
              disabled={
                status === 'pending' ||
                (action.kind === 'view_mutation_draft' && !canRevealMutationDraft(action)) ||
                (action.kind === 'narrow_question' && !onNarrowQuestion)
              }
              onClick={() => handle(action, i)}
              {...(action.kind === 'view_mutation_draft'
                ? { 'aria-expanded': openDraft.has(i) }
                : {})}
            >
              {action.label}
            </Button>
          );
        })}
      </div>

      {/* Proposed write(s), shown read-only — rejected by the gate, never executed. */}
      {unblock.nextSteps.map((action, i) =>
        canRevealMutationDraft(action) && openDraft.has(i) ? (
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
