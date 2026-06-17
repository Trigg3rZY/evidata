import { Database, Lock } from 'lucide-react';
import type { Evidence } from '@evidata/answer-contract';

/** One Evidence card: collapsed by default; expands to the policy-bounded SQL. */
export function EvidenceItem({ evidence }: { evidence: Evidence }) {
  return (
    <details className="rounded-md border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
        <Database className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <span className="font-medium">{evidence.id}</span>
        <span className="truncate text-muted-foreground">· {evidence.purpose}</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {evidence.execution.rowCount} rows · {evidence.execution.elapsedMs} ms
        </span>
      </summary>
      <div className="border-t border-border">
        <pre className="overflow-x-auto px-3 py-2 font-mono text-xs leading-relaxed">
          {evidence.sql}
        </pre>
        <div className="flex items-center gap-1.5 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" aria-hidden />
          {evidence.policyNotes}
        </div>
        {evidence.redactedColumns.length > 0 && (
          <div className="border-t border-border bg-status-partial-bg px-3 py-2 text-xs text-status-partial">
            Redacted: {evidence.redactedColumns.join(', ')}
          </div>
        )}
      </div>
    </details>
  );
}
