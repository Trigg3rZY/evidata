import { TriangleAlert } from 'lucide-react';
import type { Answer } from '@evidata/answer-contract';
import { ConfidenceMeter } from './confidence-meter';
import { EvidenceItem } from './evidence-item';
import { StatusBadge } from './status-badge';
import { UnblockPathView } from './unblock-path';

/**
 * Renders one Answer Contract document (spec 04 §2). A pure function of `answer`
 * plus a follow-up callback — the same object the smoke tests validate.
 */
export function AnswerView({
  answer,
  onFollowup,
}: {
  answer: Answer;
  onFollowup: (question: string) => void;
}) {
  return (
    <article className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <StatusBadge status={answer.status} />
        <ConfidenceMeter confidence={answer.confidence} reason={answer.confidenceReason} />
        <span className="ml-auto text-xs text-muted-foreground">
          v{answer.meta.version}
          {answer.meta.isLatest ? ' · latest' : ''}
        </span>
      </header>

      <p className="text-[15px] leading-relaxed">{answer.directAnswer}</p>

      {answer.whatIDid && (
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer">What I did</summary>
          <p className="mt-1 leading-relaxed">{answer.whatIDid}</p>
        </details>
      )}

      {answer.keyFindings.length > 0 && (
        <ul className="flex flex-col gap-2">
          {answer.keyFindings.map((finding, i) => (
            <li key={i} className="flex items-start gap-2 text-sm leading-relaxed">
              <span
                className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground"
                aria-hidden
              />
              <span>
                {finding.text}{' '}
                {finding.evidenceIds.map((id) => (
                  <span
                    key={id}
                    className="ml-1 rounded bg-status-clarify-bg px-1.5 py-0.5 text-[11px] font-medium text-status-clarify"
                  >
                    {id}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}

      {answer.evidence.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="text-xs font-medium text-muted-foreground">Evidence</div>
          {answer.evidence.map((e) => (
            <EvidenceItem key={e.id} evidence={e} />
          ))}
        </section>
      )}

      {answer.assumptions.length > 0 && (
        <section className="text-sm">
          <div className="font-medium">Assumptions</div>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {answer.assumptions.map((a, i) => (
              <li key={i}>{a.text}</li>
            ))}
          </ul>
        </section>
      )}

      {answer.caveats.length > 0 && (
        <section className="flex flex-col gap-1.5">
          {answer.caveats.map((caveat, i) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded-md bg-status-partial-bg px-3 py-2 text-xs text-status-partial"
            >
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{caveat}</span>
            </div>
          ))}
        </section>
      )}

      {answer.unblock && <UnblockPathView unblock={answer.unblock} onFollowup={onFollowup} />}

      {answer.recommendedFollowups.length > 0 && (
        <section className="flex flex-wrap gap-2">
          {answer.recommendedFollowups.map((f, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onFollowup(f.question)}
              className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
            >
              {f.question}
            </button>
          ))}
        </section>
      )}
    </article>
  );
}
