'use client';

import { Button } from '@/components/ui/button';
import { ModeToggle } from '@/components/mode-toggle';
import { useI18n } from '@/lib/i18n';

export default function Home() {
  const { t, lang, setLang } = useI18n();
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-sm font-medium text-primary-foreground">
            e
          </span>
          <span className="font-medium">{t('brand')}</span>
        </div>
        <div className="flex items-center gap-2">
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

      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-medium">{t('title')}</h1>
        <p className="text-muted-foreground">{t('tagline')}</p>
      </div>

      <section className="rounded-lg border border-border bg-card p-5 text-card-foreground">
        <div className="text-sm text-muted-foreground">{t('sample')}</div>
        <Button className="mt-4">{t('ask')}</Button>
      </section>
    </main>
  );
}
