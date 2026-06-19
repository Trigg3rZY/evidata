'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';

/** First-run: create the initial Owner. Redirects to login once setup is complete. */
export default function SetupPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/setup')
      .then((r) => r.json() as Promise<{ setupComplete: boolean }>)
      .then((d) => {
        if (d.setupComplete) router.replace('/login');
      })
      .catch(() => {});
  }, [router]);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName, username, password }),
    });
    setBusy(false);
    if (res.ok) {
      router.push('/admin/connections');
      return;
    }
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    setError(body?.error ?? 'Could not complete setup.');
  };

  return (
    <main className="h-dvh overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-sm flex-col justify-center gap-6 px-6 py-10">
        <div>
          <h1 className="text-xl font-medium">Welcome to evidata</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create the first account — the Owner of this self-hosted instance.
          </p>
        </div>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <Field
            label="Your name"
            value={displayName}
            onChange={setDisplayName}
            required
            autoComplete="name"
          />
          <Field
            label="Username"
            type="text"
            value={username}
            onChange={setUsername}
            required
            autoComplete="username"
          />
          <Field
            label="Password (8+ characters)"
            type="password"
            value={password}
            onChange={setPassword}
            required
            autoComplete="new-password"
          />
          {error && <p className="text-sm text-status-blocked">{error}</p>}
          <Button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create Owner account'}
          </Button>
        </form>
      </div>
    </main>
  );
}
