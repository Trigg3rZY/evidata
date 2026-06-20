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
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import {
  type Answer,
  type Investigation,
  type InvestigationWithAnswers,
  type Turn,
  validateAnswer,
  validateAnswerSchema,
} from '@evidata/answer-contract';
import type {
  ConnectionHealth,
  ConnectionMembershipInput,
  ConnectionRecord,
  ConnectionRole,
  ConnectionSummary,
  DataSourceConnectionInput,
  DataSourceConnectionRecord,
  DataSourceContextInput,
  DataSourceContextRecord,
  DataSourceLifecycle,
  DataSourceRecord,
  EntityMappingRecord,
  FieldRules,
  GlossaryStatus,
  GlossaryTermRecord,
  ModelProviderRecord,
  ModelProviderSummary,
  PolicyInput,
  InvestigationListItem,
  ListOpts,
  MetadataStore,
  NewConnection,
  NewDataSourceRecord,
  NewEntityMapping,
  NewGlossaryTerm,
  NewInvestigation,
  NewModelProvider,
  NewSchemaSnapshotRecord,
  NewSession,
  NewUser,
  PolicyRecord,
  SaveAnswerInput,
  SchemaSnapshot,
  UserRecord,
} from '@evidata/ports';
import type { MetadataDb } from './client';
import {
  answers,
  businessGlossaryTerms,
  connectionMemberships,
  connections,
  dataSourceConnections,
  dataSourceContexts,
  dataSourceMemberships,
  dataSources,
  entityMappings,
  evidence,
  investigations,
  modelProviders,
  policies,
  queryRuns,
  schemaSnapshots,
  sessions,
  turns,
  users,
} from './schema';

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
    const modelProviderId = init.modelProviderId ?? null;
    await this.db.insert(investigations).values({
      id: init.id,
      dataSourceId: init.dataSourceId,
      title: init.title,
      modelProviderId,
      createdAt: now,
      updatedAt: now,
    });
    return {
      id: init.id,
      dataSourceId: init.dataSourceId,
      title: init.title,
      modelProviderId,
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
      modelProviderId: inv.modelProviderId ?? null,
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

  async getInvestigationModelProviderId(id: string): Promise<string | null> {
    const [row] = await this.db
      .select({ modelProviderId: investigations.modelProviderId })
      .from(investigations)
      .where(eq(investigations.id, id));
    return row?.modelProviderId ?? null;
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
        username: user.username,
        displayName: user.displayName,
        passwordHash: user.passwordHash,
        createdAt,
      });
      return { ...user, createdAt: createdAt.toISOString() };
    });
  }

  async getUserByUsername(username: string): Promise<UserRecord | null> {
    const [row] = await this.db.select().from(users).where(eq(users.username, username));
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
        username: users.username,
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

  // --- M1 connections (spec 08 §6) ---

  async createConnection(c: NewConnection): Promise<ConnectionRecord> {
    const at = this.now();
    await this.db.insert(connections).values({
      id: c.id,
      kind: c.kind,
      name: c.name,
      host: c.host,
      port: c.port,
      database: c.database,
      sslMode: c.sslMode,
      credentialBlob: c.credentialBlob,
      health: c.health,
      createdBy: c.createdBy,
      createdAt: at,
      updatedAt: at,
    });
    return { ...c, createdAt: at.toISOString(), updatedAt: at.toISOString() };
  }

  async listConnections(userId: string): Promise<ConnectionSummary[]> {
    // Only connections the caller is a member of — non-members can't enumerate others'.
    const rows = await this.db
      .select()
      .from(connections)
      .innerJoin(connectionMemberships, eq(connectionMemberships.connectionId, connections.id))
      .where(eq(connectionMemberships.userId, userId))
      .orderBy(desc(connections.createdAt));
    return rows.map((r) => toSummary(r.connections));
  }

  async getConnection(id: string): Promise<ConnectionRecord | null> {
    const [row] = await this.db.select().from(connections).where(eq(connections.id, id));
    if (!row) return null;
    return {
      ...toSummary(row),
      credentialBlob: row.credentialBlob as ConnectionRecord['credentialBlob'],
    };
  }

  async setConnectionHealth(id: string, health: ConnectionHealth): Promise<void> {
    await this.db
      .update(connections)
      .set({ health, updatedAt: this.now() })
      .where(eq(connections.id, id));
  }

  async deleteConnection(id: string): Promise<void> {
    // No ON DELETE cascade in the schema — remove dependents first, deepest first.
    // Data Sources backed (M1-style) by this connection, plus their M2 child rows.
    const ownedDs = (
      await this.db
        .select({ id: dataSources.id })
        .from(dataSources)
        .where(eq(dataSources.connectionId, id))
    ).map((r) => r.id);
    if (ownedDs.length > 0) {
      await this.db
        .delete(dataSourceConnections)
        .where(inArray(dataSourceConnections.dataSourceId, ownedDs));
      await this.db
        .delete(dataSourceContexts)
        .where(inArray(dataSourceContexts.dataSourceId, ownedDs));
      await this.db.delete(policies).where(inArray(policies.dataSourceId, ownedDs));
      await this.db
        .delete(businessGlossaryTerms)
        .where(inArray(businessGlossaryTerms.dataSourceId, ownedDs));
      await this.db.delete(entityMappings).where(inArray(entityMappings.dataSourceId, ownedDs));
      await this.db
        .delete(dataSourceMemberships)
        .where(inArray(dataSourceMemberships.dataSourceId, ownedDs));
    }
    // M2-style links to this connection (the join may point at sources we don't own).
    await this.db.delete(dataSourceConnections).where(eq(dataSourceConnections.connectionId, id));
    await this.db.delete(schemaSnapshots).where(eq(schemaSnapshots.connectionId, id));
    await this.db.delete(connectionMemberships).where(eq(connectionMemberships.connectionId, id));
    await this.db.delete(dataSources).where(eq(dataSources.connectionId, id));
    await this.db.delete(connections).where(eq(connections.id, id));
  }

  async createConnectionMembership(m: ConnectionMembershipInput): Promise<void> {
    await this.db.insert(connectionMemberships).values({
      id: m.id,
      userId: m.userId,
      connectionId: m.connectionId,
      role: m.role,
    });
  }

  async getConnectionRole(userId: string, connectionId: string): Promise<ConnectionRole | null> {
    const [row] = await this.db
      .select({ role: connectionMemberships.role })
      .from(connectionMemberships)
      .where(
        and(
          eq(connectionMemberships.userId, userId),
          eq(connectionMemberships.connectionId, connectionId),
        ),
      );
    return row?.role ?? null;
  }

  async saveSchemaSnapshot(s: NewSchemaSnapshotRecord): Promise<void> {
    await this.db.insert(schemaSnapshots).values({
      id: s.id,
      connectionId: s.connectionId,
      status: s.status,
      partial: s.partial,
      payload: s.payload,
      capturedAt: s.capturedAt,
    });
  }

  async getLatestSnapshot(connectionId: string): Promise<SchemaSnapshot | null> {
    const [row] = await this.db
      .select({ payload: schemaSnapshots.payload })
      .from(schemaSnapshots)
      .where(eq(schemaSnapshots.connectionId, connectionId))
      .orderBy(desc(schemaSnapshots.capturedAt))
      .limit(1);
    return row ? (row.payload as SchemaSnapshot) : null;
  }

  // --- BYO-key model providers (epic #106). Keys stay encrypted at rest. ---

  async createModelProvider(p: NewModelProvider): Promise<ModelProviderRecord> {
    const at = this.now();
    await this.db.insert(modelProviders).values({
      id: p.id,
      name: p.name,
      kind: p.kind,
      baseUrl: p.baseUrl,
      model: p.model,
      params: p.params,
      capabilities: p.capabilities,
      credentialBlob: p.credentialBlob,
      createdBy: p.createdBy,
      createdAt: at,
      updatedAt: at,
    });
    return { ...p, createdAt: at.toISOString(), updatedAt: at.toISOString() };
  }

  async listModelProviders(): Promise<ModelProviderSummary[]> {
    const rows = await this.db
      .select()
      .from(modelProviders)
      .orderBy(desc(modelProviders.createdAt));
    return rows.map(toModelProviderSummary);
  }

  async getModelProvider(id: string): Promise<ModelProviderRecord | null> {
    const [row] = await this.db.select().from(modelProviders).where(eq(modelProviders.id, id));
    if (!row) return null;
    return {
      ...toModelProviderSummary(row),
      credentialBlob: row.credentialBlob as ModelProviderRecord['credentialBlob'],
    };
  }

  async deleteModelProvider(id: string): Promise<void> {
    await this.db.delete(modelProviders).where(eq(modelProviders.id, id));
  }

  async createDataSource(ds: NewDataSourceRecord): Promise<void> {
    await this.db.insert(dataSources).values({
      id: ds.id,
      name: ds.name,
      kind: ds.kind,
      connectionId: ds.connectionId,
      createdAt: this.now(),
    });
  }

  async listDataSourcesByConnection(
    connectionId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.db
      .select({ id: dataSources.id, name: dataSources.name })
      .from(dataSources)
      .where(eq(dataSources.connectionId, connectionId));
  }

  // --- M2 authoring reads (spec 09 §2/§5): resolve a published DataSource → runtime. ---

  async getDataSource(id: string): Promise<DataSourceRecord | null> {
    const [row] = await this.db.select().from(dataSources).where(eq(dataSources.id, id)).limit(1);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      connectionId: row.connectionId ?? null,
      description: row.description ?? null,
      lifecycle: row.lifecycle as DataSourceRecord['lifecycle'],
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listPublishedDataSources(): Promise<Array<{ id: string; name: string; kind: string }>> {
    return this.db
      .select({ id: dataSources.id, name: dataSources.name, kind: dataSources.kind })
      .from(dataSources)
      .where(eq(dataSources.lifecycle, 'published'))
      .orderBy(dataSources.name);
  }

  async getDataSourceConnection(dataSourceId: string): Promise<DataSourceConnectionRecord | null> {
    const [row] = await this.db
      .select()
      .from(dataSourceConnections)
      .where(eq(dataSourceConnections.dataSourceId, dataSourceId))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      dataSourceId: row.dataSourceId,
      connectionId: row.connectionId,
      alias: row.alias ?? null,
      includedTables: (row.includedTables as string[]) ?? [],
      fieldRules: (row.fieldRules as FieldRules) ?? {},
      createdAt: row.createdAt.toISOString(),
    };
  }

  async getDataSourceContext(dataSourceId: string): Promise<DataSourceContextRecord | null> {
    const [row] = await this.db
      .select()
      .from(dataSourceContexts)
      .where(eq(dataSourceContexts.dataSourceId, dataSourceId))
      .limit(1);
    if (!row) return null;
    return {
      dataSourceId: row.dataSourceId,
      overview: row.overview,
      payload: row.payload,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async getPolicy(dataSourceId: string): Promise<PolicyRecord | null> {
    const [row] = await this.db
      .select()
      .from(policies)
      .where(eq(policies.dataSourceId, dataSourceId))
      .limit(1);
    if (!row) return null;
    return {
      dataSourceId: row.dataSourceId,
      rowLimit: row.rowLimit,
      timeoutMs: row.timeoutMs,
      statementTimeoutMs: row.statementTimeoutMs ?? null,
      confirmOnBroadScan: row.confirmOnBroadScan,
      confirmOnSensitiveAccess: row.confirmOnSensitiveAccess,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async getGlossaryTerms(
    dataSourceId: string,
    status?: GlossaryStatus,
  ): Promise<GlossaryTermRecord[]> {
    const where = status
      ? and(
          eq(businessGlossaryTerms.dataSourceId, dataSourceId),
          eq(businessGlossaryTerms.status, status),
        )
      : eq(businessGlossaryTerms.dataSourceId, dataSourceId);
    // drizzle types the enum columns as their unions, so the row IS a GlossaryTermRecord.
    return this.db
      .select({
        id: businessGlossaryTerms.id,
        term: businessGlossaryTerms.term,
        definition: businessGlossaryTerms.definition,
        status: businessGlossaryTerms.status,
        provenance: businessGlossaryTerms.provenance,
      })
      .from(businessGlossaryTerms)
      .where(where);
  }

  async getEntityMappings(
    dataSourceId: string,
    status?: GlossaryStatus,
  ): Promise<EntityMappingRecord[]> {
    const where = status
      ? and(eq(entityMappings.dataSourceId, dataSourceId), eq(entityMappings.status, status))
      : eq(entityMappings.dataSourceId, dataSourceId);
    // drizzle types the enum columns as their unions, so the row IS an EntityMappingRecord.
    return this.db
      .select({
        id: entityMappings.id,
        fromRef: entityMappings.fromRef,
        toRef: entityMappings.toRef,
        status: entityMappings.status,
        provenance: entityMappings.provenance,
      })
      .from(entityMappings)
      .where(where);
  }

  // --- M2 authoring writes (spec 09 §5/§7). Upserts keyed by the source's unique. ---

  async addGlossaryTerms(terms: NewGlossaryTerm[]): Promise<void> {
    if (terms.length === 0) return;
    const now = this.now();
    await this.db.insert(businessGlossaryTerms).values(
      terms.map((t) => ({
        id: t.id,
        dataSourceId: t.dataSourceId,
        term: t.term,
        definition: t.definition,
        status: t.status,
        provenance: t.provenance,
        createdAt: now,
      })),
    );
  }

  async addEntityMappings(mappings: NewEntityMapping[]): Promise<void> {
    if (mappings.length === 0) return;
    const now = this.now();
    await this.db.insert(entityMappings).values(
      mappings.map((m) => ({
        id: m.id,
        dataSourceId: m.dataSourceId,
        fromRef: m.fromRef,
        toRef: m.toRef,
        status: m.status,
        provenance: m.provenance,
        createdAt: now,
      })),
    );
  }

  async setGlossaryStatus(dataSourceId: string, id: string, status: GlossaryStatus): Promise<void> {
    await this.db
      .update(businessGlossaryTerms)
      .set({ status })
      .where(
        and(eq(businessGlossaryTerms.id, id), eq(businessGlossaryTerms.dataSourceId, dataSourceId)),
      );
  }

  async updateGlossaryDefinition(
    dataSourceId: string,
    id: string,
    definition: string,
  ): Promise<void> {
    await this.db
      .update(businessGlossaryTerms)
      .set({ definition })
      .where(
        and(eq(businessGlossaryTerms.id, id), eq(businessGlossaryTerms.dataSourceId, dataSourceId)),
      );
  }

  async deleteGlossaryTerm(dataSourceId: string, id: string): Promise<void> {
    await this.db
      .delete(businessGlossaryTerms)
      .where(
        and(eq(businessGlossaryTerms.id, id), eq(businessGlossaryTerms.dataSourceId, dataSourceId)),
      );
  }

  async setEntityMappingStatus(
    dataSourceId: string,
    id: string,
    status: GlossaryStatus,
  ): Promise<void> {
    await this.db
      .update(entityMappings)
      .set({ status })
      .where(and(eq(entityMappings.id, id), eq(entityMappings.dataSourceId, dataSourceId)));
  }

  async deleteEntityMapping(dataSourceId: string, id: string): Promise<void> {
    await this.db
      .delete(entityMappings)
      .where(and(eq(entityMappings.id, id), eq(entityMappings.dataSourceId, dataSourceId)));
  }

  async upsertDataSourceConnection(input: DataSourceConnectionInput): Promise<void> {
    await this.db
      .insert(dataSourceConnections)
      .values({
        id: input.id,
        dataSourceId: input.dataSourceId,
        connectionId: input.connectionId,
        alias: input.alias,
        includedTables: input.includedTables,
        fieldRules: input.fieldRules,
        createdAt: this.now(),
      })
      .onConflictDoUpdate({
        target: [dataSourceConnections.dataSourceId, dataSourceConnections.connectionId],
        set: {
          alias: input.alias,
          includedTables: input.includedTables,
          fieldRules: input.fieldRules,
        },
      });
  }

  async upsertDataSourceContext(input: DataSourceContextInput): Promise<void> {
    await this.db
      .insert(dataSourceContexts)
      .values({
        id: input.id,
        dataSourceId: input.dataSourceId,
        overview: input.overview,
        payload: input.payload,
        updatedAt: this.now(),
      })
      .onConflictDoUpdate({
        target: dataSourceContexts.dataSourceId,
        set: { overview: input.overview, payload: input.payload, updatedAt: this.now() },
      });
  }

  async upsertPolicy(input: PolicyInput): Promise<void> {
    await this.db
      .insert(policies)
      .values({
        id: input.id,
        dataSourceId: input.dataSourceId,
        rowLimit: input.rowLimit,
        timeoutMs: input.timeoutMs,
        statementTimeoutMs: input.statementTimeoutMs,
        confirmOnBroadScan: input.confirmOnBroadScan,
        confirmOnSensitiveAccess: input.confirmOnSensitiveAccess,
        updatedAt: this.now(),
      })
      .onConflictDoUpdate({
        target: policies.dataSourceId,
        set: {
          rowLimit: input.rowLimit,
          timeoutMs: input.timeoutMs,
          statementTimeoutMs: input.statementTimeoutMs,
          confirmOnBroadScan: input.confirmOnBroadScan,
          confirmOnSensitiveAccess: input.confirmOnSensitiveAccess,
          updatedAt: this.now(),
        },
      });
  }

  async setDataSourceLifecycle(
    dataSourceId: string,
    lifecycle: DataSourceLifecycle,
  ): Promise<void> {
    await this.db.update(dataSources).set({ lifecycle }).where(eq(dataSources.id, dataSourceId));
  }
}

function toSummary(row: {
  id: string;
  kind: string;
  name: string;
  host: string;
  port: number;
  database: string;
  sslMode: string;
  health: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}): ConnectionSummary {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    host: row.host,
    port: row.port,
    database: row.database,
    sslMode: row.sslMode,
    health: row.health as ConnectionHealth,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toModelProviderSummary(row: {
  id: string;
  name: string;
  kind: string;
  baseUrl: string | null;
  model: string;
  params: unknown;
  capabilities: unknown;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}): ModelProviderSummary {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    baseUrl: row.baseUrl,
    model: row.model,
    params: row.params as ModelProviderSummary['params'],
    capabilities: row.capabilities as ModelProviderSummary['capabilities'],
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toUserRecord(row: {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  createdAt: Date;
}): UserRecord {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    passwordHash: row.passwordHash,
    createdAt: row.createdAt.toISOString(),
  };
}
