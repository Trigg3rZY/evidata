'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface ModelItem {
  id: string;
  name: string;
  kind: string;
  model: string;
  /** Whether the provider can actually run (has a resolvable base URL). The picker
   *  only keeps runnable ones — a non-runnable selection would 404 every Ask. */
  runnable: boolean;
}

interface ModelsValue {
  /** The caller's registered models (empty when none / not signed in). */
  models: ReadonlyArray<ModelItem>;
  /** The model a NEW question runs against; null = the server's default model. */
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  /** Re-fetch the list (e.g. after registering/removing a model in admin). */
  refresh: () => void;
}

const Ctx = createContext<ModelsValue | null>(null);

/**
 * Holds the caller's registered model providers + the active selection (epic #106),
 * fetched once and shared across routes so the picker in the top nav and the Ask
 * request agree. `activeId === null` means "use the server's default model"
 * (the env/fixture provider); a non-null id is sent as `modelProviderId` so the
 * turn runs on that BYO-key model. The list is empty when signed out or when no
 * models are registered, in which case the picker hides itself.
 */
export function ModelProvider({ children }: { children: ReactNode }) {
  const [models, setModels] = useState<ReadonlyArray<ModelItem>>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void fetch('/api/model-providers')
      .then((r) => (r.ok ? (r.json() as Promise<ModelItem[]>) : []))
      .then((d) => {
        // Offer only runnable models — a non-runnable one (no resolvable base URL)
        // would 404 every Ask, so it must never be selectable.
        const list = (Array.isArray(d) ? d : []).filter((m) => m.runnable);
        setModels(list);
        // Drop a selection that's gone or no longer runnable (deleted / base URL removed).
        setActiveId((cur) => (cur && list.some((m) => m.id === cur) ? cur : null));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo<ModelsValue>(
    () => ({ models, activeId, setActiveId, refresh }),
    [models, activeId, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useModels(): ModelsValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useModels must be used within a ModelProvider');
  return ctx;
}
