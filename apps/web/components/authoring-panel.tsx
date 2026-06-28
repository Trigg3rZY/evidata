'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { EditableDataSource, PolicyForm } from '@/lib/authoring-service';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { ContextReview } from '@/components/context-review';
import { CorrectionsPanel } from '@/components/corrections-panel';
import { MembersPanel } from '@/components/members-panel';

/**
 * Owner-only authoring panel for the Data Sources detail page (M2-S3, spec 09 §5/§7):
 * scope tables, mark sensitive columns, write an overview, set the Policy, and
 * publish. Self-hides when the authoring endpoint returns 404/401 (not an owner, or
 * a non-authorable source like the Sample). Manual minimal — no AI calibration yet.
 */
export function AuthoringPanel({
  id,
  onLifecycleChange,
}: {
  id: string;
  onLifecycleChange?: () => void;
}) {
  const { t } = useI18n();
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<EditableDataSource | null>(null);
  const [hidden, setHidden] = useState(false);

  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [sensitive, setSensitive] = useState<Set<string>>(new Set());
  const [overview, setOverview] = useState('');
  const [policy, setPolicy] = useState<PolicyForm | null>(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // Holds the id of the source whose save is waiting on the readiness refetch, so
  // that refetch (which normally resets status to idle) keeps the "saved" signal
  // visible instead of snapping back to "Save". Scoped to the saved id — not a
  // plain bool — so switching source before the refetch resolves can't leak a stale
  // "Saved" onto the new source (the panel isn't keyed by id) (#166, Codex P2).
  const savedRef = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  // AI calibration (B2): drafts Suggested context/glossary/mappings from the schema.
  const [calibrating, setCalibrating] = useState(false);
  const [calibResult, setCalibResult] = useState<{
    glossaryAdded: number;
    mappingsAdded: number;
  } | null>(null);
  const [calibError, setCalibError] = useState(false);
  // Bumped after calibration so the context review re-fetches the new suggestions.
  const [contextRefresh, setContextRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/data-sources/${encodeURIComponent(id)}/authoring`)
      .then((r) => (r.ok ? (r.json() as Promise<EditableDataSource>) : null))
      .then((d) => {
        if (cancelled) return;
        if (!d) {
          setHidden(true);
          return;
        }
        setHidden(false);
        setData(d);
        setIncluded(new Set(d.includedTables));
        setSensitive(new Set(d.sensitiveColumns));
        setOverview(d.overview);
        setPolicy(d.policy);
        setDirty(false);
        // A refetch for the source we just saved keeps the "saved" signal; any other
        // refetch (initial load, lifecycle change, switching source) returns to idle.
        if (savedRef.current === id) {
          savedRef.current = null;
        } else {
          setStatus('idle');
        }
      })
      .catch(() => {
        if (!cancelled) setHidden(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id, reload]);

  // "saved" holds for a few seconds so the success state is readable, then clears
  // to idle on its own — it no longer depends on refetch timing (#166).
  useEffect(() => {
    if (status !== 'saved') return;
    const timer = setTimeout(() => setStatus('idle'), 4000);
    return () => clearTimeout(timer);
  }, [status]);

  const tables = useMemo(() => data?.schema?.tables ?? [], [data]);

  if (hidden || !data || !policy) return null;

  const edited = (): void => {
    setDirty(true);
    setStatus('idle');
  };

  const toggleTable = (name: string): void => {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
        // Drop sensitive columns that belonged to the now-excluded table.
        setSensitive((s) => new Set([...s].filter((c) => !c.startsWith(`${name}.`))));
      } else {
        next.add(name);
      }
      return next;
    });
    edited();
  };

  const toggleSensitive = (ref: string): void => {
    setSensitive((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
    edited();
  };

  const setPolicyField = <K extends keyof PolicyForm>(k: K, v: PolicyForm[K]): void => {
    setPolicy((p) => (p ? { ...p, [k]: v } : p));
    edited();
  };

  const save = async (): Promise<void> => {
    setStatus('saving');
    const res = await fetch(`/api/data-sources/${encodeURIComponent(id)}/authoring`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        includedTables: [...included],
        sensitiveColumns: [...sensitive],
        overview,
        policy,
      }),
    }).catch(() => null);
    if (res?.ok) {
      setStatus('saved');
      setDirty(false);
      savedRef.current = id; // the next refetch is ours — keep "saved" visible
      setReload((n) => n + 1); // refresh server-computed readiness
    } else {
      setStatus('error');
    }
  };

  const calibrate = async (): Promise<void> => {
    setCalibrating(true);
    setCalibResult(null);
    setCalibError(false);
    const res = await fetch(`/api/data-sources/${encodeURIComponent(id)}/calibrate`, {
      method: 'POST',
    }).catch(() => null);
    setCalibrating(false);
    if (res?.ok) {
      const r = (await res.json()) as {
        glossaryAdded: number;
        mappingsAdded: number;
        draft: { overview: string };
      };
      // Calibration never writes the overview to live context (Save is the gate).
      // Populate the form for review only when the owner hasn't written one, and mark
      // it dirty. No refetch — preserves any other unsaved edits.
      if (!overview.trim() && r.draft.overview.trim()) {
        setOverview(r.draft.overview.trim());
        setDirty(true);
        setStatus('idle');
      }
      setCalibResult({ glossaryAdded: r.glossaryAdded, mappingsAdded: r.mappingsAdded });
      setContextRefresh((n) => n + 1); // surface the new suggestions in the review
    } else {
      setCalibError(true);
    }
  };

  const setLifecycle = async (lifecycle: 'published' | 'draft'): Promise<void> => {
    setBusy(true);
    const res = await fetch(`/api/data-sources/${encodeURIComponent(id)}/lifecycle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lifecycle }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setReload((n) => n + 1);
      onLifecycleChange?.();
    }
  };

  const isPublished = data.lifecycle === 'published';
  const canPublish = !busy && !dirty && data.readiness.ready;

  return (
    <section className="mt-8 border-t border-border pt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{t('authoringLabel')}</h2>
        <span
          className={`rounded-md px-2 py-0.5 text-xs ${
            isPublished
              ? 'bg-status-answered-bg text-status-answered'
              : 'border border-border text-muted-foreground'
          }`}
        >
          {isPublished ? t('authoringPublished') : t('authoringDraft')}
        </span>
      </div>

      {/* AI calibration (B2): draft Suggested context from the schema. */}
      <div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void calibrate()}
            disabled={calibrating || tables.length === 0}
          >
            {calibrating ? t('authoringCalibrating') : t('authoringCalibrate')}
          </Button>
          <span className="text-xs text-muted-foreground">{t('authoringCalibrateHint')}</span>
        </div>
        {calibResult && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t('authoringCalibrateDone')} · {calibResult.glossaryAdded}{' '}
            {t('authoringCalibrateGlossary')} · {calibResult.mappingsAdded}{' '}
            {t('authoringCalibrateMappings')}
          </p>
        )}
        {calibError && (
          <p className="mt-2 text-xs text-destructive">{t('authoringCalibrateError')}</p>
        )}
      </div>

      {/* Context review (B3): promote Suggested glossary/mappings → Verified. */}
      <ContextReview id={id} refreshKey={contextRefresh} />

      {/* Correction-loop review (B4): querier-raised corrections from blocked answers. */}
      <CorrectionsPanel id={id} />

      {/* Included tables */}
      <fieldset className="mt-4">
        <legend className="text-xs font-medium text-muted-foreground">
          {t('authoringIncludedTables')}
        </legend>
        <p className="mt-1 text-xs text-muted-foreground">{t('authoringIncludedHint')}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {tables.map((tbl) => (
            <label
              key={tbl.name}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs"
            >
              <input
                type="checkbox"
                checked={included.has(tbl.name)}
                onChange={() => toggleTable(tbl.name)}
              />
              <span className="font-mono">{tbl.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Sensitive columns (only for included tables) */}
      {included.size > 0 && (
        <fieldset className="mt-4">
          <legend className="text-xs font-medium text-muted-foreground">
            {t('authoringSensitiveColumns')}
          </legend>
          <p className="mt-1 text-xs text-muted-foreground">{t('authoringSensitiveHint')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {tables
              .filter((tbl) => included.has(tbl.name))
              .flatMap((tbl) =>
                tbl.columns.map((col) => {
                  const ref = `${tbl.name}.${col.name}`;
                  return (
                    <label
                      key={ref}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={sensitive.has(ref)}
                        onChange={() => toggleSensitive(ref)}
                      />
                      <span className="font-mono">{ref}</span>
                    </label>
                  );
                }),
              )}
          </div>
        </fieldset>
      )}

      {/* Overview */}
      <div className="mt-4">
        <label htmlFor="ds-overview" className="text-xs font-medium text-muted-foreground">
          {t('authoringOverview')}
        </label>
        <textarea
          id="ds-overview"
          rows={3}
          value={overview}
          onChange={(e) => {
            setOverview(e.target.value);
            edited();
          }}
          placeholder={t('authoringOverviewPlaceholder')}
          className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {/* Policy */}
      <fieldset className="mt-4">
        <legend className="text-xs font-medium text-muted-foreground">
          {t('authoringPolicy')}
        </legend>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <label className="text-xs">
            <span className="text-muted-foreground">{t('authoringRowLimit')}</span>
            <input
              type="number"
              min={1}
              value={policy.rowLimit}
              onChange={(e) => setPolicyField('rowLimit', Number(e.target.value) || 1)}
              className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">{t('authoringTimeoutMs')}</span>
            <input
              type="number"
              min={1}
              value={policy.timeoutMs}
              onChange={(e) => setPolicyField('timeoutMs', Number(e.target.value) || 1)}
              className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        </div>
        <div className="mt-2 flex flex-col gap-1.5">
          <label className="inline-flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={policy.confirmOnBroadScan}
              onChange={(e) => setPolicyField('confirmOnBroadScan', e.target.checked)}
            />
            {t('authoringConfirmBroadScan')}
          </label>
          <label className="inline-flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={policy.confirmOnSensitiveAccess}
              onChange={(e) => setPolicyField('confirmOnSensitiveAccess', e.target.checked)}
            />
            {t('authoringConfirmSensitive')}
          </label>
        </div>
      </fieldset>

      {/* Actions */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void save()}
          disabled={status === 'saving'}
        >
          {status === 'saving'
            ? t('authoringSaving')
            : status === 'saved'
              ? t('authoringSaved')
              : t('authoringSave')}
        </Button>
        {isPublished ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void setLifecycle('draft')}
            disabled={busy}
          >
            {t('authoringUnpublish')}
          </Button>
        ) : (
          <Button size="sm" onClick={() => void setLifecycle('published')} disabled={!canPublish}>
            {t('authoringPublish')}
          </Button>
        )}
        {status === 'error' && (
          <span className="text-xs text-destructive">{t('authoringSaveError')}</span>
        )}
      </div>

      {!isPublished && !data.readiness.ready && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('authoringNotReady')} {data.readiness.missing.join(' · ')}
        </p>
      )}

      {/* Members & access (B1b-2): list/remove members, mint + revoke invite links.
          Keyed by `id` so switching sources remounts it with fresh state — no member
          rows or minted invite link from the previous source can linger under the new
          one (Codex P2: a stale access link is sensitive). */}
      <MembersPanel key={id} id={id} />
    </section>
  );
}
