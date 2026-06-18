'use client';

import { Database, Sparkles } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export function EmptyState({ onPick }: { onPick: (question: string) => void }) {
  const { t } = useI18n();
  // Localized starter questions — they follow the active UI language so a zh-CN
  // visitor sees Chinese prompts. Each is a natural question the live model handles.
  const examples = [t('example1'), t('example2'), t('example3')];
  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="font-medium">{t('sample')}</span>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {t('sampleBadge')}
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('sampleOverview')}</p>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          {t('tryAsking')}
        </div>
        <div className="flex flex-col gap-2">
          {examples.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onPick(q)}
              className="rounded-md border border-border bg-card px-4 py-3 text-left text-sm hover:border-input hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {q}
            </button>
          ))}
        </div>
      </section>

      <p className="text-xs text-muted-foreground">{t('demoNote')}</p>
    </div>
  );
}
