/**
 * AgentRunner — drives one Investigation turn (spec 03 §1).
 *
 * The runner is the controller and the trust boundary: it owns the SafetyGate,
 * execution, redaction, evidence/QueryRun recording, the reject→status mapping
 * (§5), the step budget, and event emission. The provider only proposes; it
 * only ever sees redacted `ToolResult`s. States: THINKING → SAFETY_GATE →
 * (allow) EXECUTE → (reject) UNBLOCK → FINALIZE.
 */
import type {
  Answer,
  AnswerVersionMeta,
  Evidence,
  ExecOptions,
  QueryRunResult,
  RedactedResult,
  SafetyContext,
  SafetyDecision,
  VersionTrigger,
} from './deps';
import { appendAnswerVersion, validateAnswer, validateAnswerSchema } from './deps';
import type {
  AgentHistory,
  AgentInput,
  AgentProvider,
  AgentRunEvent,
  AnswerDraft,
  RecordedQueryRun,
  RunResult,
  ToolResult,
} from './types';
import { gateRejectToMissing, resolveUnblock, type UnblockResolution } from './unblock';
import type { Connector, Redactor, SafetyGate } from './deps';
import {
  type Lang,
  nonAnswerReason,
  nonAnswerSentence,
  policyNotes,
  resultSummary,
} from './messages';

export interface AgentRunnerDeps {
  provider: AgentProvider;
  connector: Connector;
  gate: SafetyGate;
  redactor: Redactor;
  safetyContext: SafetyContext;
  dataSourceName: string;
  /** Injectable clock — deterministic in tests. Defaults to `new Date()`. */
  now?: () => Date;
  /** Injectable id generator — deterministic in tests. */
  newId?: (prefix: string) => string;
  /** Domain-event sink (phase 6 adapts to SSE). */
  sink?: (e: AgentRunEvent) => void;
  /** Per-turn step budget (spec 03 §1 limits). */
  maxIterations?: number;
  /** Prior versions for a follow-up turn; empty ⇒ this is v1. */
  priorAnswers?: ReadonlyArray<Answer>;
  versionTrigger?: VersionTrigger;
}

type AllowDecision = Extract<SafetyDecision, { verdict: 'allow' }>;

export class AgentRunner {
  constructor(private readonly deps: AgentRunnerDeps) {}

  async run(input: AgentInput): Promise<RunResult> {
    const now = this.deps.now ?? (() => new Date());
    let seq = 0;
    const newId = this.deps.newId ?? ((p: string) => `${p}_${(seq += 1)}`);
    const sink = this.deps.sink ?? (() => {});
    const maxIterations = this.deps.maxIterations ?? 8;
    const policy = this.deps.safetyContext.policy;
    const executor = this.deps.connector.getExecutor();

    const history: AgentHistory = { toolResults: [], reasoning: [] };
    const evidence: Evidence[] = [];
    const queryRuns: RecordedQueryRun[] = [];

    for (let iter = 0; iter < maxIterations; iter++) {
      const decision = await this.deps.provider.next(input, history);

      if (decision.kind === 'reasoning') {
        sink({ type: 'reasoning', label: decision.label });
        history.reasoning.push(decision.label);
        continue;
      }

      if (decision.kind === 'unblock') {
        return this.finalize(
          input,
          this.nonAnswer(input, resolveUnblock(decision.missing)),
          evidence,
          queryRuns,
          now,
        );
      }

      if (decision.kind === 'final') {
        return this.finalize(
          input,
          this.answered(input, decision.draft, evidence, history),
          evidence,
          queryRuns,
          now,
        );
      }

      // kind === 'query' — SAFETY_GATE first (the boundary).
      const { purpose, sql } = decision.proposal;
      const gate = this.deps.gate.check(sql, this.deps.safetyContext);
      if (gate.verdict === 'reject') {
        const res = resolveUnblock(gateRejectToMissing(gate.reason, gate.detail));
        return this.finalize(input, this.nonAnswer(input, res), evidence, queryRuns, now);
      }

      // EXECUTE → redact → record (G4). Gate-rejected proposals never reach here.
      sink({ type: 'query', purpose, status: 'running' });
      const execOptions: ExecOptions = {
        rowLimit: policy.rowLimit,
        timeoutMs: policy.timeoutMs,
        ...(policy.statementTimeoutMs !== undefined
          ? { statementTimeoutMs: policy.statementTimeoutMs }
          : {}),
      };
      const raw = await executor.run(sql, execOptions);
      const redacted = this.deps.redactor.redact(raw, {
        rowLimit: policy.rowLimit,
        sensitiveColumns: this.deps.safetyContext.sensitiveColumns,
      });

      const evidenceRef = `E${evidence.length + 1}`;
      queryRuns.push({
        id: newId('qr'),
        connectorId: this.deps.connector.id,
        sql,
        status: 'ok',
        rowCount: raw.rowCount,
        truncated: raw.truncated,
        elapsedMs: raw.elapsedMs,
        evidenceRef,
      });
      evidence.push(
        this.buildEvidence(evidenceRef, purpose, sql, raw, redacted, gate, input.language),
      );

      const toolResult: ToolResult = {
        evidenceRef,
        purpose,
        columns: redacted.columns,
        sampleRows: redacted.sampleRows,
        rowCount: redacted.rowCount,
        truncated: redacted.truncated,
        redactedColumns: redacted.redactedColumns,
      };
      history.toolResults.push(toolResult);
      sink({
        type: 'query',
        purpose,
        status: 'ok',
        rowCount: raw.rowCount,
        elapsedMs: raw.elapsedMs,
      });
    }

    // Step budget exhausted before the provider concluded.
    const res = resolveUnblock([
      {
        kind: 'insufficient_results',
        description: 'Reached the per-turn step budget before concluding.',
      },
    ]);
    return this.finalize(input, this.nonAnswer(input, res), evidence, queryRuns, now);
  }

