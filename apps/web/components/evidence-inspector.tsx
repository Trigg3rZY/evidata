'use client';

import { Database, Lock, X } from 'lucide-react';
import type { Evidence } from '@evidata/answer-contract';
import { useI18n } from '@/lib/i18n';

/**
 * The workbench's right pane (issue #49): shows one selected Evidence — its
 * policy-bounded SQL, row summary, and any redaction — opened by clicking a Key
 * Finding's citation chip. Read-only; the EvidenceSection remains the full list.
 * Renders persistently on lg+ (empty state until a citation is clicked) and as a
 * dismissible bottom sheet on smaller screens.
 */
export function EvidenceInspector({
  evidence,
  onClose,
}: {
  evidence: Evidence | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">{t('inspector')}</span>
        {evidence && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>

      {evidence ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 text-sm">
          <div className="flex items-center gap-2">
            <Database className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <span className="font-medium">{evidence.id}</span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {evidence.execution.rowCount} rows · {evidence.execution.elapsedMs} ms
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{evidence.purpose}</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs leading-relaxed">
            {evidence.sql}
          </pre>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" aria-hidden />
            {evidence.policyNotes}
          </div>
          {evidence.redactedColumns.length > 0 && (
            <div className="rounded-md bg-status-partial-bg px-2 py-1.5 text-xs text-status-partial">
              Redacted: {evidence.redactedColumns.join(', ')}
            </div>
          )}
        </div>
      ) : (
        <p className="p-3 text-xs text-muted-foreground">{t('inspectorEmpty')}</p>
      )}
    </div>
  );
}
