import type { Confidence } from '@evidata/answer-contract';

// Confidence is a quiet, monochrome signal — never status color (spec 11 §4).
const FILLED: Record<Confidence, number> = { High: 3, Medium: 2, Low: 1, CannotDetermine: 0 };
const LABEL: Record<Confidence, string> = {
  High: 'High',
  Medium: 'Medium',
  Low: 'Low',
  CannotDetermine: 'Undetermined',
};

export function ConfidenceMeter({
  confidence,
  reason,
}: {
  confidence: Confidence;
  reason?: string;
}) {
  const filled = FILLED[confidence];
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      title={reason}
      aria-label={`Confidence: ${LABEL[confidence]}${reason ? ` — ${reason}` : ''}`}
    >
      Confidence
      <span className="inline-flex items-center gap-0.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`h-3 w-1 rounded-sm ${i < filled ? 'bg-muted-foreground' : 'border border-border'}`}
          />
        ))}
      </span>
      {LABEL[confidence]}
    </span>
  );
}
