import type { Evidence } from '@evidata/answer-contract';
import { EvidenceItem } from './evidence-item';

/**
 * Evidence, collapsed by default (spec 13 / issue #48). The full list can run long
 * and most readers don't open every item, so it's progressive disclosure: the Key
 * Findings' citation chips (E1, E2…) keep the "evidence-backed" signal visible, and
 * the auditor expands this for the bounded SQL behind each item. Native <details>
 * keeps it keyboard-accessible without client state.
 */
export function EvidenceSection({
  evidence,
  label,
}: {
  evidence: readonly Evidence[];
  label: string;
}) {
  return (
    <details className="group">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
        {label} ({evidence.length})
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        {evidence.map((e) => (
          <EvidenceItem key={e.id} evidence={e} />
        ))}
      </div>
    </details>
  );
}
