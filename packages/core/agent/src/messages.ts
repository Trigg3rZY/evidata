/**
 * Localized runner-authored text (spec: answers follow the question's language).
 * The provider authors answered content; these are the strings the AgentRunner
 * itself generates — non-answer sentences and Evidence summaries/policy notes.
 */
import type { AnswerStatus } from './deps';

export type Lang = 'en' | 'zh-CN';

const NON_ANSWER_SENTENCE: Record<Lang, Record<AnswerStatus, string>> = {
  en: {
    Answered: '',
    Partial: 'I can only partly answer this.',
    BlockedByPolicy: "I can't run that — it's blocked by the read-only policy.",
    NeedsClarification: 'I need a bit more detail before I can answer reliably.',
    NoReliableAnswer: "I can't give a reliable answer to this yet.",
  },
  'zh-CN': {
    Answered: '',
    Partial: '这个问题我只能部分回答。',
    BlockedByPolicy: '无法执行该操作——它被只读策略拦截了。',
    NeedsClarification: '我需要更多信息才能可靠地回答。',
    NoReliableAnswer: '目前我无法对此给出可靠的回答。',
  },
};

const NON_ANSWER_REASON: Record<Lang, Record<AnswerStatus, string>> = {
  en: {
    Answered: '',
    Partial: 'Only part of the question could be answered from the verified data.',
    BlockedByPolicy: 'The proposed action is outside the read-only safety policy.',
    NeedsClarification: 'The question is missing information needed to answer it.',
    NoReliableAnswer: 'The available, verified data does not support a reliable answer.',
  },
  'zh-CN': {
    Answered: '',
    Partial: '只有部分问题能从已核验的数据中得到回答。',
    BlockedByPolicy: '所提操作超出了只读安全策略。',
    NeedsClarification: '问题缺少回答所需的信息。',
    NoReliableAnswer: '现有的、已核验的数据不足以支撑可靠的回答。',
  },
};

export function nonAnswerSentence(status: AnswerStatus, lang: Lang): string {
  return NON_ANSWER_SENTENCE[lang][status];
}

export function nonAnswerReason(status: AnswerStatus, lang: Lang): string {
  return NON_ANSWER_REASON[lang][status];
}

export function resultSummary(rowCount: number, truncated: boolean, lang: Lang): string {
  if (lang === 'zh-CN') return truncated ? `${rowCount} 行(抽样)` : `${rowCount} 行`;
  return truncated ? `${rowCount} rows (sampled)` : `${rowCount} row(s)`;
}

export function policyNotes(rowLimit: number, confirmed: boolean, lang: Lang): string {
  if (lang === 'zh-CN') {
    return `只读 · 行上限 ${rowLimit} · ${confirmed ? '敏感/全表——已确认' : '自动执行(低风险)'}`;
  }
  return `Read-only · row limit ${rowLimit} · ${confirmed ? 'sensitive/broad — confirmed' : 'auto-executed (low risk)'}`;
}
