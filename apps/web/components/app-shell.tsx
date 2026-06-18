'use client';

import type { ReactNode } from 'react';
import { TopNav } from '@/components/top-nav';

/**
 * The viewport-fixed app shell shared by the routed sections (Ask Data, Data
 * Sources). The top nav stays put; the section fills the content row and owns its
 * own scroll, so the shell never scrolls as a whole (issue #63).
 */
export function AppShell({
  active,
  onNewChat,
  children,
}: {
  active: 'ask' | 'data-sources';
  /** Workbench-only: start a fresh conversation (drives the mobile new-chat button). */
  onNewChat?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopNav active={active} {...(onNewChat ? { onNewChat } : {})} />
      <div className="flex min-h-0 flex-1">{children}</div>
    </div>
  );
}
