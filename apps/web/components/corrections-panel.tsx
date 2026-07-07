'use client';

import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';

interface Suggestion {
  id: string;
  investigationId: string;
  answerVersion: number | null;
  kind: string;
  targetRef: string | null;
  description: string;
  proposedDefinition: string | null;
  submittedByName: string;
  status: string;
  createdAt: string;
}
interface GlossaryItem {
  id: string;
  term: string;
  definition: string;
  status: 'suggested' | 'verified';
}
interface MappingItem {
  id: string;
  fromRef: string;
  toRef: string;
  status: 'suggested' | 'verified';
}

/**
 * Owner/Admin correction-loop review (M2-B4, #123): the queue of corrections queriers
 * raised from blocked answers. The reviewer chooses which Suggested glossary term /
 * mapping the correction maps to and accepts → that item is promoted to Verified (and
 * the affected investigation is re-answered, B4 ②), or dismisses it. Rendered inside the
 * AuthoringPanel (already owner/admin-gated); self-hides on its own 404 / an empty queue.
 */
export function CorrectionsPanel({
  id,
  onQueueChange,
}: {
  id: string;
  onQueueChange?: () => void;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [glossary, setGlossary] = useState<GlossaryItem[]>([]);
  const [mappings, setMappings] = useState<MappingItem[]>([]);
  const [hidden, setHidden] = useState(false);
  const [choice, setChoice] = useState<Record<string, string>>({}); // sid → 'glossary:id' | 'mapping:id'
  const [definition, setDefinition] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const [sRes, cRes] = await Promise.all([
      fetch(`/api/data-sources/${encodeURIComponent(id)}/suggestions`).catch(() => null),
      fetch(`/api/data-sources/${encodeURIComponent(id)}/context-items`).catch(() => null),
    ]);
    if (!sRes?.ok) {
      setHidden(true);
      return;
    }
    setHidden(false);
    setItems((await sRes.json()) as Suggestion[]);
    if (cRes?.ok) {
      const ctx = (await cRes.json()) as { glossary: GlossaryItem[]; mappings: MappingItem[] };
      setGlossary(ctx.glossary.filter((g) => g.status === 'suggested'));
      setMappings(ctx.mappings.filter((m) => m.status === 'suggested'));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (sid: string, body: Record<string, unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    const res = await fetch(
      `/api/data-sources/${encodeURIComponent(id)}/suggestions/${encodeURIComponent(sid)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    ).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      await load();
      onQueueChange?.();
    } else {
      setError(t('correctionsError'));
    }
  };

  const accept = (s: Suggestion): void => {
    const sel = choice[s.id];
    if (!sel) {
      setError(t('correctionsPickTarget'));
      return;
    }
    const [targetKind, targetItemId] = sel.split(':');
    void review(s.id, {
      action: 'accept',
      targetKind,
      targetItemId,
      definition: definition[s.id] ?? s.proposedDefinition ?? undefined,
    });
  };

  if (hidden || !items || items.length === 0) return null;

  return (
    <fieldset className="mt-6 border-t border-border pt-6">
      <legend className="text-sm font-medium">{t('correctionsLabel')}</legend>
      <p className="mt-1 text-xs text-muted-foreground">{t('correctionsHint')}</p>

      <ul className="mt-3 flex flex-col gap-3">
        {items.map((s) => {
          const sel = choice[s.id] ?? '';
          const isGlossary = sel.startsWith('glossary:');
          return (
            <li key={s.id} className="rounded-md border border-border p-3 text-sm">
              <p>{s.description}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('correctionsFrom')} {s.submittedByName}
              </p>

              <div className="mt-2 flex flex-col gap-2">
                <select
                  aria-label={t('correctionsPickTarget')}
                  value={sel}
                  onChange={(e) => setChoice((c) => ({ ...c, [s.id]: e.target.value }))}
                  className="rounded-md border border-border bg-card px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">{t('correctionsPickTarget')}</option>
                  {mappings.length > 0 && (
                    <optgroup label={t('authoringMappings')}>
                      {mappings.map((m) => (
                        <option key={m.id} value={`mapping:${m.id}`}>
                          {m.fromRef} → {m.toRef}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {glossary.length > 0 && (
                    <optgroup label={t('authoringGlossary')}>
                      {glossary.map((g) => (
                        <option key={g.id} value={`glossary:${g.id}`}>
                          {g.term}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>

                {isGlossary && (
                  <input
                    value={definition[s.id] ?? s.proposedDefinition ?? ''}
                    onChange={(e) => setDefinition((d) => ({ ...d, [s.id]: e.target.value }))}
                    placeholder={t('correctionsDefinitionPlaceholder')}
                    className="rounded-md border border-border bg-card px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                )}

                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => accept(s)} disabled={busy}>
                    {t('correctionsAccept')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void review(s.id, { action: 'reject' })}
                    disabled={busy}
                  >
                    {t('correctionsReject')}
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
    </fieldset>
  );
}
