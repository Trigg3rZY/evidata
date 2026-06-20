'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';

/** Sign in to the admin area. Redirects to first-run setup if no account exists yet. */
export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/setup')
      .then((r) => r.json() as Promise<{ setupComplete: boolean }>)
      .then((d) => {
        if (!d.setupComplete) router.replace('/setup');
      })
      .catch(() => {});
  }, [router]);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    setBusy(false);
    // Full-page navigation (not router.push): the persistent auth-scoped providers
    // (data sources, models) only fetch on mount, so a hard load makes them reflect
    // the newly signed-in user instead of any prior/empty state (Codex P1).
    if (res.ok) window.location.href = '/admin/connections';
    else setError('Invalid username or password.');
  };

  return (
    <main className="h-dvh overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-sm flex-col justify-center gap-6 px-6 py-10">
        <h1 className="text-xl font-medium">Sign in</h1>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <Field
            label="Username"
            type="text"
            value={username}
            onChange={setUsername}
            required
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
          />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            required
            autoComplete="current-password"
          />
          {error && <p className="text-sm text-status-blocked">{error}</p>}
          <Button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </main>
  );
}
