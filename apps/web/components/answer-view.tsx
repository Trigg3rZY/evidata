import { TriangleAlert } from 'lucide-react';
import type { Answer, Evidence } from '@evidata/answer-contract';
import type { AnswerLabels } from '@/lib/i18n';
import { AnswerChart } from './answer-chart';
import { ConfidenceMeter } from './confidence-meter';
import { EvidenceSection } from './evidence-section';
import { QuickActions } from './quick-actions';
import { StatusBadge } from './status-badge';
import { UnblockPathView } from './unblock-path';

/**
 * Renders one Answer Contract document (spec 04 §2). A pure function of `answer`
 * plus a follow-up callback and resolved chrome `labels` — the same object the
 * smoke tests validate. It never calls `useI18n`; labels are threaded in so the
 * component (and its children) stay presentational.
 */
export function AnswerView({
  answer,
  onFollowup,
  onInspect,
  onRerun,
  labels,
}: {
  answer: Answer;
  onFollowup: (question: string) => void;
  /** Open an evidence item in the inspector (right pane); chips are static without it. */
  onInspect?: ((evidence: Evidence) => void) | undefined;
  /** Regenerate this answer in place (latest answer only). */
  onRerun?: (() => void) | undefined;
  labels: AnswerLabels;
}) {
  const byId = new Map(answer.evidence.map((e) => [e.id, e]));
  return (
    <article className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <StatusBadge status={answer.status} labels={labels.status} />
        <ConfidenceMeter
          confidence={answer.confidence}
          reason={answer.confidenceReason}
          labels={labels.confidence}
        />
        <span className="ml-auto text-xs text-muted-foreground">
          v{answer.meta.version}
          {answer.meta.isLatest ? ' · latest' : ''}
        </span>
      </header>

      <p className="text-[15px] leading-relaxed">{answer.directAnswer}</p>

      {answer.whatIDid && (
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer">{labels.whatIDid}</summary>
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
                {finding.evidenceIds.map((id) => {
                  const cls =
                    'ml-1 rounded bg-status-clarify-bg px-1.5 py-0.5 text-[11px] font-medium text-status-clarify';
                  const ev = byId.get(id);
                  return onInspect && ev ? (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onInspect(ev)}
                      aria-label={`${labels.evidence} ${id}`}
                      className={`${cls} hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                    >
                      {id}
                    </button>
                  ) : (
                    <span key={id} className={cls}>
                      {id}
                    </span>
                  );
                })}
              </span>
            </li>
          ))}
        </ul>
      )}

      {answer.charts && answer.charts.length > 0 && (
        <section className="flex flex-col gap-3">
          {answer.charts.map((chart) => (
            <AnswerChart key={chart.ref} chart={chart} />
          ))}
        </section>
      )}

      {answer.evidence.length > 0 && (
        <EvidenceSection evidence={answer.evidence} label={labels.evidence} />
      )}

      {answer.assumptions.length > 0 && (
        <section className="text-sm">
          <div className="font-medium">{labels.assumptions}</div>
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

      {answer.unblock && (
        <UnblockPathView
          unblock={answer.unblock}
          investigationId={answer.investigationId}
          onFollowup={onFollowup}
          labels={labels.unblock}
        />
      )}

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

      <div className="border-t border-border pt-2">
        <QuickActions answer={answer} onRerun={onRerun} labels={labels.actions} />
      </div>
    </article>
  );
}
