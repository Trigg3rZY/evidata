import { Check, Loader2 } from 'lucide-react';
import type { ProgressStep } from '@/lib/use-investigation-stream';

/** Transient streamed reasoning/query steps (spec 03 §6); announced politely. */
export function ReasoningStream({ progress }: { progress: ProgressStep[] }) {
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
    </div>
  );
}
