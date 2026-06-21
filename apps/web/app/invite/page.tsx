'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';

type Me = { user: { id: string; username: string; displayName: string } } | null;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="h-dvh overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-sm flex-col justify-center gap-6 px-6 py-10">
        {children}
      </div>
    </main>
  );
}

/**
 * Invite redemption (M2-B1b-2, #121): reads `?token=` and either grants the role to
 * the signed-in user ("Join") or creates an account (signup-on-redeem). Lives outside
 * the AppShell gate, like /login. On success it does a full-page navigation to '/' so
 * the auth-scoped providers (data sources, models) re-fetch for the joined user (#91).
 */
function InviteRedeem() {
  const { t } = useI18n();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  // undefined = still resolving the session; null = signed out; object = signed in.
  const [me, setMe] = useState<Me | undefined>(undefined);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me')
      .then((r) => (r.ok ? (r.json() as Promise<Me>) : null))
      .then((d) => {
        if (!cancelled) setMe(d ?? null);
      })
      .catch(() => {
        if (!cancelled) setMe(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const messageFor = (code?: string): string => {
    switch (code) {
      case 'expired':
        return t('inviteErrorExpired');
      case 'redeemed':
        return t('inviteErrorRedeemed');
      case 'not_found':
        return t('inviteErrorNotFound');
      case 'username_taken':
        return t('inviteErrorUsernameTaken');
      case 'invalid_signup':
      case 'signup_required':
        return t('inviteErrorInvalidSignup');
      default:
        return t('inviteError');
    }
  };

  const redeem = async (signup?: {
    username: string;
    displayName: string;
    password: string;
  }): Promise<void> => {
    setBusy(true);
    setError('');
    const res = await fetch('/api/invites/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, ...(signup ? { signup } : {}) }),
    }).catch(() => null);
    // On success the signup path set the session cookie; a hard load to '/' makes the
    // auth-scoped providers reflect the joined user. Keep `busy` set while navigating.
    if (res?.ok) {
      window.location.href = '/';
      return;
    }
    setBusy(false);
    const code = res
      ? (((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? undefined)
      : undefined;
    setError(messageFor(code));
  };

  if (!token) {
    return (
      <Shell>
        <p className="text-sm text-status-blocked">{t('inviteNoToken')}</p>
      </Shell>
    );
  }

  if (me === undefined) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">…</p>
      </Shell>
    );
  }

  // Signed in → one-click join.
  if (me) {
    return (
      <Shell>
        <div>
          <h1 className="text-xl font-medium">{t('inviteJoinTitle')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('inviteJoinDesc')}</p>
        </div>
        {error && <p className="text-sm text-status-blocked">{error}</p>}
        <Button onClick={() => void redeem()} disabled={busy}>
          {busy ? t('inviteJoining') : t('inviteJoinButton')}
        </Button>
      </Shell>
    );
  }

  // Signed out → signup-on-redeem.
  return (
    <Shell>
      <div>
        <h1 className="text-xl font-medium">{t('inviteSignupTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('inviteSignupDesc')}</p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void redeem({ username, displayName, password });
        }}
        className="flex flex-col gap-4"
      >
        <Field
          label={t('inviteFieldName')}
          value={displayName}
          onChange={setDisplayName}
          required
          autoComplete="name"
        />
        <Field
          label={t('inviteFieldUsername')}
          type="text"
          value={username}
          onChange={setUsername}
          required
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
        />
        <Field
          label={t('inviteFieldPassword')}
          type="password"
          value={password}
          onChange={setPassword}
          required
          autoComplete="new-password"
        />
        {error && <p className="text-sm text-status-blocked">{error}</p>}
        <Button type="submit" disabled={busy}>
          {busy ? t('inviteSignupCreating') : t('inviteSignupButton')}
        </Button>
      </form>
    </Shell>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={null}>
      <InviteRedeem />
    </Suspense>
  );
}
