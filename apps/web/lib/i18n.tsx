'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AnswerStatus, Confidence } from '@evidata/answer-contract';

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
    // Answer chrome (StatusBadge / ConfidenceMeter / AnswerView / UnblockPathView).
    // AI answer *content* stays in the question's language; only these labels switch.
    statusAnswered: 'Answered',
    statusNeedsClarification: 'Needs clarification',
    statusPartial: 'Partial',
    statusBlockedByPolicy: 'Blocked by policy',
    statusNoReliableAnswer: 'No reliable answer',
    confidence: 'Confidence',
    confidenceHigh: 'High',
    confidenceMedium: 'Medium',
    confidenceLow: 'Low',
    confidenceUndetermined: 'Undetermined',
    answerWhatIDid: 'What I did',
    answerEvidence: 'Evidence',
    answerAssumptions: 'Assumptions',
    unblockWhatsMissing: "What's missing",
    unblockRecordedForAdmin: 'Recorded for an Admin',
    // Client-side stream failures (the server's own error frame is separate).
    errorRequestFailed: 'The request could not be started.',
    errorNetworkInterrupted: 'A network error interrupted the answer.',
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
    statusAnswered: '已回答',
    statusNeedsClarification: '需要澄清',
    statusPartial: '部分回答',
    statusBlockedByPolicy: '被策略阻止',
    statusNoReliableAnswer: '无可靠答案',
    confidence: '置信度',
    confidenceHigh: '高',
    confidenceMedium: '中',
    confidenceLow: '低',
    confidenceUndetermined: '无法确定',
    answerWhatIDid: '我做了什么',
    answerEvidence: '证据',
    answerAssumptions: '假设',
    unblockWhatsMissing: '缺少什么',
    unblockRecordedForAdmin: '已记录,待管理员处理',
    errorRequestFailed: '无法发起请求。',
    errorNetworkInterrupted: '网络错误中断了回答。',
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

/**
 * The chrome labels an `AnswerView` (and its children) need. AnswerView is a pure
 * function of one Answer (spec 04 §2), so it can't call `useI18n` — the client
 * `Thread` resolves these once and threads them down as data. AI answer *content*
 * is never in here; only the surrounding labels.
 */
export interface AnswerLabels {
  status: Record<AnswerStatus, string>;
  confidence: { label: string; levels: Record<Confidence, string> };
  whatIDid: string;
  evidence: string;
  assumptions: string;
  unblock: { whatsMissing: string; recordedForAdmin: string };
}

/** Resolve the active catalog into a typed `AnswerLabels` bundle. */
export function answerLabels(t: (key: MessageKey) => string): AnswerLabels {
  return {
    status: {
      Answered: t('statusAnswered'),
      NeedsClarification: t('statusNeedsClarification'),
      Partial: t('statusPartial'),
      BlockedByPolicy: t('statusBlockedByPolicy'),
      NoReliableAnswer: t('statusNoReliableAnswer'),
    },
    confidence: {
      label: t('confidence'),
      levels: {
        High: t('confidenceHigh'),
        Medium: t('confidenceMedium'),
        Low: t('confidenceLow'),
        CannotDetermine: t('confidenceUndetermined'),
      },
    },
    whatIDid: t('answerWhatIDid'),
    evidence: t('answerEvidence'),
    assumptions: t('answerAssumptions'),
    unblock: {
      whatsMissing: t('unblockWhatsMissing'),
      recordedForAdmin: t('unblockRecordedForAdmin'),
    },
  };
}
