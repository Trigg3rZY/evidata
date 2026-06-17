'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'zh-CN';

// Minimal seed catalog for the skeleton; the typed catalog moves to packages/i18n
// as the UI grows (spec 04 §4). AI answer content is never translated here.
const dict = {
  en: {
    brand: 'evidata',
    title: 'Ask Data',
    tagline: 'Trusted, evidence-backed answers over your data.',
    ask: 'Ask a question',
    sample: 'Sample Data Source',
  },
  'zh-CN': {
    brand: 'evidata',
    title: '数据问答',
    tagline: '基于证据、可信赖的数据回答。',
    ask: '提个问题',
    sample: '示例数据源',
  },
} as const;

type MessageKey = keyof (typeof dict)['en'];

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>('en');
  const value = useMemo<I18nValue>(() => ({ lang, setLang, t: (key) => dict[lang][key] }), [lang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within a LangProvider');
  return ctx;
}
