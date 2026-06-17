/**
 * Answer Contract — source-of-truth TypeScript types.
 * Derived from PRD v0.3 "Answer Contract", "Interaction Model", and
 * "Status × Confidence" matrix. Shared verbatim between server (producer)
 * and web (renderer). Keep `answer-contract.schema.json` in lockstep.
 *
 * Package: packages/core/answer-contract
 */

// ---------------------------------------------------------------------------
// Localized text (bilingual UI; AI answers follow the question language)
// ---------------------------------------------------------------------------

/** A user-facing string. AI-authored content is a single resolved string in the
 *  answer language; static UI labels use the i18n catalog, not this type. */
export type LocalizedText = string;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type AnswerStatus =
  | 'Answered'
  | 'Partial'
  | 'NeedsClarification'
  | 'BlockedByPolicy'
  | 'NoReliableAnswer';

export type Confidence = 'High' | 'Medium' | 'Low' | 'CannotDetermine';

/**
 * Status × Confidence legality (PRD). Enforced by `isLegalStatusConfidence`.
 *  Answered            -> High | Medium | Low
 *  Partial             -> Medium | Low | CannotDetermine
 *  NeedsClarification  -> CannotDetermine
 *  BlockedByPolicy     -> CannotDetermine
 *  NoReliableAnswer    -> CannotDetermine | Low
 */
export const LEGAL_STATUS_CONFIDENCE: Readonly<Record<AnswerStatus, ReadonlyArray<Confidence>>> = {
  Answered: ['High', 'Medium', 'Low'],
  Partial: ['Medium', 'Low', 'CannotDetermine'],
  NeedsClarification: ['CannotDetermine'],
  BlockedByPolicy: ['CannotDetermine'],
  NoReliableAnswer: ['CannotDetermine', 'Low'],
};

export function isLegalStatusConfidence(s: AnswerStatus, c: Confidence): boolean {
  return LEGAL_STATUS_CONFIDENCE[s].includes(c);
}

