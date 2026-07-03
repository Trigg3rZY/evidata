'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { AdminNav } from '@/components/admin-nav';
import { AppShell } from '@/components/app-shell';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface ConnSummary {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  sslMode: string;
  health: string;
}

type Drawer = { mode: 'new' } | { mode: 'edit'; connection: ConnSummary };

const SSL_MODES = ['require', 'verify-full', 'verify-ca', 'prefer', 'disable'];
const EMPTY = {
  name: '',
  host: '',
  port: '5432',
  database: '',
  sslMode: 'require',
  user: '',
  password: '',
};

/** Admin → Connections (spec 08 §6): manage real database Connections. */
export default function ConnectionsAdminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<ConnSummary[]>([]);
  const [note, setNote] = useState<Record<string, string>>({});
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [formErr, setFormErr] = useState('');
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    health?: string;
    message: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingDraft, setTestingDraft] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const res = await fetch('/api/connections');
    if (res.status === 401) {
      const s = await fetch('/api/setup')
        .then((r) => r.json() as Promise<{ setupComplete: boolean }>)
        .catch(() => ({ setupComplete: true }));
      router.replace(s.setupComplete ? '/login' : '/setup');
      return;
    }
    if (res.ok) {
      setItems((await res.json()) as ConnSummary[]);
      setReady(true);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const openNew = (): void => {
    setForm({ ...EMPTY });
    setFormErr('');
    setTestResult(null);
    setDrawer({ mode: 'new' });
  };

  const openEdit = (connection: ConnSummary): void => {
    setForm({
      name: connection.name,
      host: connection.host,
      port: String(connection.port),
      database: connection.database,
      sslMode: connection.sslMode,
      user: '',
      password: '',
    });
    setFormErr('');
    setTestResult(null);
    setDrawer({ mode: 'edit', connection });
  };

  const closeDrawer = (): void => {
    setDrawer(null);
    setFormErr('');
    setTestResult(null);
  };

  const bodyForDrawer = (): Record<string, string | number> => {
    const body: Record<string, string | number> = {
      name: form.name,
      host: form.host,
      port: Number(form.port),
      database: form.database,
      sslMode: form.sslMode,
    };
    if (drawer?.mode === 'new' || form.user.trim()) body.user = form.user;
    if (drawer?.mode === 'new' || form.password) body.password = form.password;
    return body;
  };

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!drawer) return;
    setSaving(true);
    setFormErr('');
    const res = await fetch(
      drawer.mode === 'new' ? '/api/connections' : `/api/connections/${drawer.connection.id}`,
      {
        method: drawer.mode === 'new' ? 'POST' : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(bodyForDrawer()),
      },
    );
    setSaving(false);
    if (res.ok) {
      closeDrawer();
      await load();
      return;
    }
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    setFormErr(body?.error ?? 'Could not save the connection.');
  };

  const testDraft = async (): Promise<void> => {
    if (!drawer) return;
    setTestingDraft(true);
    setTestResult(null);
    setFormErr('');
    const res = await fetch(
      drawer.mode === 'new'
        ? '/api/connections/test'
        : `/api/connections/${drawer.connection.id}/test-draft`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(bodyForDrawer()),
      },
    );
    setTestingDraft(false);
    const body = (await res.json().catch(() => null)) as { health?: string; error?: string } | null;
    setTestResult(
      res.ok
        ? {
            ok: true,
            ...(body?.health ? { health: body.health } : {}),
            message: `Health: ${healthLabel(body?.health)}`,
          }
        : { ok: false, message: body?.error ?? 'Test failed.' },
    );
  };

  const test = async (id: string): Promise<void> => {
    setNote((n) => ({ ...n, [id]: 'Testing...' }));
    const res = await fetch(`/api/connections/${id}/test`, { method: 'POST' });
    const body = (await res.json().catch(() => null)) as { health?: string; error?: string } | null;
    setNote((n) => ({
      ...n,
      [id]: res.ok ? `Health: ${healthLabel(body?.health)}` : (body?.error ?? 'Failed'),
    }));
    if (res.ok) await load();
  };

  const introspect = async (id: string): Promise<void> => {
    setNote((n) => ({ ...n, [id]: 'Introspecting...' }));
    const res = await fetch(`/api/connections/${id}/introspect`, { method: 'POST' });
    const body = (await res.json().catch(() => null)) as {
      tableCount?: number;
      partial?: boolean;
      error?: string;
    } | null;
    setNote((n) => ({
      ...n,
      [id]: res.ok
        ? `${body?.tableCount ?? 0} tables${body?.partial ? ' (partial)' : ''}`
        : (body?.error ?? 'Failed'),
    }));
  };

  const remove = async (id: string): Promise<void> => {
    const res = await fetch(`/api/connections/${id}`, { method: 'DELETE' });
    if (res.ok) await load();
  };

  // Two-step delete: the ConfirmDialog gates the destructive call (#165).
  const confirmRemove = async (): Promise<void> => {
    const id = pendingDelete;
    setPendingDelete(null);
    if (!id) return;
    await remove(id);
  };

  return (
    <AppShell active="admin">
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-6 py-8">
          <header className="flex items-center justify-between gap-4 border-b border-border pb-4">
            <h1 className="text-xl font-medium">Connections</h1>
            <Button onClick={openNew}>
              <Plus className="h-4 w-4" aria-hidden />
              New connection
            </Button>
          </header>

          <AdminNav />

          {!ready ? (
            <p className="mt-6 text-sm text-muted-foreground">...</p>
          ) : (
            <section className="mt-6 flex flex-col gap-3">
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No connections yet.</p>
              ) : (
                items.map((c) => (
                  <div key={c.id} className="rounded-lg border border-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium">{c.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {c.host}:{c.port}/{c.database} · {c.sslMode}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${healthClass(c.health)}`}
                      >
                        {healthLabel(c.health)}
                      </span>
                    </div>
                    {healthHint(c.health) && (
                      <p className="mt-2 text-xs text-status-partial">{healthHint(c.health)}</p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => void test(c.id)}>
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                        Test
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openEdit(c)}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                        Edit
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void introspect(c.id)}>
                        <Search className="h-3.5 w-3.5" aria-hidden />
                        Introspect
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setPendingDelete(c.id)}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        Delete
                      </Button>
                      {note[c.id] && (
                        <span className="text-xs text-muted-foreground">{note[c.id]}</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </section>
          )}
        </div>
      </main>

      {drawer && (
        <div className="fixed inset-0 z-40 bg-black/30" onClick={closeDrawer}>
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="connection-drawer-title"
            className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-border bg-background shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 id="connection-drawer-title" className="text-base font-medium">
                {drawer.mode === 'new' ? 'New connection' : 'Edit connection'}
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close"
                onClick={closeDrawer}
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </header>

            <form onSubmit={(e) => void save(e)} className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
                <Field
                  label="Name"
                  value={form.name}
                  onChange={(v) => setForm({ ...form, name: v })}
                  required
                />
                <Field
                  label="Host"
                  value={form.host}
                  onChange={(v) => setForm({ ...form, host: v })}
                  required
                />
                <Field
                  label="Port"
                  type="number"
                  value={form.port}
                  onChange={(v) => setForm({ ...form, port: v })}
                  required
                />
                <Field
                  label="Database"
                  value={form.database}
                  onChange={(v) => setForm({ ...form, database: v })}
                  required
                />
                <Field
                  label="SSL mode"
                  value={form.sslMode}
                  onChange={(v) => setForm({ ...form, sslMode: v })}
                >
                  {(id) => (
                    <select
                      id={id}
                      value={form.sslMode}
                      onChange={(e) => setForm({ ...form, sslMode: e.target.value })}
                      className="rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {SSL_MODES.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field
                  label="Read-only role"
                  value={form.user}
                  onChange={(v) => setForm({ ...form, user: v })}
                  required={drawer.mode === 'new'}
                  autoComplete="off"
                  {...(drawer.mode === 'edit'
                    ? { placeholder: 'Leave blank to keep saved role' }
                    : {})}
                />
                <Field
                  label="Password"
                  type="password"
                  value={form.password}
                  onChange={(v) => setForm({ ...form, password: v })}
                  required={drawer.mode === 'new'}
                  autoComplete="off"
                  {...(drawer.mode === 'edit'
                    ? { placeholder: 'Leave blank to keep saved password' }
                    : {})}
                />
                {testResult && (
                  <div
                    className={`rounded-md px-3 py-2 text-sm ${
                      testResult.ok
                        ? 'bg-status-answered-bg text-status-answered'
                        : 'bg-status-blocked-bg text-status-blocked'
                    }`}
                    role="status"
                  >
                    <div>{testResult.message}</div>
                    {healthHint(testResult.health) && (
                      <div className="mt-1 text-xs">{healthHint(testResult.health)}</div>
                    )}
                  </div>
                )}
                {formErr && <p className="text-sm text-status-blocked">{formErr}</p>}
              </div>

              <footer className="flex flex-col gap-2 border-t border-border px-6 py-4 sm:flex-row sm:flex-wrap sm:items-center">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => void testDraft()}
                  disabled={testingDraft}
                >
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  {testingDraft ? 'Testing...' : 'Test connection'}
                </Button>
                <Button type="submit" className="w-full sm:w-auto" disabled={saving}>
                  {saving ? 'Saving...' : 'Save connection'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full sm:w-auto"
                  onClick={closeDrawer}
                >
                  Cancel
                </Button>
              </footer>
            </form>
          </aside>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this connection?"
        description="This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => void confirmRemove()}
        onCancel={() => setPendingDelete(null)}
      />
    </AppShell>
  );
}

function healthLabel(health?: string): string {
  if (health === 'PermissionInsufficient') return 'Role can write';
  return health || 'Unknown';
}

function healthHint(health?: string): string | null {
  if (health !== 'PermissionInsufficient') return null;
  return 'This role can write. Use a read-only role; this warning does not block use.';
}

function healthClass(health: string): string {
  if (health === 'Healthy') return 'bg-status-answered-bg text-status-answered';
  if (health === 'PermissionInsufficient') return 'bg-status-partial-bg text-status-partial';
  if (health === 'Untested') return 'border border-border text-muted-foreground';
  return 'bg-status-blocked-bg text-status-blocked';
}
