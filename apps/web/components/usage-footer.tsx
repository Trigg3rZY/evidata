'use client';

import { Coins } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { UsageInfo } from '@/lib/use-investigation-stream';

/** Compact thousands formatting: 1234 → "1.2k", 980 → "980". */
function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/**
 * Cost transparency for one turn — what the AI actually consumed. Only shown when
 * the real model ran (fixtures report no usage). Token cost scales with model
 * round-trips, not data volume, so surfacing calls/queries makes that visible.
 */
export function UsageFooter({ usage }: { usage: UsageInfo }) {
  const { t } = useI18n();
  return (
    <p className="flex items-center gap-1.5 pl-1 text-xs text-muted-foreground">
      <Coins className="h-3 w-3" aria-hidden />
      <span>
        ≈ {fmt(usage.totalTokens)} tokens · {usage.calls} {t('usageCalls')} · {usage.queries}{' '}
        {t('usageQueries')}
      </span>
    </p>
  );
}