/** A status is "answered-like" if it carries a data-backed conclusion. */
export function isAnsweredLike(s: AnswerStatus): boolean {
  return s === 'Answered' || s === 'Partial';
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export type SafetyClassification = 'auto_executed' | 'confirmed_by_user' | 'rejected';

export interface EvidenceExecutionMeta {
  status: 'ok' | 'timeout' | 'connection_lost' | 'zero_rows' | 'error';
  elapsedMs: number;
  rowCount: number;
  truncated: boolean;
}

export interface Evidence {
  id: string; // referenced by Key Findings, e.g. "E1"
  purpose: LocalizedText;
  dataSourceId: string;
  dataSourceName: LocalizedText;
  connectorId: string; // single connection per evidence item
  tables: string[];
  /** Policy-bounded, as-executed SQL. NOT raw internal SQL. (PRD D4) */
  sql: string;
  /** Bounded, redacted result summary. Never raw unauthorized rows. */
  resultSummary: LocalizedText;
  /** Optional small sample of redacted rows for display. */
  sampleRows?: ReadonlyArray<Record<string, unknown>>;
  execution: EvidenceExecutionMeta;
  safety: SafetyClassification;
  /** e.g. "Read-only · row limit 1000 · auto-executed (low risk)" */
  policyNotes: LocalizedText;
  redactedColumns: string[]; // columns masked/omitted for the viewer's role
}

export interface KeyFinding {
  text: LocalizedText;
  /** MUST be non-empty: every Key Finding cites at least one Evidence id. */
  evidenceIds: [string, ...string[]];
  chartRef?: string; // optional reference into `charts`
}

// ---------------------------------------------------------------------------
// Charts (V1: table / bar / line / simple comparison; no chart editor)
// ---------------------------------------------------------------------------

export type ChartKind = 'table' | 'bar' | 'line' | 'comparison';

export interface Chart {
  ref: string;
  kind: ChartKind;
  /** Charts must reference Evidence (PRD Answer Contract). */
  evidenceIds: [string, ...string[]];
  spec: unknown; // bounded, declarative; rendered, never editable in V1
}

// ---------------------------------------------------------------------------
// Unblock Path (every non-`Answered` status carries one)
// ---------------------------------------------------------------------------

export type MissingKind =
  | 'business_object'
  | 'time_range'
  | 'authorization'
  | 'mutation_required'
  | 'ambiguous_definition'
  | 'unverified_mapping'
  | 'insufficient_results';

export type UnblockActionKind =
  | 'specify_object'
  | 'pick_candidate'
  | 'set_time_range'
  | 'pick_definition'
  | 'request_access' // roadmap-routed to Admin
  | 'notify_admin_verify' // creates a Suggested item (correction loop)
  | 'narrow_question'
  | 'view_mutation_draft'; // shows draft + risk notes, never executes

export interface UnblockAction {
  kind: UnblockActionKind;
  label: LocalizedText;
  /** Inline choices, e.g. candidate objects or definition options. */
  choices?: Array<{ id: string; label: LocalizedText; followupQuestion?: LocalizedText }>;
  /** True for actions that create a Suggested edit for Admins (correction loop). */
  createsSuggestion?: boolean;
}

export interface MissingInfo {
  kind: MissingKind;
  /** Precise, named blocker, e.g. "invoices.customer_ref → accounts.id is Suggested". */
  description: LocalizedText;
}

export interface UnblockPath {
  whatsMissing: [MissingInfo, ...MissingInfo[]];
  nextSteps: [UnblockAction, ...UnblockAction[]];
}

// ---------------------------------------------------------------------------
// Assumptions, caveats, follow-ups
// ---------------------------------------------------------------------------

export interface AssumptionItem {
  text: LocalizedText;
  /** Verified glossary/mapping entries relied upon, if any. */
  verifiedRefs?: string[];
}

export interface FollowupSuggestion {
  question: LocalizedText;
}

// ---------------------------------------------------------------------------
// Answer + versioning
// ---------------------------------------------------------------------------

export interface AnswerVersionMeta {
  version: number; // 1-based, monotonic within an Investigation
  createdAt: string; // ISO-8601
  createdAfter?: {
    kind: 'clarification' | 'followup' | 'rerun' | 'definition_correction';
    fromVersion?: number;
  };
  isLatest: boolean;
}

export interface Answer {
  investigationId: string;
  status: AnswerStatus;
  /** One-sentence direct answer (or explicit "cannot fully answer"). */
  directAnswer: LocalizedText;
  confidence: Confidence;
  confidenceReason: LocalizedText; // REQUIRED (PRD)
  whatIDid?: LocalizedText; // collapsible, durable
  keyFindings: KeyFinding[]; // each cites Evidence; empty allowed only for non-answered
  evidence: Evidence[];
  assumptions: AssumptionItem[];
  caveats: LocalizedText[];
  charts?: Chart[];
  recommendedFollowups: FollowupSuggestion[]; // 2-3
  /** REQUIRED when status !== 'Answered' (PRD Unblock Path). */
  unblock?: UnblockPath;
  meta: AnswerVersionMeta;
}

// ---------------------------------------------------------------------------
// Investigation / Thread
// ---------------------------------------------------------------------------

export interface Investigation {
  id: string;
  dataSourceId: string; // bound for the Thread's lifetime
  title: LocalizedText; // renamable; defaults from first question
  createdAt: string;
  updatedAt: string;
}

export interface Turn {
  id: string;
  role: 'user' | 'agent';
  /** For user turns. */
  question?: LocalizedText;
  /** For agent turns: the Answer version produced. */
  answerVersion?: number;
  createdAt: string;
}

export interface InvestigationWithAnswers extends Investigation {
  turns: Turn[];
  answers: Answer[]; // all versions, latest last
}

// ---------------------------------------------------------------------------
// Contract validation (used by AgentRunner before persisting; see spec 03/06)
// ---------------------------------------------------------------------------

export interface ContractViolation {
  code:
    | 'illegal_status_confidence'
    | 'finding_without_evidence'
    | 'dangling_evidence_ref'
    | 'missing_confidence_reason'
    | 'missing_unblock_on_non_answer'
    | 'answered_without_findings';
  message: string;
}

export function validateAnswer(a: Answer): ContractViolation[] {
  const v: ContractViolation[] = [];
  if (!isLegalStatusConfidence(a.status, a.confidence)) {
    v.push({
      code: 'illegal_status_confidence',
      message: `${a.status} + ${a.confidence} is not allowed`,
    });
  }
  if (!a.confidenceReason?.trim()) {
    v.push({ code: 'missing_confidence_reason', message: 'confidenceReason is required' });
  }
  const evidenceIds = new Set(a.evidence.map((e) => e.id));
  for (const f of a.keyFindings) {
    if (!f.evidenceIds?.length) {
      v.push({ code: 'finding_without_evidence', message: `finding has no evidence: "${f.text}"` });
    }
    for (const id of f.evidenceIds ?? []) {
      if (!evidenceIds.has(id)) {
        v.push({ code: 'dangling_evidence_ref', message: `finding cites unknown evidence ${id}` });
      }
    }
  }
  if (a.status !== 'Answered' && !a.unblock) {
    v.push({
      code: 'missing_unblock_on_non_answer',
      message: `${a.status} requires an Unblock Path`,
    });
  }
  if (a.status === 'Answered' && a.keyFindings.length === 0) {
    v.push({
      code: 'answered_without_findings',
      message: 'Answered requires at least one Key Finding',
    });
  }
  return v;
}
