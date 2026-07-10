'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { ModeToggle } from '@/components/mode-toggle';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';

interface NavUser {
  username: string;
  displayName: string;
}

/**
 * The app-shell top bar (issues #65/#69): brand (→ Ask Data), section tabs, and a
 * primary navigation, plus language/theme/session controls. The conversation's
 * data-source binding is shown beside the send action, where it applies.
 */
export function TopNav({
  active,
  onNewChat,
}: {
  active: 'ask' | 'data-sources' | 'admin';
  onNewChat?: () => void;
}) {
  const { t, lang, setLang } = useI18n();
  // Login status (issue #91): undefined = loading, null = signed out. The Sample
  // Ask path is open, so signed-out is a normal state — show a Sign in link then.
  const [user, setUser] = useState<NavUser | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me')
      .then((r) => (r.ok ? (r.json() as Promise<{ user: NavUser }>) : null))
      .then((d) => {
        if (!cancelled) setUser(d?.user ?? null);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = async (): Promise<void> => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    // Full-page navigation (not router.push): tears down the auth-scoped providers
    // (data sources, models) so the previous user's names/ids can't linger for a
    // signed-out visitor or the next account in this tab (Codex P1).
    window.location.href = '/login';
  };
  const tab = (key: 'ask' | 'data-sources' | 'admin', href: string, label: string) => (
    <Link
      href={href}
      aria-current={active === key ? 'page' : undefined}
      className={`rounded-md px-2.5 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active === key
          ? 'font-medium text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </Link>
  );

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-1.5">
        <Link
          href="/"
          aria-label={t('home')}
          className="mr-1 flex shrink-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-sm font-medium text-primary-foreground">
            e
          </span>
          <span className="hidden font-medium sm:inline">{t('brand')}</span>
        </Link>
        <nav className="flex items-center gap-0.5" aria-label={t('sections')}>
          {tab('ask', '/', t('title'))}
          {tab('data-sources', '/data-sources', t('dataSources'))}
          {tab('admin', '/admin/connections', t('admin'))}
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {onNewChat && (
          <Button variant="ghost" size="icon" className="md:hidden" onClick={onNewChat}>
            <Plus className="h-4 w-4" aria-hidden />
            <span className="sr-only">{t('newChat')}</span>
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => setLang(lang === 'en' ? 'zh-CN' : 'en')}>
          {lang === 'en' ? '中文' : 'EN'}
        </Button>
        <ModeToggle />
        {/* Login status (issue #91): name + sign out, or a sign-in link. */}
        {user === undefined ? null : user ? (
          <div className="flex items-center gap-1.5">
            <span
              className="hidden max-w-[8rem] truncate text-xs text-muted-foreground sm:inline"
              title={user.username}
            >
              {user.displayName}
            </span>
            <Button variant="outline" size="sm" onClick={() => void signOut()}>
              {t('signOut')}
            </Button>
          </div>
        ) : (
          <Link
            href="/login"
            className="rounded-md px-2.5 py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('signIn')}
          </Link>
        )}
      </div>
    </header>
  );
}
