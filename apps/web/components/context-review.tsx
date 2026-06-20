'use client';

import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';

interface GlossaryItem {
  id: string;
  term: string;
  definition: string;
  status: 'suggested' | 'verified';
  provenance: string;
}
interface MappingItem {
  id: string;
  fromRef: string;
  toRef: string;
  status: 'suggested' | 'verified';
  provenance: string;
}
interface ContextItems {
  glossary: GlossaryItem[];
  mappings: MappingItem[];
}

/**
 * Owner-only context review (M2-B3, #122): promote Suggested glossary terms +
 * entity mappings to Verified (only Verified reaches the Ask model), edit a glossary
 * definition, or reject. Refetches when `refreshKey` changes (e.g. after calibration
 * drafts new suggestions). Rendered inside the AuthoringPanel (already owner-gated).
 */
export function ContextReview({ id, refreshKey }: { id: string; refreshKey: number }) {
  const { t } = useI18n();
  const [items, setItems] = useState<ContextItems | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const res = await fetch(`/api/data-sources/${encodeURIComponent(id)}/context-items`).catch(
      () => null,
    );
    if (res?.ok) setItems((await res.json()) as ContextItems);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const act = async (body: Record<string, unknown>): Promise<void> => {
    const res = await fetch(`/api/data-sources/${encodeURIComponent(id)}/context-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (res?.ok) await load();
  };

  if (!items) return null;
  const empty = items.glossary.length === 0 && items.mappings.length === 0;

  const badge = (status: 'suggested' | 'verified') => (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
        status === 'verified'
          ? 'bg-status-answered-bg text-status-answered'
          : 'border border-border text-muted-foreground'
      }`}
    >
      {status === 'verified' ? t('authoringVerified') : t('authoringSuggested')}
    </span>
  );

  return (
    <fieldset className="mt-4">
      <legend className="text-xs font-medium text-muted-foreground">{t('authoringContext')}</legend>
      <p className="mt-1 text-xs text-muted-foreground">{t('authoringContextHint')}</p>

      {empty ? (
        <p className="mt-2 text-xs text-muted-foreground">{t('authoringContextEmpty')}</p>
      ) : (
        <div className="mt-2 flex flex-col gap-4">
          {items.glossary.length > 0 && (
            <div>
              <div className="text-xs font-medium">{t('authoringGlossary')}</div>
              <ul className="mt-1 flex flex-col gap-2">
                {items.glossary.map((g) => (
                  <li key={g.id} className="rounded-md border border-border p-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{g.term}</span>
                      {badge(g.status)}
                    </div>
                    {editing?.id === g.id ? (
                      <div className="mt-1.5 flex flex-col gap-1.5">
                        <textarea
                          rows={2}
                          value={editing.value}
                          onChange={(e) => setEditing({ id: g.id, value: e.target.value })}
                          className="w-full rounded-md border border-border bg-card px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void act({
                                action: 'edit',
                                kind: 'glossary',
                                itemId: g.id,
                                definition: editing.value,
                              }).then(() => setEditing(null))
                            }
                          >
                            {t('commonSave')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                            {t('commonCancel')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-0.5 text-xs text-muted-foreground">{g.definition}</p>
                    )}
                    {editing?.id !== g.id && (
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {g.status === 'suggested' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void act({ action: 'promote', kind: 'glossary', itemId: g.id })
                            }
                          >
                            {t('authoringVerify')}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing({ id: g.id, value: g.definition })}
                        >
                          {t('authoringEdit')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void act({ action: 'reject', kind: 'glossary', itemId: g.id })
                          }
                        >
                          {t('authoringReject')}
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {items.mappings.length > 0 && (
            <div>
              <div className="text-xs font-medium">{t('authoringMappings')}</div>
              <ul className="mt-1 flex flex-col gap-2">
                {items.mappings.map((m) => (
                  <li key={m.id} className="rounded-md border border-border p-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-xs">
                        {m.fromRef} → {m.toRef}
                      </span>
                      {badge(m.status)}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {m.status === 'suggested' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void act({ action: 'promote', kind: 'mapping', itemId: m.id })
                          }
                        >
                          {t('authoringVerify')}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void act({ action: 'reject', kind: 'mapping', itemId: m.id })
                        }
                      >
                        {t('authoringReject')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}
