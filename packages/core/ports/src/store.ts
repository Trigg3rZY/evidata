/**
 * MetadataStore port (spec 01 §2.5, spec 10 §5).
 *
 * Persists the conversation-first loop: Investigations, their Turns, every
 * Answer version (append-only), and the QueryRun/Evidence provenance behind
 * each version. The Answer Contract document is the unit persisted; the store
 * is authoritative for version numbering and the single `is_latest` head.
 */
import type { Answer, Investigation, InvestigationWithAnswers } from '@evidata/answer-contract';

/** Audit record of one executed query (G4). Shared with the AgentRunner's RunResult. */
export interface QueryRunRecord {
  id: string;
  connectorId: string;
  sql: string;
  /** Execution outcome — every executed statement is recorded, incl. non-`ok` (spec 10 §9). */
  status: 'ok' | 'timeout' | 'connection_lost' | 'zero_rows' | 'error';
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
  /** Links to the Evidence item it backs (e.g. "E1"). */
  evidenceRef: string;
}

export interface NewInvestigation {
  id: string;
  dataSourceId: string;
  title: string;
}

export interface SaveAnswerInput {
  investigationId: string;
  /** The user turn this answer responds to; omit for a rerun (no new user turn). */
  question?: string;
  answer: Answer;
  queryRuns: QueryRunRecord[];
}

export interface InvestigationListItem {
  id: string;
  title: string;
  dataSourceId: string;
  latestStatus: string;
  updatedAt: string;
}

export interface ListOpts {
  limit?: number;
}

export interface MetadataStore {
  createInvestigation(init: NewInvestigation): Promise<Investigation>;
  /**
   * Persist `answer` as the next version of its Investigation (append-only):
   * computes the version, demotes the prior head, writes the answer document,
   * its QueryRuns and Evidence, and the turn(s) — atomically. Returns the
   * stored answer with authoritative version meta.
   */
  saveAnswer(input: SaveAnswerInput): Promise<Answer>;
  getInvestigation(id: string): Promise<InvestigationWithAnswers | null>;
  listInvestigations(opts?: ListOpts): Promise<InvestigationListItem[]>;
}
