/**
 * Drizzle-backed MetadataStore (spec 10 §5) over the pglite metadata schema.
 *
 * Authoritative for version numbering and the single `is_latest` head: every
 * `saveAnswer` runs in one transaction that demotes the prior head, writes the
 * validated Answer document plus its QueryRun/Evidence provenance, and the
 * turn(s). Row ids are store-generated (the runner's per-turn refs like "E1"
 * are not globally unique).
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import {
  type Answer,
  type Investigation,
  type InvestigationWithAnswers,
  type Turn,
  validateAnswer,
  validateAnswerSchema,
} from '@evidata/answer-contract';
import type {
  InvestigationListItem,
  ListOpts,
  MetadataStore,
  NewInvestigation,
  SaveAnswerInput,
} from '@evidata/ports';
import type { MetadataDb } from './client';
import { answers, evidence, investigations, queryRuns, turns } from './schema';

export interface MetadataStoreOptions {
  now?: () => Date;
  newId?: () => string;
}

export class DrizzleMetadataStore implements MetadataStore {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(
    private readonly db: MetadataDb,
    opts: MetadataStoreOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.newId = opts.newId ?? (() => randomUUID());
  }

  async createInvestigation(init: NewInvestigation): Promise<Investigation> {
    const now = this.now();
    await this.db.insert(investigations).values({
      id: init.id,
      dataSourceId: init.dataSourceId,
      title: init.title,
      createdAt: now,
      updatedAt: now,
    });
    return {
      id: init.id,
      dataSourceId: init.dataSourceId,
      title: init.title,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async saveAnswer(input: SaveAnswerInput): Promise<Answer> {
    const { investigationId, question, answer, queryRuns: runs } = input;
    const at = new Date(answer.meta.createdAt);

    return this.db.transaction(async (tx) => {
      const prior = await tx
        .select({ version: answers.version, isLatest: answers.isLatest })
        .from(answers)
        .where(eq(answers.investigationId, investigationId));
      const nextVersion = prior.reduce((m, r) => Math.max(m, r.version), 0) + 1;

      if (prior.some((r) => r.isLatest)) {
        await tx
          .update(answers)
          .set({ isLatest: false })
          .where(and(eq(answers.investigationId, investigationId), eq(answers.isLatest, true)));
      }

      // The store is authoritative for the persisted version number; re-stamp it
      // onto the document (the runner's in-memory meta may predate the DB state).
      const stored: Answer = {
        ...answer,
        meta: { ...answer.meta, version: nextVersion, isLatest: true },
      };

      // G3: never persist an invalid Answer (spec 10 §5/§9). Throwing rolls back
      // the whole transaction.
      const violations = validateAnswer(stored);
      const schema = validateAnswerSchema(stored);
      if (violations.length || !schema.valid) {
        throw new Error(
          `Refusing to persist an invalid Answer (G3): ${JSON.stringify(violations)} ${JSON.stringify(schema.errors)}`,
        );
      }

      if (question) {
        await tx.insert(turns).values({
          id: this.newId(),
          investigationId,
          role: 'user',
          question,
          createdAt: at,
        });
      }

      await tx.insert(answers).values({
        id: this.newId(),
        investigationId,
        version: nextVersion,
        status: stored.status,
        confidence: stored.confidence,
        isLatest: true,
        createdAfterKind: stored.meta.createdAfter?.kind ?? null,
        createdAfterFromVersion: stored.meta.createdAfter?.fromVersion ?? null,
        payload: stored,
        createdAt: at,
      });

      const queryRunIdByRef = new Map<string, string>();
      for (const run of runs) {
        const id = this.newId();
        queryRunIdByRef.set(run.evidenceRef, id);
        await tx.insert(queryRuns).values({
          id,
          investigationId,
          answerVersion: nextVersion,
          connectorId: run.connectorId,
          sql: run.sql,
          status: run.status,
          rowCount: run.rowCount,
          truncated: run.truncated,
          elapsedMs: run.elapsedMs,
          startedAt: at,
        });
      }

      for (const ev of stored.evidence) {
        const queryRunId = queryRunIdByRef.get(ev.id);
        if (!queryRunId) {
          throw new Error(`Evidence ${ev.id} has no recorded QueryRun to bind to`);
        }
        await tx.insert(evidence).values({
          id: this.newId(),
          investigationId,
          answerVersion: nextVersion,
          evidenceRef: ev.id,
          queryRunId,
          purpose: ev.purpose,
          connectorId: ev.connectorId,
          tables: ev.tables,
          sql: ev.sql,
          resultSummary: ev.resultSummary,
          sampleRows: ev.sampleRows ?? null,
          safety: ev.safety,
          policyNotes: ev.policyNotes,
          redactedColumns: ev.redactedColumns,
          createdAt: at,
        });
      }

      await tx.insert(turns).values({
        id: this.newId(),
        investigationId,
        role: 'agent',
        answerVersion: nextVersion,
        createdAt: at,
      });

      await tx
        .update(investigations)
        .set({ updatedAt: at })
        .where(eq(investigations.id, investigationId));

      return stored;
    });
  }

  // Reads are non-transactional (3 sequential queries) — fine for M0; a
  // concurrent saveAnswer could interleave. Wrap in a tx if that ever matters.
  async getInvestigation(id: string): Promise<InvestigationWithAnswers | null> {
    const [inv] = await this.db.select().from(investigations).where(eq(investigations.id, id));
    if (!inv) return null;

    const turnRows = await this.db
      .select()
      .from(turns)
      .where(eq(turns.investigationId, id))
      .orderBy(turns.createdAt);
    const answerRows = await this.db
      .select()
      .from(answers)
      .where(eq(answers.investigationId, id))
      .orderBy(answers.version);

    return {
      id: inv.id,
      dataSourceId: inv.dataSourceId,
      title: inv.title,
      createdAt: inv.createdAt.toISOString(),
      updatedAt: inv.updatedAt.toISOString(),
      turns: turnRows.map(
        (t): Turn => ({
          id: t.id,
          role: t.role,
          createdAt: t.createdAt.toISOString(),
          ...(t.question != null ? { question: t.question } : {}),
          ...(t.answerVersion != null ? { answerVersion: t.answerVersion } : {}),
        }),
      ),
      // The columns are authoritative for version + the single is_latest head; the
      // stored document's meta is stamped at write time and goes stale when a later
      // version demotes it, so overlay the columns onto the returned meta.
      answers: answerRows.map((a) => {
        const doc = a.payload as Answer;
        return { ...doc, meta: { ...doc.meta, version: a.version, isLatest: a.isLatest } };
      }),
    };
  }

  async listInvestigations(opts: ListOpts = {}): Promise<InvestigationListItem[]> {
    const rows = await this.db
      .select({
        id: investigations.id,
        title: investigations.title,
        dataSourceId: investigations.dataSourceId,
        updatedAt: investigations.updatedAt,
        status: answers.status,
      })
      .from(investigations)
      .leftJoin(
        answers,
        and(eq(answers.investigationId, investigations.id), eq(answers.isLatest, true)),
      )
      .orderBy(desc(investigations.updatedAt))
      .limit(opts.limit ?? 50);

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      dataSourceId: r.dataSourceId,
      latestStatus: r.status ?? 'pending',
      updatedAt: r.updatedAt.toISOString(),
    }));
  }
}
