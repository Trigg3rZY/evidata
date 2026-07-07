'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';

type Role = 'owner' | 'admin' | 'querier';
type Lifecycle = 'draft' | 'published' | 'archived';

interface Member {
  userId: string;
  username: string;
  displayName: string;
  role: Role;
}
interface PendingInvite {
  id: string;
  role: Role;
  expiresAt: string;
  createdAt: string;
}

/**
 * Owner/Admin member management for a Data Source (M2-B1b-2, #121): list members and
 * remove them, mint single-use invite links per role, and revoke pending invites.
 * Rendered inside the AuthoringPanel (already owner/admin-gated) but self-hides on its
 * own `manage_members` check — the members endpoint 404s for non-managers (queriers).
 * The server is the authority on owner-grant / last-owner; the UI just surfaces those
 * refusals as friendly messages.
 */
export function MembersPanel({ id, lifecycle }: { id: string; lifecycle: Lifecycle }) {
  const { t } = useI18n();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [hidden, setHidden] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<Role>('querier');
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped after each mutation to refetch; also refetches when `id` changes.
  const [reload, setReload] = useState(0);

  // Load members + pending invites. A cancelled flag drops a stale response if the
  // panel unmounts mid-flight (the parent keys this by source, so a source switch
  // remounts rather than mutating `id`) — avoiding a setState on an unmounted panel.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [mRes, iRes] = await Promise.all([
        fetch(`/api/data-sources/${encodeURIComponent(id)}/members`).catch(() => null),
        fetch(`/api/data-sources/${encodeURIComponent(id)}/invites`).catch(() => null),
      ]);
      if (cancelled) return;
      if (!mRes?.ok) {
        setHidden(true);
        return;
      }
      const nextMembers = (await mRes.json()) as Member[];
      const nextInvites = iRes?.ok ? ((await iRes.json()) as PendingInvite[]) : [];
      if (cancelled) return;
      setHidden(false);
      setMembers(nextMembers);
      setInvites(nextInvites);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reload]);

  // Identify the caller so the list can mark "(you)" — purely cosmetic; authz is server-side.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me')
      .then((r) => (r.ok ? (r.json() as Promise<{ user: { id: string } }>) : null))
      .then((d) => {
        if (!cancelled) setMyUserId(d?.user?.id ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const roleLabel = (role: Role): string =>
    role === 'owner' ? t('roleOwner') : role === 'admin' ? t('roleAdmin') : t('roleQuerier');

  // Translate a service error code into a friendly message; default to the generic one.
  const friendly = async (res: Response | null): Promise<string> => {
    const code = res
      ? (((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? '')
      : '';
    if (code === 'forbidden_owner_grant') return t('membersErrorOwnerGrant');
    if (code === 'last_owner') return t('membersErrorLastOwner');
    return t('membersError');
  };

  const createInvite = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setLink(null);
    setCopied(false);
    const res = await fetch(`/api/data-sources/${encodeURIComponent(id)}/invites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: inviteRole }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      const { token } = (await res.json()) as { token: string; expiresAt: string };
      setLink(`${window.location.origin}/invite?token=${token}`);
      setReload((n) => n + 1);
    } else {
      setError(await friendly(res));
    }
  };

  const removeMember = async (userId: string): Promise<void> => {
    setBusy(true);
    setError(null);
    const res = await fetch(
      `/api/data-sources/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    ).catch(() => null);
    setBusy(false);
    if (res?.ok) setReload((n) => n + 1);
    else setError(await friendly(res));
  };

  const revokeInvite = async (inviteId: string): Promise<void> => {
    setBusy(true);
    setError(null);
    const res = await fetch(
      `/api/data-sources/${encodeURIComponent(id)}/invites/${encodeURIComponent(inviteId)}`,
      { method: 'DELETE' },
    ).catch(() => null);
    setBusy(false);
    if (res?.ok) setReload((n) => n + 1);
    else setError(await friendly(res));
  };

  const copyLink = async (): Promise<void> => {
    if (!link) return;
    // Only flag "Copied" when the write actually succeeds — clipboard access can be
    // denied (insecure context / permission); the link stays selectable as a fallback.
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      /* no-op */
    }
  };

  if (hidden || !members) return null;

  const badge = (role: Role) => (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
        role === 'owner'
          ? 'bg-status-answered-bg text-status-answered'
          : 'border border-border text-muted-foreground'
      }`}
    >
      {roleLabel(role)}
    </span>
  );

  return (
    <section className="mt-6 border-t border-border pt-6">
      <h3 className="text-sm font-medium">{t('membersLabel')}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{t('membersHint')}</p>

      {/* Current members */}
      <ul className="mt-3 flex flex-col gap-2">
        {members.length === 0 && (
          <li className="text-xs text-muted-foreground">{t('membersEmpty')}</li>
        )}
        {members.map((m) => (
          <li
            key={m.userId}
            className="flex items-center justify-between gap-2 rounded-md border border-border p-2"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{m.displayName}</span>
                {badge(m.role)}
                {m.userId === myUserId && (
                  <span className="text-xs text-muted-foreground">({t('membersYou')})</span>
                )}
              </div>
              <span className="truncate text-xs text-muted-foreground">{m.username}</span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void removeMember(m.userId)}
              disabled={busy}
            >
              {t('membersRemove')}
            </Button>
          </li>
        ))}
      </ul>

      {/* Mint an invite link */}
      <div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
        <div className="text-xs font-medium">{t('membersInvite')}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            aria-label={t('membersInvite')}
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as Role)}
            className="rounded-md border border-border bg-card px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="querier">{t('roleQuerier')}</option>
            <option value="admin">{t('roleAdmin')}</option>
            <option value="owner">{t('roleOwner')}</option>
          </select>
          <Button size="sm" variant="outline" onClick={() => void createInvite()} disabled={busy}>
            {busy ? t('membersInviteCreating') : t('membersInviteCreate')}
          </Button>
        </div>
        {lifecycle === 'draft' && inviteRole === 'querier' && (
          <p className="mt-2 text-xs text-muted-foreground">{t('membersDraftQuerierHint')}</p>
        )}
        {link && (
          <div className="mt-3">
            <p className="text-xs text-muted-foreground">{t('membersLinkHint')}</p>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                readOnly
                value={link}
                onFocus={(e) => e.target.select()}
                className="min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-1 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button size="sm" variant="outline" onClick={() => void copyLink()}>
                {copied ? t('membersCopied') : t('membersCopy')}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Pending invites */}
      {invites.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-medium text-muted-foreground">{t('membersPending')}</div>
          <ul className="mt-2 flex flex-col gap-2">
            {invites.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border p-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  {badge(inv.role)}
                  <span className="truncate text-xs text-muted-foreground">
                    {t('membersExpires')} {new Date(inv.expiresAt).toLocaleDateString()}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void revokeInvite(inv.id)}
                  disabled={busy}
                >
                  {t('membersRevoke')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
    </section>
  );
}
