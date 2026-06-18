'use client';

import { AppShell } from '@/components/app-shell';
import { DataSourceView } from '@/components/data-source-view';

export default function DataSourcesPage() {
  return (
    <AppShell active="data-sources">
      <DataSourceView />
    </AppShell>
  );
}
