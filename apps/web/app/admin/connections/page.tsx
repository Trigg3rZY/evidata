'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminNav } from '@/components/admin-nav';
import { AppShell } from '@/components/app-shell';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';

interface ConnSummary {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  sslMode: string;
  health: string;
}

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

/** Admin → Connections (spec 08 §6): manage real database Connections — create,
 *  test, introspect, remove. Gated client-side; the APIs enforce auth + ownership. */
export default function ConnectionsAdminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<ConnSummary[]>([]);
  const [note, setNote] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ ...EMPTY });
  const [createErr, setCreateErr] = useState('');
  const [creating, setCreating] = useState(false);

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

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setCreating(true);
    setCreateErr('');
    const res = await fetch('/api/connections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...form, port: Number(form.port) }),
    });
    setCreating(false);
    if (res.ok) {
      setForm({ ...EMPTY });
      await load();
    } else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setCreateErr(body?.error ?? 'Could not create the connection.');
    }
  };

  const test = async (id: string): Promise<void> => {
    setNote((n) => ({ ...n, [id]: 'Testing…' }));
    const res = await fetch(`/api/connections/${id}/test`, { method: 'POST' });
    const body = (await res.json().catch(() => null)) as { health?: string; error?: string } | null;
    setNote((n) => ({
      ...n,
      [id]: res.ok ? `Health: ${body?.health}` : (body?.error ?? 'Failed'),
    }));
    if (res.ok) await load();
  };

  const introspect = async (id: string): Promise<void> => {
    setNote((n) => ({ ...n, [id]: 'Introspecting…' }));
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
    if (!window.confirm('Delete this connection?')) return;
    const res = await fetch(`/api/connections/${id}`, { method: 'DELETE' });
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
            <h1 className="text-xl font-medium">Connections</h1>
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
                  <p className="text-sm text-muted-foreground">No connections yet.</p>
                ) : (
                  items.map((c) => (
                    <div key={c.id} className="rounded-lg border border-border p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium">{c.name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {c.host}:{c.port}/{c.database} · {c.sslMode}
                          </div>
                        </div>
                        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                          {c.health}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => void test(c.id)}>
                          Test
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void introspect(c.id)}>
                          Introspect
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void remove(c.id)}>
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

              <section className="mt-8">
                <h2 className="text-sm font-medium">Add a connection</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Use a least-privilege read-only role. Credentials are encrypted at rest.
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
                    label="Read-only role"
                    value={form.user}
                    onChange={(v) => setForm({ ...form, user: v })}
                    required
                    autoComplete="off"
                  />
                  <Field
                    label="Password"
                    type="password"
                    value={form.password}
                    onChange={(v) => setForm({ ...form, password: v })}
                    required
                    autoComplete="off"
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
                  <div className="flex items-center gap-3 sm:col-span-2">
                    <Button type="submit" disabled={creating}>
                      {creating ? 'Adding…' : 'Add connection'}
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
