'use client';

import { useCallback, useState } from 'react';
import { Plus } from 'lucide-react';
import { ModeToggle } from '@/components/mode-toggle';
import { Sidebar } from '@/components/sidebar';
import { Thread } from '@/components/thread';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';

export default function Home() {
  const { t, lang, setLang } = useI18n();
  // The selected Investigation drives the Thread (via `key`): an id loads that saved
  // thread; `null` is a new conversation. `newKey` forces a fresh new-chat mount.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newKey, setNewKey] = useState(0);
  const [listRefresh, setListRefresh] = useState(0);

  const newChat = useCallback((): void => {
    setSelectedId(null);
    setNewKey((k) => k + 1);
  }, []);
  const refreshList = useCallback(() => setListRefresh((k) => k + 1), []);

  return (
    <div className="flex min-h-dvh">
      <Sidebar
        selectedId={selectedId}
        onSelect={setSelectedId}
        onNewChat={newChat}
        refreshKey={listRefresh}
      />

      <main className="mx-auto flex min-h-dvh max-w-2xl flex-1 flex-col gap-8 px-6 py-12">
        <header className="flex items-center justify-between">
          <button
            type="button"
            onClick={newChat}
            aria-label={t('home')}
            className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-sm font-medium text-primary-foreground">
              e
            </span>
            <span className="font-medium">{t('brand')}</span>
          </button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="md:hidden" onClick={newChat}>
              <Plus className="h-4 w-4" aria-hidden />
              {t('newChat')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLang(lang === 'en' ? 'zh-CN' : 'en')}
            >
              {lang === 'en' ? '中文' : 'EN'}
            </Button>
            <ModeToggle />
          </div>
        </header>

        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-medium">{t('title')}</h1>
          <p className="text-muted-foreground">{t('tagline')}</p>
        </div>

        <Thread
          key={selectedId ?? `new-${newKey}`}
          initialInvestigationId={selectedId}
          onClear={newChat}
          onCreated={refreshList}
        />
      </main>
    </div>
  );
}
