'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
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
    composerPlaceholder: 'Ask a question about your data… (type /clear to start over)',
    narrowQuestionDraft: 'Narrow this to one table, metric, time range, or business object: ',
    newChat: 'New chat',
    home: 'Home',
    history: 'History',
    today: 'Today',
    earlier: 'Earlier',
    noHistory: 'No conversations yet',
    conversation: 'Conversation',
    dataSource: 'Data source',
    dataSources: 'Data Sources',
    model: 'Model',
    admin: 'Admin',
    signIn: 'Sign in',
    signOut: 'Sign out',
    sections: 'Sections',
    overviewLabel: 'Overview',
    exampleQuestions: 'Example questions',
    schemaLabel: 'Schema',
    safetyLabel: 'Safety',
    readOnlyAccess: 'Read-only',
    rowLimitLabel: 'Row limit',
    redactedColumns: 'Redacted',
    askAboutSource: 'Ask about this source',
    colColumn: 'Column',
    colType: 'Type',
    colConstraint: 'Key',
    inspector: 'Evidence',
    inspectorEmpty: 'Select a citation (E1, E2…) to inspect its evidence here.',
    close: 'Close',
    sample: 'Sample Data Source',
    sampleBadge: 'Sample',
    sampleOverview:
      'A demo "Advertising Platform": accounts run campaigns that accrue daily ad spend and are billed monthly via invoices. Good for spend trends, per-campaign breakdowns, and customer rankings.',
    tryAsking: 'Try asking',
    example1: "Why is ACME's ad spend higher this month than last?",
    example2: 'Who are the top customers by spend?',
    example3: 'How is spend trending?',
    demoNote:
      'Answers come from a live model that may only read — every result is gated, redacted, and shown with its status, evidence, and SQL.',
    answerReady: 'Answer ready.',
    genericError: 'Something went wrong.',
    stop: 'Stop',
    stopped: 'Stopped.',
    thinking: 'Thinking…',
    regenerating: 'Regenerating…',
    notExecuted: 'Draft only — not executed',
    actionCopy: 'Copy',
    actionCopied: 'Copied',
    actionRerun: 'Rerun',
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
    usageCalls: 'model calls',
    usageQueries: 'queries',
    unblockWhatsMissing: "What's missing",
    unblockRecordedForAdmin: 'Recorded for an Admin',
    unblockSampleNotReviewed:
      "Sample corrections aren't reviewed. Connect a real Data Source to test this loop.",
    // Client-side stream failures (the server's own error frame is separate).
    errorRequestFailed: 'The request could not be started.',
    errorNetworkInterrupted: 'A network error interrupted the answer.',
    // M2-S3 authoring (owner-only).
    authoringLabel: 'Authoring',
    authoringSections: 'Authoring sections',
    authoringGeneral: 'General',
    authoringSchema: 'Schema',
    authoringIncludedTables: 'Included tables',
    authoringIncludedHint: 'Only checked tables are visible to the AI.',
    authoringSearchTables: 'Search tables',
    authoringTablesIncluded: 'tables included',
    authoringNoTableMatches: 'No matching tables.',
    authoringSensitiveColumns: 'Sensitive columns',
    authoringSensitiveHint: 'Flagged for confirmation and masked in results.',
    authoringSearchColumns: 'Search columns',
    authoringColumnsSelected: 'sensitive',
    authoringNoColumnMatches: 'No matching columns in included tables.',
    authoringOverview: 'Overview',
    authoringOverviewPlaceholder: 'What this source covers, in plain language…',
    authoringPolicy: 'Policy',
    authoringRowLimit: 'Row limit',
    authoringTimeoutMs: 'Timeout (ms)',
    authoringConfirmBroadScan: 'Confirm before a broad scan',
    authoringConfirmSensitive: 'Confirm before sensitive access',
    authoringSave: 'Save draft',
    authoringSaved: 'Saved',
    authoringSaving: 'Saving…',
    authoringPublish: 'Publish',
    authoringUnpublish: 'Unpublish',
    authoringPublished: 'Published',
    authoringDraft: 'Draft',
    authoringReady: 'Ready to publish',
    authoringUnsaved: 'Unsaved changes',
    authoringNotReady: 'To publish, add:',
    authoringSaveError: 'Could not save.',
    authoringCalibrate: 'Draft with AI',
    authoringCalibrating: 'Drafting…',
    authoringCalibrateHint:
      'Propose an overview, glossary, and mappings from the schema — saved as suggestions to review.',
    authoringCalibrateDone: 'AI draft ready — review the overview and Save; suggestions:',
    authoringCalibrateError: 'Could not draft.',
    authoringCalibrateGlossary: 'glossary',
    authoringCalibrateMappings: 'mappings',
    // Context verification (B3): glossary + mappings review.
    authoringContext: 'Context',
    authoringContextHint: 'Only Verified items are visible to the AI.',
    authoringContextEmpty: 'No glossary or mappings yet.',
    authoringGlossary: 'Glossary',
    authoringMappings: 'Mappings',
    authoringVerified: 'Verified',
    authoringSuggested: 'Suggested',
    authoringVerify: 'Verify',
    authoringReject: 'Reject',
    authoringEdit: 'Edit',
    authoringAddTerm: 'Add term',
    authoringAddMapping: 'Add mapping',
    authoringTerm: 'Term',
    authoringDefinition: 'Definition',
    authoringFromRef: 'From',
    authoringToRef: 'To',
    // M2-B4 correction loop (#123): the review queue of querier-raised corrections.
    correctionsLabel: 'Corrections',
    correctionsHint:
      'Queriers flagged these from blocked answers. Verify the matching item to resolve and re-answer.',
    correctionsFrom: 'Raised by',
    correctionsPickTarget: 'Choose the item to verify…',
    correctionsDefinitionPlaceholder: 'Definition (optional)',
    correctionsAccept: 'Verify & accept',
    correctionsReject: 'Dismiss',
    correctionsError: 'Could not apply this correction.',
    // M2-B1b members & access (#121): member management + invite redemption.
    membersLabel: 'Members & access',
    membersHint: 'Manage who can author and query this source.',
    membersYou: 'you',
    roleOwner: 'Owner',
    roleAdmin: 'Admin',
    roleQuerier: 'Querier',
    membersRemove: 'Remove',
    membersInvite: 'Invite a member',
    membersInviteCreate: 'Create invite link',
    membersInviteCreating: 'Creating…',
    membersLinkHint: 'Single-use link — share it privately. It expires.',
    membersCopy: 'Copy',
    membersCopied: 'Copied',
    membersPending: 'Pending invites',
    membersExpires: 'Expires',
    membersRevoke: 'Revoke',
    membersEmpty: 'No members yet.',
    membersErrorOwnerGrant: 'Only an Owner can grant or remove the Owner role.',
    membersErrorLastOwner: "You can't remove the last Owner.",
    membersError: 'Something went wrong. Try again.',
    // Invite redemption page (/invite).
    inviteJoinTitle: 'Join a Data Source',
    inviteJoinDesc: "You've been invited to access this Data Source.",
    inviteJoinButton: 'Join',
    inviteJoining: 'Joining…',
    inviteSignupTitle: 'Accept your invite',
    inviteSignupDesc: 'Create an account to accept this invite.',
    inviteSignupButton: 'Create account & join',
    inviteSignupCreating: 'Creating…',
    inviteFieldName: 'Your name',
    inviteFieldUsername: 'Username',
    inviteFieldPassword: 'Password (8+ characters)',
    inviteNoToken: 'This invite link is missing its token.',
    inviteErrorExpired: 'This invite has expired. Ask for a new link.',
    inviteErrorRedeemed: 'This invite has already been used.',
    inviteErrorNotFound: 'This invite link is invalid.',
    inviteErrorUsernameTaken: 'That username is taken — choose another.',
    inviteErrorInvalidSignup: 'Enter a name, a username, and a password of at least 8 characters.',
    inviteError: 'Could not redeem this invite.',
    commonSave: 'Save',
    commonCancel: 'Cancel',
  },
  'zh-CN': {
    brand: 'evidata',
    title: '数据问答',
    tagline: '基于证据、可信赖的数据回答。',
    ask: '提个问题',
    composerPlaceholder: '就你的数据提个问题…(输入 /clear 可重新开始)',
    narrowQuestionDraft: '请缩小到一个表、指标、时间范围或业务对象：',
    newChat: '新对话',
    home: '首页',
    history: '历史',
    today: '今天',
    earlier: '更早',
    noHistory: '还没有对话',
    conversation: '对话',
    dataSource: '数据源',
    dataSources: '数据源',
    model: '模型',
    admin: '管理',
    signIn: '登录',
    signOut: '登出',
    sections: '分区',
    overviewLabel: '概览',
    exampleQuestions: '示例问题',
    schemaLabel: '表结构',
    safetyLabel: '安全',
    readOnlyAccess: '只读',
    rowLimitLabel: '行数上限',
    redactedColumns: '脱敏列',
    askAboutSource: '就此数据源提问',
    colColumn: '列',
    colType: '类型',
    colConstraint: '键',
    inspector: '证据',
    inspectorEmpty: '点击关键发现里的引用(E1、E2…)在此查看对应证据。',
    close: '关闭',
    sample: '示例数据源',
    sampleBadge: '示例',
    sampleOverview:
      '一个演示用的"广告平台":账户投放营销活动、产生每日广告消费,并按月开具账单。适合看消费趋势、按活动拆解、以及客户排名。',
    tryAsking: '试着问',
    example1: '为什么 ACME 这个月的广告花费比上个月高?',
    example2: '谁是花费最高的客户?',
    example3: '最近的消费趋势如何?',
    demoNote: '答案来自实时模型,且只能读取——每条结果都经过安全门、脱敏,并附带状态、证据与 SQL。',
    answerReady: '回答已就绪。',
    genericError: '出了点问题。',
    stop: '停止',
    stopped: '已停止。',
    thinking: '思考中…',
    regenerating: '重新生成中…',
    notExecuted: '仅为草稿——未执行',
    actionCopy: '复制',
    actionCopied: '已复制',
    actionRerun: '重跑',
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
    usageCalls: '次模型调用',
    usageQueries: '次查询',
    unblockWhatsMissing: '缺少什么',
    unblockRecordedForAdmin: '已记录,待管理员处理',
    unblockSampleNotReviewed: '示例数据源的修正不会被审核。连接真实数据源后再测试这个流程。',
    errorRequestFailed: '无法发起请求。',
    errorNetworkInterrupted: '网络错误中断了回答。',
    // M2-S3 authoring (owner-only).
    authoringLabel: '编辑',
    authoringSections: '编辑分区',
    authoringGeneral: '基础信息',
    authoringSchema: '表结构',
    authoringIncludedTables: '纳入的表',
    authoringIncludedHint: '只有勾选的表对 AI 可见。',
    authoringSearchTables: '搜索表',
    authoringTablesIncluded: '个表已纳入',
    authoringNoTableMatches: '没有匹配的表。',
    authoringSensitiveColumns: '敏感列',
    authoringSensitiveHint: '会触发确认,并在结果中脱敏。',
    authoringSearchColumns: '搜索列',
    authoringColumnsSelected: '敏感',
    authoringNoColumnMatches: '纳入的表中没有匹配的列。',
    authoringOverview: '概览',
    authoringOverviewPlaceholder: '用简明的话描述这个数据源涵盖什么…',
    authoringPolicy: '策略',
    authoringRowLimit: '行数上限',
    authoringTimeoutMs: '超时(毫秒)',
    authoringConfirmBroadScan: '大范围扫描前需确认',
    authoringConfirmSensitive: '访问敏感数据前需确认',
    authoringSave: '保存草稿',
    authoringSaved: '已保存',
    authoringSaving: '保存中…',
    authoringPublish: '发布',
    authoringUnpublish: '撤回发布',
    authoringPublished: '已发布',
    authoringDraft: '草稿',
    authoringReady: '可以发布',
    authoringUnsaved: '有未保存更改',
    authoringNotReady: '发布前还需:',
    authoringSaveError: '保存失败。',
    authoringCalibrate: '用 AI 起草',
    authoringCalibrating: '起草中…',
    authoringCalibrateHint: '根据表结构起草概览、术语与映射——作为待核验的建议保存。',
    authoringCalibrateDone: 'AI 草稿已生成——请检查概览并保存;建议:',
    authoringCalibrateError: '起草失败。',
    authoringCalibrateGlossary: '术语',
    authoringCalibrateMappings: '映射',
    // Context verification (B3): glossary + mappings review.
    authoringContext: '上下文',
    authoringContextHint: '只有已核验的条目对 AI 可见。',
    authoringContextEmpty: '还没有术语或映射。',
    authoringGlossary: '术语',
    authoringMappings: '映射',
    authoringVerified: '已核验',
    authoringSuggested: '待核验',
    authoringVerify: '核验',
    authoringReject: '拒绝',
    authoringEdit: '编辑',
    authoringAddTerm: '添加术语',
    authoringAddMapping: '添加映射',
    authoringTerm: '术语',
    authoringDefinition: '定义',
    authoringFromRef: '来源',
    authoringToRef: '目标',
    // M2-B4 correction loop (#123): the review queue of querier-raised corrections.
    correctionsLabel: '待审修正',
    correctionsHint: '查询者从被阻断的回答里反馈的。核验对应条目即可解决并重新回答。',
    correctionsFrom: '来自',
    correctionsPickTarget: '选择要核验的条目…',
    correctionsDefinitionPlaceholder: '定义(可选)',
    correctionsAccept: '核验并接受',
    correctionsReject: '驳回',
    correctionsError: '无法处理此修正。',
    // M2-B1b members & access (#121): member management + invite redemption.
    membersLabel: '成员与访问',
    membersHint: '管理谁能编辑和查询此数据源。',
    membersYou: '你',
    roleOwner: '所有者',
    roleAdmin: '管理员',
    roleQuerier: '查询者',
    membersRemove: '移除',
    membersInvite: '邀请成员',
    membersInviteCreate: '生成邀请链接',
    membersInviteCreating: '生成中…',
    membersLinkHint: '一次性链接——请私下发送给受邀人,链接会过期。',
    membersCopy: '复制',
    membersCopied: '已复制',
    membersPending: '待兑换邀请',
    membersExpires: '过期',
    membersRevoke: '撤销',
    membersEmpty: '还没有成员。',
    membersErrorOwnerGrant: '只有所有者能授予或移除「所有者」角色。',
    membersErrorLastOwner: '不能移除最后一位所有者。',
    membersError: '出了点问题,请重试。',
    // Invite redemption page (/invite).
    inviteJoinTitle: '加入数据源',
    inviteJoinDesc: '你被邀请访问此数据源。',
    inviteJoinButton: '加入',
    inviteJoining: '加入中…',
    inviteSignupTitle: '接受邀请',
    inviteSignupDesc: '创建账户以接受此邀请。',
    inviteSignupButton: '创建账户并加入',
    inviteSignupCreating: '创建中…',
    inviteFieldName: '你的名字',
    inviteFieldUsername: '用户名',
    inviteFieldPassword: '密码(至少 8 位)',
    inviteNoToken: '此邀请链接缺少令牌。',
    inviteErrorExpired: '此邀请已过期,请索取新链接。',
    inviteErrorRedeemed: '此邀请已被使用。',
    inviteErrorNotFound: '此邀请链接无效。',
    inviteErrorUsernameTaken: '该用户名已被占用,请换一个。',
    inviteErrorInvalidSignup: '请填写名字、用户名,以及至少 8 位的密码。',
    inviteError: '无法兑换此邀请。',
    commonSave: '保存',
    commonCancel: '取消',
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
  // SSR starts at 'en' (deterministic markup); on the client we follow the
  // system/browser language after hydration. A manual toggle wins for the session.
  const [lang, setLang] = useState<Lang>('en');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched && navigator.language.toLowerCase().startsWith('zh')) setLang('zh-CN');
  }, [touched]);

  const choose = useCallback((next: Lang) => {
    setTouched(true);
    setLang(next);
  }, []);

  // Keep <html lang> in sync so assistive tech announces in the right language (spec 04 §4).
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const value = useMemo<I18nValue>(
    () => ({ lang, setLang: choose, t: (key) => dict[lang][key] }),
    [lang, choose],
  );
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
  unblock: {
    whatsMissing: string;
    recordedForAdmin: string;
    sampleNotReviewed: string;
    notExecuted: string;
  };
  actions: { copy: string; copied: string; rerun: string };
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
      sampleNotReviewed: t('unblockSampleNotReviewed'),
      notExecuted: t('notExecuted'),
    },
    actions: { copy: t('actionCopy'), copied: t('actionCopied'), rerun: t('actionRerun') },
  };
}
