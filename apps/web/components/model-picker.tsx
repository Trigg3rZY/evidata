'use client';

import { Cpu } from 'lucide-react';
import { useModels } from '@/lib/model-context';
import { useI18n } from '@/lib/i18n';

/**
 * Top-nav model selector (epic #106; team-shared #151): chooses which model from the
 * shared pool a NEW question runs against. Mirrors the data-source chip. "Default model"
 * (value "") leaves the choice to the server (env/fixture provider). Hidden when no
 * models are registered, so it never clutters the signed-out / empty state.
 * The selection is sent per turn as `modelProviderId`.
 */
export function ModelPicker() {
  const { t } = useI18n();
  const { models, activeId, setActiveId } = useModels();
  if (models.length === 0) return null;

  return (
    <label className="hidden min-w-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground sm:inline-flex">
      <Cpu className="h-3 w-3 shrink-0" aria-hidden />
      <span className="sr-only">{t('model')}</span>
      <select
        value={activeId ?? ''}
        onChange={(e) => setActiveId(e.target.value || null)}
        className="max-w-[10rem] truncate bg-transparent text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="">{t('modelDefault')}</option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  );
}