  private buildEvidence(
    ref: string,
    purpose: string,
    sql: string,
    raw: QueryRunResult,
    redacted: RedactedResult,
    gate: AllowDecision,
    lang: Lang,
  ): Evidence {
    const policy = this.deps.safetyContext.policy;
    const confirmed = gate.needsConfirmation;
    return {
      id: ref,
      purpose,
      dataSourceId: this.deps.connector.id,
      dataSourceName: this.deps.dataSourceName,
      connectorId: this.deps.connector.id,
      tables: gate.touchedTables,
      sql,
      resultSummary: resultSummary(raw.rowCount, redacted.truncated, lang),
      sampleRows: redacted.sampleRows,
      execution: {
        status: 'ok',
        elapsedMs: raw.elapsedMs,
        rowCount: raw.rowCount,
        truncated: raw.truncated,
      },
      safety: confirmed ? 'confirmed_by_user' : 'auto_executed',
      policyNotes: policyNotes(policy.rowLimit, confirmed, lang),
      redactedColumns: redacted.redactedColumns,
    };
  }

  private answered(
    input: AgentInput,
    draft: AnswerDraft,
    evidence: Evidence[],
    history: AgentHistory,
  ): Answer {
    const whatIDid =
      draft.whatIDid ?? (history.reasoning.length ? history.reasoning.join(' · ') : undefined);
    return {
      investigationId: input.investigationId,
      status: draft.status,
      directAnswer: draft.directAnswer,
      confidence: draft.confidence,
      confidenceReason: draft.confidenceReason,
      keyFindings: draft.keyFindings,
      evidence,
      assumptions: draft.assumptions ?? [],
      caveats: draft.caveats ?? [],
      recommendedFollowups: draft.recommendedFollowups ?? [],
      meta: this.placeholderMeta(),
      ...(whatIDid !== undefined ? { whatIDid } : {}),
      ...(draft.charts !== undefined ? { charts: draft.charts } : {}),
    };
  }

  private nonAnswer(input: AgentInput, res: UnblockResolution): Answer {
    return {
      investigationId: input.investigationId,
      status: res.status,
      directAnswer: nonAnswerSentence(res.status, input.language),
      confidence: 'CannotDetermine',
      confidenceReason: nonAnswerReason(res.status, input.language),
      keyFindings: [],
      evidence: [],
      assumptions: [],
      caveats: [],
      recommendedFollowups: [],
      unblock: res.unblock,
      meta: this.placeholderMeta(),
    };
  }

  private placeholderMeta(): AnswerVersionMeta {
    return { version: 0, createdAt: '', isLatest: false };
  }

  /** Stamp version meta, then validate (never return an invalid answer). */
  private finalize(
    input: AgentInput,
    draft: Answer,
    evidence: Evidence[],
    queryRuns: RecordedQueryRun[],
    now: () => Date,
  ): RunResult {
    // Every status carries the evidence actually gathered this turn: an answered
    // result cites it, and a NoReliableAnswer/Partial still shows the work it did
    // before blocking (NeedsClarification/BlockedByPolicy that ran nothing get []).
    const answer = this.applyVersion({ ...draft, evidence }, now);

    const violations = validateAnswer(answer);
    const schema = validateAnswerSchema(answer);
    if (violations.length || !schema.valid) {
      if (answer.status === 'Answered' || answer.status === 'Partial') {
        // Never show an invalid answered draft — downgrade to an honest non-answer.
        const res = resolveUnblock([
          {
            kind: 'insufficient_results',
            description: 'The drafted answer failed contract validation.',
          },
        ]);
        return this.finalize(input, this.nonAnswer(input, res), evidence, queryRuns, now);
      }
      throw new Error(
        `non-answer failed validation: ${JSON.stringify(violations)} ${JSON.stringify(schema.errors)}`,
      );
    }
    return { answer, queryRuns };
  }

  private applyVersion(answer: Answer, now: () => Date): Answer {
    const prior = this.deps.priorAnswers ?? [];
    const createdAt = now().toISOString();
    if (!prior.length) {
      return { ...answer, meta: { version: 1, createdAt, isLatest: true } };
    }
    const trigger: VersionTrigger = this.deps.versionTrigger ?? 'followup';
    const versions = appendAnswerVersion(prior, answer, { createdAt, trigger });
    return versions[versions.length - 1]!;
  }
}
