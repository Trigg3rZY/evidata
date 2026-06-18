'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Evidence } from '@evidata/answer-contract';
import { SAMPLE_DATA_SOURCE_ID } from '@evidata/connector-sample';
import { EvidenceInspector } from '@/components/evidence-inspector';
import { Sidebar } from '@/components/sidebar';
import { Thread } from '@/components/thread';
import { TopNav } from '@/components/top-nav';
import { useI18n } from '@/lib/i18n';

export default function Home() {
  const { t } = useI18n();
  // The selected Investigation drives the Thread (via `key`): an id loads that saved
  // thread; `null` is a new conversation. `newKey` forces a fresh new-chat mount.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newKey, setNewKey] = useState(0);
  const [listRefresh, setListRefresh] = useState(0);
  // The evidence shown in the right-pane inspector (issue #49); cleared when the
  // thread changes so stale evidence from another thread never lingers.
  const [inspected, setInspected] = useState<Evidence | null>(null);
  // Available data sources + the active one (M0: just "sample"). Lifted to the shell
  // so the top nav can show "where am I" (issue #65); the server binds a thread to its
  // source for its lifetime, so switching here starts a fresh conversation.
  const [dataSources, setDataSources] = useState<ReadonlyArray<{ id: string; name: string }>>([]);
  const [dataSourceId, setDataSourceId] = useState<string>(SAMPLE_DATA_SOURCE_ID);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/data-sources')
      .then((r) => (r.ok ? (r.json() as Promise<Array<{ id: string; name: string }>>) : []))
      .then((d) => {
        if (cancelled || !Array.isArray(d) || d.length === 0) return;
        setDataSources(d);
        setDataSourceId((cur) => (d.some((x) => x.id === cur) ? cur : (d[0]?.id ?? cur)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
  // Switching the data source begins a new conversation — a source is bound to an
  // Investigation for its lifetime (the server enforces this), so new source = new thread.
  const changeDataSource = useCallback(
    (id: string) => {
      setDataSourceId(id);
      newChat();
    },
    [newChat],
  );

  return (
    // Fixed to the viewport: the shell never scrolls as a whole — each pane (history
    // rail, conversation, inspector) owns its scroll, so the side panes stay put while
    // only the conversation scrolls (issue #63).
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopNav
        dataSources={dataSources}
        dataSourceId={dataSourceId}
        onDataSourceChange={changeDataSource}
        onNewChat={newChat}
      />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          selectedId={selectedId}
          onSelect={selectThread}
          onNewChat={newChat}
          refreshKey={listRefresh}
        />

        {/* The conversation column — the only thing that scrolls. Clean: no brand,
            title, or toggles (those moved to the top nav, issue #65). The page's h1
            stays for a11y/landmarks but is visually hidden. */}
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <h1 className="sr-only">{t('title')}</h1>
          <div className="mx-auto flex min-h-full w-full max-w-2xl flex-1 flex-col px-6 py-6">
            <Thread
              key={selectedId ?? `new-${newKey}`}
              initialInvestigationId={selectedId}
              dataSourceId={dataSourceId}
              onClear={newChat}
              onCreated={refreshList}
              onInspect={setInspected}
            />
          </div>
        </main>

        {/* Right pane: evidence inspector (lg+ persistent column; empty until a
            citation is clicked). It manages its own scroll. */}
        <aside className="hidden w-80 shrink-0 flex-col border-l border-border bg-card lg:flex">
          <EvidenceInspector evidence={inspected} onClose={() => setInspected(null)} />
        </aside>
      </div>

      {/* On small screens the inspector is a dismissible bottom sheet. */}
      {inspected && (
        <div className="fixed inset-x-0 bottom-0 z-20 flex max-h-[55vh] flex-col border-t border-border bg-card shadow-lg lg:hidden">
          <EvidenceInspector evidence={inspected} onClose={() => setInspected(null)} />
        </div>
      )}
    </div>
  );
}
