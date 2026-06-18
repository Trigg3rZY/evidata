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
  QueryRunRecord,
  RunOptions,
  RunResult,
  ToolResult,
} from './types';
import { RunAbortedError } from './types';
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
  /** Per-turn step budget (provider↔execute turns). Default 16 — generous enough
   *  for a real model to explore multi-step before finalizing; fixtures use far
   *  fewer. The last two steps are the force-finalize window (answer now, plus one
   *  contract retry), so ~14 are free exploration. Tighten per policy if cost matters. */
  maxIterations?: number;
  /** Prior versions for a follow-up turn; empty ⇒ this is v1. */
  priorAnswers?: ReadonlyArray<Answer>;
  versionTrigger?: VersionTrigger;
}

type AllowDecision = Extract<SafetyDecision, { verdict: 'allow' }>;

/** Combined contract-violation messages (structural + JSON schema), for re-prompting. */
function validateAll(answer: Answer): string[] {
  const messages = validateAnswer(answer).map((v) => v.message);
  const schema = validateAnswerSchema(answer);
  if (!schema.valid) {
    messages.push(
      ...schema.errors.map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`.trim()),
    );
  }
  return messages;
}

export class AgentRunner {
  constructor(private readonly deps: AgentRunnerDeps) {}

  async run(input: AgentInput, opts: RunOptions = {}): Promise<RunResult> {
    const { signal } = opts;
    const now = this.deps.now ?? (() => new Date());
    let seq = 0;
    const newId = this.deps.newId ?? ((p: string) => `${p}_${(seq += 1)}`);
    const sink = this.deps.sink ?? (() => {});
    const maxIterations = this.deps.maxIterations ?? 16;
    const policy = this.deps.safetyContext.policy;
    const executor = this.deps.connector.getExecutor();

    const history: AgentHistory = { toolResults: [], reasoning: [] };
    const evidence: Evidence[] = [];
    const queryRuns: QueryRunRecord[] = [];
    let erroredQueries = 0;
    let finalRetried = false;

    // Record a non-fatal query failure (gate reject of a benign mistake, or an
    // engine error) and feed it back so the provider can correct, without aborting
    // the turn. The failed run is still recorded (G4) but is not cited as evidence.
    const recordFailure = (purpose: string, sql: string, message: string): void => {
      const failRef = `qe${(erroredQueries += 1)}`;
      queryRuns.push({
        id: newId('qr'),
        connectorId: this.deps.connector.id,
        sql,
        status: 'error',
        rowCount: 0,
        truncated: false,
        elapsedMs: 0,
        evidenceRef: failRef,
      });
      history.toolResults.push({
        evidenceRef: failRef,
        purpose,
        columns: [],
        sampleRows: [],
        rowCount: 0,
        truncated: false,
        redactedColumns: [],
        error: message,
      });
      sink({ type: 'query', purpose, status: 'error', message });
    };

    for (let iter = 0; iter < maxIterations; iter++) {
      // Cancellation (spec 13 §4): stop between steps so we issue no further model
      // call or query once the caller aborts. pglite queries are short, so a
      // between-steps check + cancelling the in-flight model fetch (via `signal`
      // passed to provider.next) is sufficient; executor-level cancel is M1 (08 §2.1).
      if (signal?.aborted) throw new RunAbortedError();
      // Over the last two steps, ask the provider to answer with what it has rather
      // than keep exploring and run out of budget with no answer. Two steps (not one)
      // leaves room for the single re-prompt retry below if the forced final is
      // invalid — otherwise a forced answer gets no chance to meet the contract.
      history.mustFinalize = iter >= maxIterations - 2;
      const decision = await this.deps.provider.next(input, history, signal);

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
        const candidate = this.applyVersion(
          { ...this.answered(input, decision.draft, evidence, history), evidence },
          now,
        );
        const violations = validateAll(candidate);
        if (violations.length === 0) return { answer: candidate, queryRuns };
        // Re-prompt the provider once with the violations before downgrading (spec 03 §1).
        // This retry is preserved even when finalizing is forced (see the two-step
        // mustFinalize window above); if the corrected answer is still invalid we fall
        // through to the honest non-answer.
        if (!finalRetried) {
          finalRetried = true;
          history.validationFeedback = violations;
          sink({ type: 'reasoning', label: 'Revising the answer to meet the contract' });
          continue;
        }
        const res = resolveUnblock([
          {
            kind: 'insufficient_results',
            description: 'The drafted answer failed contract validation.',
          },
        ]);
        return this.finalize(input, this.nonAnswer(input, res), evidence, queryRuns, now);
      }

      // kind === 'query' — SAFETY_GATE first (the boundary).
      const { purpose, sql } = decision.proposal;
      const gate = this.deps.gate.check(sql, this.deps.safetyContext);
      if (gate.verdict === 'reject') {
        // Writes and admin/maintenance are hard policy boundaries — end the turn
        // with an honest non-answer + Unblock Path (we never retry a mutation).
        // Benign mistakes (unknown table, malformed or multiple statements) are fed
        // back like an engine error so the model can correct, instead of aborting.
        if (gate.reason === 'not_read_only' || gate.reason === 'admin_or_maintenance') {
          const res = resolveUnblock(gateRejectToMissing(gate.reason, gate.detail));
          return this.finalize(input, this.nonAnswer(input, res), evidence, queryRuns, now);
        }
        recordFailure(purpose, sql, `The safety gate rejected this query: ${gate.detail}`);
        continue;
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

      // A real model occasionally proposes SQL the gate allows but the engine
      // rejects (bad column, unsupported function). Don't abort the turn — record
      // the failed run (G4) and feed the error back so the provider can correct.
      let raw: QueryRunResult;
      try {
        raw = await executor.run(sql, execOptions);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'The query could not be executed.';
        recordFailure(purpose, sql, message);
        continue;
      }

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
    queryRuns: QueryRunRecord[],
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
