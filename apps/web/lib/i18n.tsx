'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'zh-CN';

// Minimal seed catalog for the skeleton; the typed catalog moves to packages/i18n
// as the UI grows (spec 04 §4). AI answer content is never translated here.
const dict = {
  en: {
    brand: 'evidata',
    title: 'Ask Data',
    tagline: 'Trusted, evidence-backed answers over your data.',
    ask: 'Ask a question',
    composerPlaceholder: 'Ask a question about your data…',
    sample: 'Sample Data Source',
    sampleBadge: 'Sample',
    sampleOverview:
      'A demo "Advertising Platform": accounts run campaigns that accrue daily ad spend and are billed monthly via invoices. Good for spend trends, per-campaign breakdowns, and customer rankings.',
    tryAsking: 'Try asking',
    demoNote:
      'Demo answers are scripted (no live model yet) — see the status, evidence, and SQL behind each one.',
    answerReady: 'Answer ready.',
    genericError: 'Something went wrong.',
  },
  'zh-CN': {
    brand: 'evidata',
    title: '数据问答',
    tagline: '基于证据、可信赖的数据回答。',
    ask: '提个问题',
    composerPlaceholder: '就你的数据提个问题…',
    sample: '示例数据源',
    sampleBadge: '示例',
    sampleOverview:
      '一个演示用的"广告平台":账户投放营销活动、产生每日广告消费,并按月开具账单。适合看消费趋势、按活动拆解、以及客户排名。',
    tryAsking: '试着问',
    demoNote: '演示答案是脚本化的(尚未接入实时模型)——重点看每条回答背后的状态、证据与 SQL。',
    answerReady: '回答已就绪。',
    genericError: '出了点问题。',
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
  // Keep <html lang> in sync so assistive tech announces in the right language (spec 04 §4).
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const value = useMemo<I18nValue>(() => ({ lang, setLang, t: (key) => dict[lang][key] }), [lang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within a LangProvider');
  return ctx;
}
