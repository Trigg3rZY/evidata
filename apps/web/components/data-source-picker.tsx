'use client';

import { Database, Lock } from 'lucide-react';
import { SAMPLE_DATA_SOURCE_ID } from '@evidata/connector-sample';
import { useDataSources } from '@/lib/data-source-context';
import { useI18n } from '@/lib/i18n';

export function DataSourcePicker({
  boundDataSourceId,
  disabled,
  loading,
}: {
  /** A saved Investigation's source. It is immutable for the thread's lifetime. */
  boundDataSourceId?: string | undefined;
  disabled?: boolean | undefined;
  /** A saved thread has not returned its bound source yet. */
  loading?: boolean | undefined;
}) {
  const { t } = useI18n();
  const { dataSources, activeId, setActiveId } = useDataSources();
  if (loading) return null;

  const sourceName = (id: string): string => {
    if (id === SAMPLE_DATA_SOURCE_ID) return t('sample');
    return dataSources.find((source) => source.id === id)?.name ?? id;
  };
  const sources =
    dataSources.length > 0 ? dataSources : [{ id: activeId, name: sourceName(activeId) }];

  if (boundDataSourceId) {
    return (
      <span
        title={`${t('dataSource')}: ${sourceName(boundDataSourceId)}`}
        className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-1 text-xs text-muted-foreground"
      >
        <Database className="h-3 w-3 shrink-0" aria-hidden />
        <span className="max-w-[10rem] truncate text-foreground">
          {sourceName(boundDataSourceId)}
        </span>
        <Lock className="h-3 w-3 shrink-0" aria-hidden />
      </span>
    );
  }

  return (
    <label className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
      <Database className="h-3 w-3 shrink-0" aria-hidden />
      <span className="sr-only">{t('dataSource')}</span>
      <select
        value={activeId}
        onChange={(e) => setActiveId(e.target.value)}
        disabled={disabled}
        className="max-w-[10rem] truncate bg-transparent text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-100"
      >
        {sources.map((source) => (
          <option key={source.id} value={source.id}>
            {sourceName(source.id)}
          </option>
        ))}
      </select>
    </label>
  );
}
