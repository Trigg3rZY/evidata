'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import type { InvestigationListItem } from '@evidata/ports';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';

/** History rail (spec 04 §2): past Investigations grouped Today/Earlier + New chat.
 *  Consumes GET /api/investigations; selecting one loads its thread (issue #40). */
export function Sidebar({
  selectedId,
  onSelect,
  onNewChat,
  refreshKey,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  /** Bump to refetch the list (e.g. after a new Investigation is created). */
  refreshKey: number;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<InvestigationListItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/investigations')
      .then((r) => (r.ok ? (r.json() as Promise<InvestigationListItem[]>) : []))
      .then((d) => {
        if (!cancelled) setItems(Array.isArray(d) ? d : []);
      })
      .catch(() => {
        /* a transient list failure just shows an empty rail */
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const isToday = (iso: string): boolean => {
    const d = new Date(iso);
    const n = new Date();
    return (
      d.getFullYear() === n.getFullYear() &&
      d.getMonth() === n.getMonth() &&
      d.getDate() === n.getDate()
    );
  };
  const today = items.filter((i) => isToday(i.updatedAt));
  const earlier = items.filter((i) => !isToday(i.updatedAt));

  const group = (label: string, list: InvestigationListItem[]) =>
    list.length === 0 ? null : (
      <div className="flex flex-col gap-0.5">
        <div className="px-2 pt-3 text-xs font-medium text-muted-foreground">{label}</div>
        {list.map((i) => (
          <button
            key={i.id}
            type="button"
            onClick={() => onSelect(i.id)}
            aria-current={i.id === selectedId ? 'true' : undefined}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              i.id === selectedId ? 'bg-accent' : ''
            }`}
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[i.latestStatus] ?? 'bg-muted-foreground'}`}
              aria-hidden
            />
            <span className="truncate">{i.title}</span>
          </button>
        ))}
      </div>
    );

  return (
    <nav
      aria-label={t('history')}
      className="hidden min-h-0 w-64 shrink-0 flex-col gap-1 border-r border-border bg-card px-2 py-3 md:flex"
    >
      <Button variant="outline" size="sm" className="mx-1 justify-start" onClick={onNewChat}>
        <Plus className="h-4 w-4" aria-hidden />
        {t('newChat')}
      </Button>
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <p className="px-2 pt-4 text-xs text-muted-foreground">{t('noHistory')}</p>
        ) : (
          <>
            {group(t('today'), today)}
            {group(t('earlier'), earlier)}
          </>
        )}
      </div>
    </nav>
  );
}

const STATUS_DOT: Record<string, string> = {
  Answered: 'bg-status-answered',
  BlockedByPolicy: 'bg-status-blocked',
  NeedsClarification: 'bg-status-clarify',
  Partial: 'bg-status-partial',
};
