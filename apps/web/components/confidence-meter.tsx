import type { Confidence } from '@evidata/answer-contract';

// Confidence is a quiet, monochrome signal — never status color (spec 11 §4).
const FILLED: Record<Confidence, number> = { High: 3, Medium: 2, Low: 1, CannotDetermine: 0 };

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
            className={`h-3 w-1 rounded-sm ${i < filled ? 'bg-muted-foreground' : 'border border-border'}`}
          />
        ))}
      </span>
      {level}
    </span>
  );
}
