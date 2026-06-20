'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Sub-nav between the Admin sections (Connections / Models). Both share the
 *  top-nav "Admin" tab, so this row tells the user which admin view they're in
 *  and lets them switch. Active state follows the current path. */
const TABS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/admin/connections', label: 'Connections' },
  { href: '/admin/models', label: 'Models' },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="mt-4 flex gap-1" aria-label="Admin sections">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-md px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              active
                ? 'bg-secondary font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
