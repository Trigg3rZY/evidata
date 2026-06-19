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
import { and, desc, eq, gt, sql } from 'drizzle-orm';
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
  NewSession,
  NewUser,
  SaveAnswerInput,
  UserRecord,
} from '@evidata/ports';
import type { MetadataDb } from './client';
import { answers, evidence, investigations, queryRuns, sessions, turns, users } from './schema';

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

  // --- M1 identity (spec 08 §5) ---

  async countUsers(): Promise<number> {
    const [row] = await this.db.select({ n: sql<number>`count(*)::int` }).from(users);
    return row?.n ?? 0;
  }

  async createFirstUser(user: NewUser): Promise<UserRecord | null> {
    return this.db.transaction(async (tx) => {
      // Serialize concurrent first-run setups: the check + insert are one critical
      // section, so a racing requester can't also see zero users (spec 08 §5).
      await tx.execute(sql`SELECT pg_advisory_xact_lock(491001)`);
      const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(users);
      if ((row?.n ?? 0) > 0) return null;
      const createdAt = this.now();
      await tx.insert(users).values({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        passwordHash: user.passwordHash,
        createdAt,
      });
      return { ...user, createdAt: createdAt.toISOString() };
    });
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email));
    return row ? toUserRecord(row) : null;
  }

  async createSession(session: NewSession): Promise<void> {
    await this.db.insert(sessions).values({
      id: session.id,
      userId: session.userId,
      tokenHash: session.tokenHash,
      createdAt: this.now(),
      expiresAt: session.expiresAt,
    });
  }

  async getSessionUser(tokenHash: string): Promise<UserRecord | null> {
    const [row] = await this.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        passwordHash: users.passwordHash,
        createdAt: users.createdAt,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, this.now())));
    return row ? toUserRecord(row) : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }
}

function toUserRecord(row: {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  createdAt: Date;
}): UserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    passwordHash: row.passwordHash,
    createdAt: row.createdAt.toISOString(),
  };
}
