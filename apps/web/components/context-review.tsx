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

interface GlossaryForm {
  id?: string;
  term: string;
  definition: string;
}

interface MappingForm {
  id?: string;
  fromRef: string;
  toRef: string;
}

const inputClass =
  'w-full rounded-md border border-border bg-card px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Owner-only context review (M2-B3, #122): promote Suggested glossary terms +
 * entity mappings to Verified (only Verified reaches the Ask model), edit a glossary
 * definition, or reject. Refetches when `refreshKey` changes (e.g. after calibration
 * drafts new suggestions). Rendered inside the AuthoringPanel (already owner-gated).
 */
export function ContextReview({ id, refreshKey }: { id: string; refreshKey: number }) {
  const { t } = useI18n();
  const [items, setItems] = useState<ContextItems | null>(null);
  const [glossaryForm, setGlossaryForm] = useState<GlossaryForm | null>(null);
  const [mappingForm, setMappingForm] = useState<MappingForm | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const res = await fetch(`/api/data-sources/${encodeURIComponent(id)}/context-items`).catch(
      () => null,
    );
    if (res?.ok) setItems((await res.json()) as ContextItems);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const act = async (body: Record<string, unknown>): Promise<boolean> => {
    const res = await fetch(`/api/data-sources/${encodeURIComponent(id)}/context-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res?.ok) return false;
    await load();
    return true;
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

  const saveGlossary = async (): Promise<void> => {
    if (!glossaryForm) return;
    const ok = await act({
      action: glossaryForm.id ? 'edit' : 'add',
      kind: 'glossary',
      itemId: glossaryForm.id,
      term: glossaryForm.term,
      definition: glossaryForm.definition,
    });
    if (ok) setGlossaryForm(null);
  };

  const saveMapping = async (): Promise<void> => {
    if (!mappingForm) return;
    const ok = await act({
      action: mappingForm.id ? 'edit' : 'add',
      kind: 'mapping',
      itemId: mappingForm.id,
      fromRef: mappingForm.fromRef,
      toRef: mappingForm.toRef,
    });
    if (ok) setMappingForm(null);
  };

  const glossaryEditor = (form: GlossaryForm) => (
    <div className="mt-1.5 flex flex-col gap-1.5 rounded-md border border-border p-2">
      <input
        value={form.term}
        onChange={(e) => setGlossaryForm({ ...form, term: e.target.value })}
        placeholder={t('authoringTerm')}
        aria-label={t('authoringTerm')}
        className={inputClass}
      />
      <textarea
        rows={2}
        value={form.definition}
        onChange={(e) => setGlossaryForm({ ...form, definition: e.target.value })}
        placeholder={t('authoringDefinition')}
        aria-label={t('authoringDefinition')}
        className={inputClass}
      />
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => void saveGlossary()}>
          {t('commonSave')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setGlossaryForm(null)}>
          {t('commonCancel')}
        </Button>
      </div>
    </div>
  );

  const mappingEditor = (form: MappingForm) => (
    <div className="mt-1.5 flex flex-col gap-1.5 rounded-md border border-border p-2">
      <input
        value={form.fromRef}
        onChange={(e) => setMappingForm({ ...form, fromRef: e.target.value })}
        placeholder={t('authoringFromRef')}
        aria-label={t('authoringFromRef')}
        className={`${inputClass} font-mono`}
      />
      <input
        value={form.toRef}
        onChange={(e) => setMappingForm({ ...form, toRef: e.target.value })}
        placeholder={t('authoringToRef')}
        aria-label={t('authoringToRef')}
        className={`${inputClass} font-mono`}
      />
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => void saveMapping()}>
          {t('commonSave')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMappingForm(null)}>
          {t('commonCancel')}
        </Button>
      </div>
    </div>
  );

  return (
    <fieldset className="mt-4">
      <legend className="text-xs font-medium text-muted-foreground">{t('authoringContext')}</legend>
      <p className="mt-1 text-xs text-muted-foreground">{t('authoringContextHint')}</p>

      {empty && <p className="mt-2 text-xs text-muted-foreground">{t('authoringContextEmpty')}</p>}

      <div className="mt-2 flex flex-col gap-4">
        <div>
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium">{t('authoringGlossary')}</div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setGlossaryForm({ term: '', definition: '' })}
            >
              {t('authoringAddTerm')}
            </Button>
          </div>
          {glossaryForm && !glossaryForm.id && glossaryEditor(glossaryForm)}
          {items.glossary.length > 0 && (
            <ul className="mt-1 flex flex-col gap-2">
              {items.glossary.map((g) => (
                <li key={g.id} className="rounded-md border border-border p-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{g.term}</span>
                    {badge(g.status)}
                  </div>
                  {glossaryForm?.id === g.id ? (
                    glossaryEditor(glossaryForm)
                  ) : (
                    <p className="mt-0.5 text-xs text-muted-foreground">{g.definition}</p>
                  )}
                  {glossaryForm?.id !== g.id && (
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
                        onClick={() =>
                          setGlossaryForm({
                            id: g.id,
                            term: g.term,
                            definition: g.definition,
                          })
                        }
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
          )}
        </div>

        <div>
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium">{t('authoringMappings')}</div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setMappingForm({ fromRef: '', toRef: '' })}
            >
              {t('authoringAddMapping')}
            </Button>
          </div>
          {mappingForm && !mappingForm.id && mappingEditor(mappingForm)}
          {items.mappings.length > 0 && (
            <ul className="mt-1 flex flex-col gap-2">
              {items.mappings.map((m) => (
                <li key={m.id} className="rounded-md border border-border p-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs">
                      {m.fromRef} → {m.toRef}
                    </span>
                    {badge(m.status)}
                  </div>
                  {mappingForm?.id === m.id && mappingEditor(mappingForm)}
                  {mappingForm?.id !== m.id && (
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
                          setMappingForm({
                            id: m.id,
                            fromRef: m.fromRef,
                            toRef: m.toRef,
                          })
                        }
                      >
                        {t('authoringEdit')}
                      </Button>
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
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </fieldset>
  );
}
