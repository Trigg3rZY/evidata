'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';

/** Sign in to the admin area. Redirects to first-run setup if no account exists yet. */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
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
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (res.ok) router.push('/admin/connections');
    else setError('Invalid email or password.');
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-xl font-medium">Sign in</h1>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          required
          autoComplete="username"
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
    </main>
  );
}
