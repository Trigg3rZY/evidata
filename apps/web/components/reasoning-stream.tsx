import { Check, Loader2 } from 'lucide-react';
import type { ProgressStep } from '@/lib/use-investigation-stream';

/**
 * Transient streamed reasoning/query steps (spec 03 §6); announced politely.
 * A completed step gets a check; a running query shows a spinner. When no step is
 * actively running, a trailing "Thinking…" line shows the model is working on the
 * next step — so progress reads as live ("executing…/thinking…") rather than each
 * step snapping straight to a checkmark (issue #66).
 */
export function ReasoningStream({
  progress,
  thinkingLabel,
}: {
  progress: ProgressStep[];
  thinkingLabel: string;
}) {
  const last = progress[progress.length - 1];
  const activeQuery = last?.kind === 'query' && last.state === 'running';
  return (
    <div className="flex flex-col gap-1.5 text-sm text-muted-foreground" aria-live="polite">
      {progress.map((step, i) => {
        const running = step.kind === 'query' && step.state === 'running';
        return (
          <div key={i} className="flex items-center gap-2">
            {running ? (
              <Loader2
                className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            ) : (
              <Check className="h-3.5 w-3.5 text-status-answered" aria-hidden />
            )}
            <span>{step.label}</span>
          </div>
        );
      })}
      {/* Between steps (nothing actively querying), surface the model's ongoing work. */}
      {!activeQuery && (
        <div className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          <span>{thinkingLabel}</span>
        </div>
      )}
    </div>
  );
}
