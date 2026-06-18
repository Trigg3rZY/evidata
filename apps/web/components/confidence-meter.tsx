import type { Confidence } from '@evidata/answer-contract';

const FILLED: Record<Confidence, number> = { High: 3, Medium: 2, Low: 1, CannotDetermine: 0 };

// A subtle per-level tint on the (tiny) bars — quieter than the status badge, and
// secondary to the textual level (the meter is aria-hidden; the level word carries
// the meaning for a11y / colorblind). Green→amber→grey; red stays reserved for
// BlockedByPolicy (spec 11 §4), so Low/CannotDetermine read grey, never alarming.
const BAR: Record<Confidence, string> = {
  High: 'bg-status-answered',
  Medium: 'bg-status-partial',
  Low: 'bg-muted-foreground',
  CannotDetermine: 'bg-muted-foreground',
};

export function ConfidenceMeter({
  confidence,
  reason,
  labels,
}: {
  confidence: Confidence;
  reason?: string;
  labels: { label: string; levels: Record<Confidence, string> };
}) {
  const filled = FILLED[confidence];
  const level = labels.levels[confidence];
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      title={reason}
      aria-label={`${labels.label}: ${level}${reason ? ` — ${reason}` : ''}`}
    >
      {labels.label}
      <span className="inline-flex items-center gap-0.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`h-3 w-1 rounded-sm ${i < filled ? BAR[confidence] : 'border border-border'}`}
          />
        ))}
      </span>
      {level}
    </span>
  );
}
