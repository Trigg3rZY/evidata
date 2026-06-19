'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Database, Lock } from 'lucide-react';
import type { DataSourceOverview } from '@evidata/investigation';
import { SAMPLE_DATA_SOURCE_ID } from '@evidata/connector-sample';
import { useDataSources } from '@/lib/data-source-context';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { AuthoringPanel } from '@/components/authoring-panel';

/**
 * The Data Sources view (issue #69, spec 04 §1): a list of sources + a read-only
 * detail — Overview (what it can/can't answer + examples), Schema (tables/columns),
 * and the Safety posture (read-only · row limit · redacted columns). It's also the
 * place to *select* the active source for a new conversation. M0 has one source
 * (Sample); the localized Overview copy is the Sample's (M2 serves per-source
 * DataSourceContext via the API).
 */
export function DataSourceView() {
  const { t } = useI18n();
  const router = useRouter();
  const { dataSources, activeId, setActiveId, refresh } = useDataSources();
  // Which source's detail is shown; defaults to the active one until the user picks.
  const [viewId, setViewId] = useState<string | null>(null);
  const effectiveId = viewId ?? activeId;
  const isSample = effectiveId === SAMPLE_DATA_SOURCE_ID;

  const [overview, setOverview] = useState<DataSourceOverview | null>(null);
  const [loading, setLoading] = useState(true);
  // `railReload` bumps after a publish so a just-published source's read-only
  // overview (resolver only resolves published sources) appears without a reload.
  const [railReload, setRailReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/data-sources/${encodeURIComponent(effectiveId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<DataSourceOverview>) : null))
      .then((o) => {
        if (cancelled) return;
        setOverview(o);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveId, railReload]);

  // Sources the signed-in user may author — INCLUDING drafts — so an owner can open
  // a draft and publish it. The ask picker uses the published list (`dataSources`);
  // the rail merges in these so drafts are reachable. Empty when signed out.
  const [authorable, setAuthorable] = useState<
    Array<{ id: string; name: string; lifecycle: string }>
  >([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/data-sources/authorable')
      .then((r) => (r.ok ? (r.json() as Promise<typeof authorable>) : []))
      .then((a) => {
        if (!cancelled && Array.isArray(a)) setAuthorable(a);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [railReload]);

  const railSources = useMemo(() => {
    const m = new Map<string, { id: string; name: string; lifecycle?: string }>();
    for (const d of dataSources) m.set(d.id, { ...d });
    for (const a of authorable) m.set(a.id, a); // authorable carries lifecycle (incl. draft)
    return [...m.values()];
  }, [dataSources, authorable]);

  // A draft the owner can author has no published overview; drive its detail page
  // from the authoring panel instead (which fetches the schema + draft state).
  const draftEntry = authorable.find((a) => a.id === effectiveId);

  const displayName = (id: string, name: string) =>
    id !== SAMPLE_DATA_SOURCE_ID ? name : t('sample');

  const useSource = (): void => {
    setActiveId(effectiveId);
    router.push('/');
  };

  // Refresh both the published picker list and the authorable rail after a publish.
  const onLifecycleChange = (): void => {
    refresh();
    setRailReload((n) => n + 1);
  };

  return (
    <>
      {/* Source list rail — the selection surface; mirrors the history rail. */}
      <nav
        aria-label={t('dataSources')}
        className="hidden min-h-0 w-64 shrink-0 flex-col gap-0.5 border-r border-border bg-card px-2 py-3 md:flex"
      >
        <div className="px-2 pb-2 text-xs font-medium text-muted-foreground">
          {t('dataSources')}
        </div>
        <div className="flex-1 overflow-y-auto">
          {railSources.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setViewId(d.id)}
              aria-current={d.id === effectiveId ? 'true' : undefined}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                d.id === effectiveId ? 'bg-accent' : ''
              }`}
            >
              <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{displayName(d.id, d.name)}</span>
              {d.lifecycle === 'draft' && (
                <span className="ml-auto shrink-0 rounded border border-border px-1 text-[10px] text-muted-foreground">
                  {t('authoringDraft')}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-8">
          {/* The list rail is hidden below md; on mobile a multi-source deployment
              still needs a way to pick another source before asking (Codex P2). */}
          {railSources.length > 1 && (
            <div className="mb-4 md:hidden">
              <label htmlFor="ds-picker" className="sr-only">
                {t('dataSources')}
              </label>
              <select
                id="ds-picker"
                value={effectiveId}
                onChange={(e) => setViewId(e.target.value)}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {railSources.map((d) => (
                  <option key={d.id} value={d.id}>
                    {displayName(d.id, d.name)}
                    {d.lifecycle === 'draft' ? ` (${t('authoringDraft')})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          {loading ? (
            <p className="text-sm text-muted-foreground">…</p>
          ) : overview ? (
            <>
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-secondary">
                    <Database className="h-4 w-4 text-muted-foreground" aria-hidden />
                  </span>
                  <div>
                    <h1 className="text-xl font-medium">
                      {displayName(overview.id, overview.name)}
                    </h1>
                    {isSample && (
                      <span className="text-xs text-muted-foreground">{t('sampleBadge')}</span>
                    )}
                  </div>
                </div>
                <Button size="sm" onClick={useSource}>
                  {t('askAboutSource')}
                </Button>
              </header>

              {isSample && (
                <section className="mt-6">
                  <h2 className="text-sm font-medium">{t('overviewLabel')}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {t('sampleOverview')}
                  </p>
                  <div className="mt-3">
                    <div className="text-xs font-medium text-muted-foreground">
                      {t('exampleQuestions')}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {[t('example1'), t('example2'), t('example3')].map((q, i) => (
                        <span
                          key={i}
                          className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
                        >
                          {q}
                        </span>
                      ))}
                    </div>
                  </div>
                </section>
              )}

              <section className="mt-6">
                <h2 className="text-sm font-medium">{t('safetyLabel')}</h2>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-status-answered-bg px-2 py-1 text-status-answered">
                    <Lock className="h-3 w-3" aria-hidden />
                    {t('readOnlyAccess')}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-muted-foreground">
                    {t('rowLimitLabel')}: {overview.safety.rowLimit}
                  </span>
                  {overview.safety.redactedColumns.length > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-muted-foreground">
                      {t('redactedColumns')}: {overview.safety.redactedColumns.join(', ')}
                    </span>
                  )}
                </div>
              </section>

              <section className="mt-6">
                <h2 className="text-sm font-medium">{t('schemaLabel')}</h2>
                <div className="mt-2 flex flex-col gap-4">
                  {overview.schema.tables.map((tbl) => (
                    <div key={tbl.name} className="overflow-hidden rounded-lg border border-border">
                      <div className="border-b border-border px-3 py-2 text-sm font-medium">
                        {tbl.name}
                      </div>
                      <table className="w-full">
                        <caption className="sr-only">{tbl.name}</caption>
                        <thead>
                          <tr className="border-b border-border text-left text-[10px] uppercase text-muted-foreground">
                            <th scope="col" className="px-3 py-1.5 font-medium">
                              {t('colColumn')}
                            </th>
                            <th scope="col" className="px-3 py-1.5 font-medium">
                              {t('colType')}
                            </th>
                            <th scope="col" className="px-3 py-1.5 text-right font-medium">
                              {t('colConstraint')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {tbl.columns.map((col) => (
                            <tr key={col.name} className="border-b border-border last:border-0">
                              <td className="px-3 py-1.5 font-mono text-xs">{col.name}</td>
                              <td className="px-3 py-1.5 text-xs text-muted-foreground">
                                {col.dataType}
                              </td>
                              <td className="px-3 py-1.5 text-right text-[10px] font-medium uppercase text-muted-foreground">
                                {col.primaryKey ? 'PK' : col.references ? 'FK' : ''}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </section>

              {/* Owner-only authoring (self-hides for non-owners / the Sample). */}
              {!isSample && (
                <AuthoringPanel id={overview.id} onLifecycleChange={onLifecycleChange} />
              )}
            </>
          ) : draftEntry ? (
            // A draft the owner is configuring (no published overview yet).
            <>
              <header className="flex items-center gap-2.5 border-b border-border pb-4">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-secondary">
                  <Database className="h-4 w-4 text-muted-foreground" aria-hidden />
                </span>
                <div>
                  <h1 className="text-xl font-medium">{draftEntry.name}</h1>
                  <span className="text-xs text-muted-foreground">{t('authoringDraft')}</span>
                </div>
              </header>
              <AuthoringPanel id={effectiveId} onLifecycleChange={onLifecycleChange} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">…</p>
          )}
        </div>
      </main>
    </>
  );
}
