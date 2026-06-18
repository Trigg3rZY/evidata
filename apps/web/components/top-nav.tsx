'use client';

import { Database, Plus } from 'lucide-react';
import { SAMPLE_DATA_SOURCE_ID } from '@evidata/connector-sample';
import { ModeToggle } from '@/components/mode-toggle';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';

/**
 * The app-shell top bar (issue #65): brand (→ new chat) and a data-source
 * indicator so the user always sees *which* source they're querying — the center
 * column stays a clean conversation. Lang/theme live here for M0; they belong in a
 * settings menu later. When more than one source exists the indicator is a picker.
 */
export function TopNav({
  dataSources,
  dataSourceId,
  onDataSourceChange,
  onNewChat,
}: {
  dataSources: ReadonlyArray<{ id: string; name: string }>;
  dataSourceId: string;
  /** Switching source starts a fresh conversation (a source is bound per-Investigation). */
  onDataSourceChange: (id: string) => void;
  onNewChat: () => void;
}) {
  const { t, lang, setLang } = useI18n();
  const active = dataSources.find((d) => d.id === dataSourceId);
  // The sample keeps its localized name; any real source shows its own name (so a
  // single non-sample deployment never mislabels as "Sample").
  const activeName = active && active.id !== SAMPLE_DATA_SOURCE_ID ? active.name : t('sample');
  const multi = dataSources.length > 1;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onNewChat}
          aria-label={t('home')}
          className="flex shrink-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-sm font-medium text-primary-foreground">
            e
          </span>
          <span className="hidden font-medium sm:inline">{t('brand')}</span>
        </button>
        <span className="text-border" aria-hidden>
          /
        </span>
        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
          <Database className="h-3 w-3 shrink-0" aria-hidden />
          {multi ? (
            <select
              value={dataSourceId}
              onChange={(e) => onDataSourceChange(e.target.value)}
              aria-label={t('dataSource')}
              className="max-w-[40vw] truncate bg-transparent text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {dataSources.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="truncate">{activeName}</span>
          )}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onNewChat}>
          <Plus className="h-4 w-4" aria-hidden />
          <span className="sr-only">{t('newChat')}</span>
        </Button>
        <Button variant="outline" size="sm" onClick={() => setLang(lang === 'en' ? 'zh-CN' : 'en')}>
          {lang === 'en' ? '中文' : 'EN'}
        </Button>
        <ModeToggle />
      </div>
    </header>
  );
}
