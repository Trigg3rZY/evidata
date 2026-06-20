'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminNav } from '@/components/admin-nav';
import { AppShell } from '@/components/app-shell';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';

interface ModelParams {
  temperature?: number;
  effort?: string;
  maxTokens?: number;
}
interface ModelCapabilities {
  toolChoice?: 'required' | 'auto' | 'none';
  structuredOutput?: boolean;
}
interface ProviderSummary {
  id: string;
  name: string;
  kind: string;
  baseUrl: string | null;
  model: string;
  params: ModelParams;
  capabilities: ModelCapabilities;
}

// Mirrors the API allowlist (apps/web/app/api/model-providers/route.ts). Vendor
// kinds resolve a default base URL; 'openai-compatible' (and self-hosted) require
// an explicit Base URL below. Native non-OpenAI vendors (e.g. Anthropic) are
// registrable for forward-compat but not yet runnable until their adapter lands.
const KINDS = ['deepseek', 'openai', 'google', 'openai-compatible', 'anthropic'];
const TOOL_CHOICE = ['', 'required', 'auto', 'none'];

const EMPTY = {
  name: '',
  kind: 'deepseek',
  model: '',
  baseUrl: '',
  apiKey: '',
  temperature: '',
  effort: '',
  maxTokens: '',
  toolChoice: '',
};

/** Admin → Models (epic #106): manage BYO-key model providers — register a model
 *  with its own API key (encrypted at rest), then remove. Gated client-side; the
 *  APIs enforce auth + per-user ownership. Mirrors the Connections admin. */
export default function ModelsAdminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<ProviderSummary[]>([]);
  const [form, setForm] = useState({ ...EMPTY });
  const [createErr, setCreateErr] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const res = await fetch('/api/model-providers');
    if (res.status === 401) {
      const s = await fetch('/api/setup')
        .then((r) => r.json() as Promise<{ setupComplete: boolean }>)
        .catch(() => ({ setupComplete: true }));
      router.replace(s.setupComplete ? '/login' : '/setup');
      return;
    }
    if (res.ok) {
      setItems((await res.json()) as ProviderSummary[]);
      setReady(true);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setCreating(true);
    setCreateErr('');
    // Only send set optional fields — an empty string would otherwise persist as a
    // meaningless param (e.g. effort: ''). Numbers parse on the server too, but we
    // pre-filter so the payload carries only what the user actually entered.
    const params: ModelParams = {};
    if (form.temperature.trim() !== '') params.temperature = Number(form.temperature);
    if (form.effort.trim() !== '') params.effort = form.effort.trim();
    if (form.maxTokens.trim() !== '') params.maxTokens = Number(form.maxTokens);
    const capabilities: ModelCapabilities = {};
    if (form.toolChoice) capabilities.toolChoice = form.toolChoice as 'required' | 'auto' | 'none';

    const res = await fetch('/api/model-providers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        kind: form.kind,
        model: form.model,
        baseUrl: form.baseUrl.trim() || null,
        apiKey: form.apiKey,
        params,
        capabilities,
      }),
    });
    setCreating(false);
    if (res.ok) {
      setForm({ ...EMPTY });
      await load();
    } else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setCreateErr(body?.error ?? 'Could not register the model.');
    }
  };

  const remove = async (id: string): Promise<void> => {
    if (!window.confirm('Delete this model? Its stored API key is removed too.')) return;
    const res = await fetch(`/api/model-providers/${id}`, { method: 'DELETE' });
    if (res.ok) await load();
  };

  const logout = async (): Promise<void> => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  return (
    <AppShell active="admin">
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-8">
          <header className="flex items-center justify-between border-b border-border pb-4">
            <h1 className="text-xl font-medium">Models</h1>
            <Button variant="outline" size="sm" onClick={() => void logout()}>
              Sign out
            </Button>
          </header>

          <AdminNav />

          {!ready ? (
            <p className="mt-6 text-sm text-muted-foreground">…</p>
          ) : (
            <>
              <section className="mt-6 flex flex-col gap-3">
                {items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No models yet.</p>
                ) : (
                  items.map((m) => (
                    <div key={m.id} className="rounded-lg border border-border p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium">{m.name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {m.kind} · {m.model}
                            {m.baseUrl ? ` · ${m.baseUrl}` : ''}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {m.params.effort && (
                            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                              {m.params.effort}
                            </span>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => void remove(m.id)}>
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </section>

              <section className="mt-8">
                <h2 className="text-sm font-medium">Register a model</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Bring your own key — it is encrypted at rest and never returned. Leave Base URL
                  empty to use the vendor default; an OpenAI-compatible or self-hosted endpoint
                  needs an explicit one.
                </p>
                <form
                  onSubmit={(e) => void create(e)}
                  className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"
                >
                  <Field
                    label="Name"
                    value={form.name}
                    onChange={(v) => setForm({ ...form, name: v })}
                    required
                    placeholder="Team DeepSeek"
                  />
                  <Field
                    label="Kind"
                    value={form.kind}
                    onChange={(v) => setForm({ ...form, kind: v })}
                  >
                    {(id) => (
                      <select
                        id={id}
                        value={form.kind}
                        onChange={(e) => setForm({ ...form, kind: e.target.value })}
                        className="rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {KINDS.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <Field
                    label="Model"
                    value={form.model}
                    onChange={(v) => setForm({ ...form, model: v })}
                    required
                    placeholder="deepseek-chat"
                    autoComplete="off"
                  />
                  <Field
                    label="Base URL (optional)"
                    value={form.baseUrl}
                    onChange={(v) => setForm({ ...form, baseUrl: v })}
                    placeholder="https://…/v1"
                    autoComplete="off"
                  />
                  <Field
                    label="API key"
                    type="password"
                    value={form.apiKey}
                    onChange={(v) => setForm({ ...form, apiKey: v })}
                    required
                    autoComplete="off"
                  />
                  <Field
                    label="Tool choice (optional)"
                    value={form.toolChoice}
                    onChange={(v) => setForm({ ...form, toolChoice: v })}
                  >
                    {(id) => (
                      <select
                        id={id}
                        value={form.toolChoice}
                        onChange={(e) => setForm({ ...form, toolChoice: e.target.value })}
                        className="rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {TOOL_CHOICE.map((c) => (
                          <option key={c} value={c}>
                            {c === '' ? 'default' : c}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <Field
                    label="Temperature (optional)"
                    type="number"
                    value={form.temperature}
                    onChange={(v) => setForm({ ...form, temperature: v })}
                    placeholder="0"
                  />
                  <Field
                    label="Effort (optional)"
                    value={form.effort}
                    onChange={(v) => setForm({ ...form, effort: v })}
                    placeholder="low / medium / high"
                    autoComplete="off"
                  />
                  <Field
                    label="Max tokens (optional)"
                    type="number"
                    value={form.maxTokens}
                    onChange={(v) => setForm({ ...form, maxTokens: v })}
                  />
                  <div className="flex items-center gap-3 sm:col-span-2">
                    <Button type="submit" disabled={creating}>
                      {creating ? 'Registering…' : 'Register model'}
                    </Button>
                    {createErr && <span className="text-sm text-status-blocked">{createErr}</span>}
                  </div>
                </form>
              </section>
            </>
          )}
        </div>
      </main>
    </AppShell>
  );
}
