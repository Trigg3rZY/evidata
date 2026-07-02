/**
 * Drizzle client for the MetadataStore (spec 10 §7 / 08 §9).
 *
 * The metadata store runs in embedded pglite — in-memory by default (dev/demo/
 * smoke), or **file-backed** (`dataDir`) for a persistent self-hosted deploy (the
 * agreed M1 default; no separate database to provision). On boot it brings the schema
 * up to date via a migration **journal** (`_evidata_migrations`): a fresh DB gets all
 * migrations, a persisted one only the new ones — so upgrades add new tables/columns
 * instead of being skipped. A real Postgres metadata host is the opt-in alternative
 * (`METADATA_DATABASE_URL` + the deploy-time `db:migrate`).
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core/db';
import type { PgQueryResultHKT } from 'drizzle-orm/pg-core/session';
import { Pool } from 'pg';
import { schema } from './schema';
import { MIGRATIONS } from './schema-sql';

export type MetadataDb = PgDatabase<PgQueryResultHKT, typeof schema>;
export interface MetadataClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    queryText: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export interface MetadataDbHandle {
  db: MetadataDb;
  client: MetadataClient;
  kind: 'pglite' | 'postgres';
  /** Releases the underlying pglite instance or node-postgres pool. */
  close: () => Promise<void>;
}

export interface CreateMetadataDbOptions {
  /** Filesystem path for persistence. Omit for an in-memory instance (tests/demo). */
  dataDir?: string;
  /** Real Postgres metadata host. Migrations must be applied before runtime. */
  databaseUrl?: string;
}

const JOURNAL = '"public"."_evidata_migrations"';

/**
 * Create the metadata DB and bring its schema up to date by applying any migrations
 * not yet recorded in a journal table. A fresh instance gets all of them; a persisted
 * `dataDir` from an earlier version gets only the new ones — so file-backed upgrades
 * add new tables/columns instead of silently skipping them (issue #90/P1). Each
 * migration runs in its own transaction (atomic; an interrupted boot rolls back).
 */
export async function createMetadataDb(
  opts: CreateMetadataDbOptions = {},
): Promise<MetadataDbHandle> {
  if (opts.databaseUrl) {
    const client = new Pool({
      connectionString: opts.databaseUrl,
      application_name: 'evidata-meta',
    });
    return {
      db: drizzlePg(client, { schema }),
      client,
      kind: 'postgres',
      close: () => client.end(),
    };
  }

  const client = opts.dataDir ? new PGlite(opts.dataDir) : new PGlite();
  const db = drizzle(client, { schema });
  await runMigrations(client);
  return {
    db,
    client,
    kind: 'pglite',
    close: () => client.close(),
  };
}

async function runMigrations(client: PGlite): Promise<void> {
  await client.exec(
    `CREATE TABLE IF NOT EXISTS ${JOURNAL} (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const journalled = new Set(
    (await client.query<{ name: string }>(`SELECT name FROM ${JOURNAL}`)).rows.map((r) => r.name),
  );

  // Adopt a pre-journal database (created before the journal existed): infer which
  // migrations are already applied from the schema and RECORD them in the journal, so
  // we don't re-create existing objects on the first upgrade (and stay recorded after).
  let applied = journalled;
  if (applied.size === 0) {
    applied = await adoptBaseline(client);
    for (const name of applied) {
      await client.query(`INSERT INTO ${JOURNAL} (name) VALUES ($1) ON CONFLICT DO NOTHING`, [
        name,
      ]);
    }
  }

  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    await client.exec(`BEGIN;\n${m.sql}\nCOMMIT;`);
    await client.query(`INSERT INTO ${JOURNAL} (name) VALUES ($1)`, [m.name]);
  }
}

/** One-time journal adoption for databases created before the journal: detect how far
 *  the schema already evolved (by object presence) and record those migrations. */
async function adoptBaseline(client: PGlite): Promise<Set<string>> {
  const exists = async (sql: string): Promise<boolean> => (await client.query(sql)).rows.length > 0;
  const baseline = new Set<string>();
  // No `evidata_meta` → genuinely fresh; nothing to adopt (all migrations run).
  if (
    !(await exists(`SELECT 1 FROM information_schema.schemata WHERE schema_name = 'evidata_meta'`))
  )
    return baseline;
  // Schema present → the M0/M1 migrations (everything up to and including the one that
  // created `data_sources`) ran; mark them through the data_sources migration.
  for (const m of MIGRATIONS) {
    baseline.add(m.name);
    if (m.sql.includes('CREATE TABLE "evidata_meta"."data_sources"')) break;
  }
  // The M2 migration (adds data_sources.lifecycle) only if that column is present.
  if (
    !(await exists(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'evidata_meta' AND table_name = 'data_sources' AND column_name = 'lifecycle'`,
    ))
  ) {
    return baseline;
  }
  for (const m of MIGRATIONS) {
    baseline.add(m.name);
    if (m.sql.includes('ADD COLUMN "lifecycle"')) break;
  }
  return baseline;
}
