'use client';

import { FileCode2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { MessageInfo } from '@/lib/use-investigation-stream';

/**
 * A conversational reply (greeting / drafted SQL / out-of-scope decline) — NOT an
 * Answer (spec 13): no status badge, no confidence, no evidence. Text is rendered
 * as an escaped React text node; any drafted SQL is shown read-only in a <pre>
 * with a "not executed" badge (never interpreted, never run).
 */
export function MessageBubble({ message }: { message: MessageInfo }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 text-sm leading-relaxed">
      {message.text && <p className="whitespace-pre-wrap">{message.text}</p>}
      {message.sql && (
        <div className="flex flex-col gap-1">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileCode2 className="h-3 w-3" aria-hidden />
            {t('notExecuted')}
          </span>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
            <code>{message.sql}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
