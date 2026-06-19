'use client';

import Link from 'next/link';
import { Database, Plus } from 'lucide-react';
import { SAMPLE_DATA_SOURCE_ID } from '@evidata/connector-sample';
import { ModeToggle } from '@/components/mode-toggle';
import { Button } from '@/components/ui/button';
import { useDataSources } from '@/lib/data-source-context';
import { useI18n } from '@/lib/i18n';

/**
 * The app-shell top bar (issues #65/#69): brand (→ Ask Data), section tabs, and a
 * data-source indicator so the user always sees *which* source they're querying —
 * the chip links into the Data Sources view, where selection lives. Lang/theme are
 * here for M0; they belong in a settings menu later.
 */
export function TopNav({
  active,
  onNewChat,
}: {
  active: 'ask' | 'data-sources' | 'admin';
  onNewChat?: () => void;
}) {
  const { t, lang, setLang } = useI18n();
  const { dataSources, activeId } = useDataSources();
  const src = dataSources.find((d) => d.id === activeId);
  // The sample keeps its localized name; any real source shows its own name.
  const srcName = src && src.id !== SAMPLE_DATA_SOURCE_ID ? src.name : t('sample');

  const tab = (key: 'ask' | 'data-sources' | 'admin', href: string, label: string) => (
    <Link
      href={href}
      aria-current={active === key ? 'page' : undefined}
      className={`rounded-md px-2.5 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active === key
          ? 'font-medium text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </Link>
  );

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-1.5">
        <Link
          href="/"
          aria-label={t('home')}
          className="mr-1 flex shrink-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-sm font-medium text-primary-foreground">
            e
          </span>
          <span className="hidden font-medium sm:inline">{t('brand')}</span>
        </Link>
        <nav className="flex items-center gap-0.5" aria-label={t('sections')}>
          {tab('ask', '/', t('title'))}
          {tab('data-sources', '/data-sources', t('dataSources'))}
          {tab('admin', '/admin/connections', t('admin'))}
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Link
          href="/data-sources"
          className="hidden min-w-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
        >
          <Database className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">{srcName}</span>
        </Link>
        {onNewChat && (
          <Button variant="ghost" size="icon" className="md:hidden" onClick={onNewChat}>
            <Plus className="h-4 w-4" aria-hidden />
            <span className="sr-only">{t('newChat')}</span>
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => setLang(lang === 'en' ? 'zh-CN' : 'en')}>
          {lang === 'en' ? '中文' : 'EN'}
        </Button>
        <ModeToggle />
      </div>
    </header>
  );
}
