'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { SAMPLE_DATA_SOURCE_ID } from '@evidata/connector-sample';

export interface DataSourceItem {
  id: string;
  name: string;
}

interface DataSourcesValue {
  dataSources: ReadonlyArray<DataSourceItem>;
  /** The source a NEW conversation runs against; chosen in the Data Sources view. */
  activeId: string;
  setActiveId: (id: string) => void;
}

const Ctx = createContext<DataSourcesValue | null>(null);

/**
 * Holds the available Data Sources + the active selection, fetched once and shared
 * across routes (the Ask Data workbench and the Data Sources view) so a selection
 * made in one place is visible in the other. M0 has a single source (Sample); the
 * shape carries forward to multi-source (M1+).
 */
export function DataSourceProvider({ children }: { children: ReactNode }) {
  const [dataSources, setDataSources] = useState<ReadonlyArray<DataSourceItem>>([]);
  const [activeId, setActiveId] = useState<string>(SAMPLE_DATA_SOURCE_ID);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/data-sources')
      .then((r) => (r.ok ? (r.json() as Promise<DataSourceItem[]>) : []))
      .then((d) => {
        if (cancelled || !Array.isArray(d) || d.length === 0) return;
        setDataSources(d);
        setActiveId((cur) => (d.some((x) => x.id === cur) ? cur : (d[0]?.id ?? cur)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<DataSourcesValue>(
    () => ({ dataSources, activeId, setActiveId }),
    [dataSources, activeId],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDataSources(): DataSourcesValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDataSources must be used within a DataSourceProvider');
  return ctx;
}
