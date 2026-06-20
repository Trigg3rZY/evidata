'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Evidence } from '@evidata/answer-contract';
import { AppShell } from '@/components/app-shell';
import { EvidenceInspector } from '@/components/evidence-inspector';
import { Sidebar } from '@/components/sidebar';
import { Thread } from '@/components/thread';
import { useDataSources } from '@/lib/data-source-context';
import { useModels } from '@/lib/model-context';
import { useI18n } from '@/lib/i18n';

export default function Home() {
  const { t } = useI18n();
  const { activeId } = useDataSources();
  const { activeId: activeModelId, refresh: refreshModels } = useModels();
  // The provider context mounts once with the persistent layout, so re-fetch the
  // model list whenever the workbench is (re)entered — a model just registered in
  // Admin then appears in the picker without a full reload.
  useEffect(() => {
    refreshModels();
  }, [refreshModels]);
  // The selected Investigation drives the Thread (via `key`): an id loads that saved
  // thread; `null` is a new conversation. `newKey` forces a fresh new-chat mount.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newKey, setNewKey] = useState(0);
  const [listRefresh, setListRefresh] = useState(0);
  // The evidence shown in the right-pane inspector (issue #49); cleared when the
  // thread changes so stale evidence from another thread never lingers.
  const [inspected, setInspected] = useState<Evidence | null>(null);

  const newChat = useCallback((): void => {
    setSelectedId(null);
    setNewKey((k) => k + 1);
    setInspected(null);
  }, []);
  const selectThread = useCallback((id: string) => {
    setSelectedId(id);
    setInspected(null);
  }, []);
  const refreshList = useCallback(() => setListRefresh((k) => k + 1), []);

  return (
    <AppShell active="ask" onNewChat={newChat}>
      <Sidebar
        selectedId={selectedId}
        onSelect={selectThread}
        onNewChat={newChat}
        refreshKey={listRefresh}
      />

      {/* The conversation column — the only thing that scrolls (issue #63). Clean: no
          brand/title/toggles (those live in the top nav). The h1 stays for a11y. */}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <h1 className="sr-only">{t('title')}</h1>
        <div className="mx-auto flex min-h-full w-full max-w-2xl flex-1 flex-col px-6 py-6">
          <Thread
            key={selectedId ?? `new-${newKey}`}
            initialInvestigationId={selectedId}
            dataSourceId={activeId}
            modelProviderId={activeModelId}
            onClear={newChat}
            onCreated={refreshList}
            onInspect={setInspected}
          />
        </div>
      </main>

      {/* Right pane: evidence inspector (lg+ persistent column; manages its own scroll). */}
      <aside className="hidden w-80 shrink-0 flex-col border-l border-border bg-card lg:flex">
        <EvidenceInspector evidence={inspected} onClose={() => setInspected(null)} />
      </aside>

      {/* On small screens the inspector is a dismissible bottom sheet. */}
      {inspected && (
        <div className="fixed inset-x-0 bottom-0 z-20 flex max-h-[55vh] flex-col border-t border-border bg-card shadow-lg lg:hidden">
          <EvidenceInspector evidence={inspected} onClose={() => setInspected(null)} />
        </div>
      )}
    </AppShell>
  );
}
