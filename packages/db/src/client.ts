/**
 * pglite-backed Drizzle client for the MetadataStore (spec 10 §7 / 08 §9).
 *
 * The metadata store runs in embedded pglite — in-memory by default (dev/demo/
 * smoke), or **file-backed** (`dataDir`) for a persistent self-hosted deploy (the
 * agreed M1 default; no separate database to provision). Schema application is
 * idempotent: the inlined DDL is exec'd only when `evidata_meta` is absent, so a
 * persisted `dataDir` is reused across restarts. A real Postgres metadata host is
 * the opt-in alternative (`METADATA_DATABASE_URL` + the deploy-time `db:migrate`).
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { schema } from './schema';
import { SCHEMA_SQL } from './schema-sql';

export type MetadataDb = PgliteDatabase<typeof schema>;

export interface MetadataDbHandle {
  db: MetadataDb;
  client: PGlite;
  /** Releases the underlying pglite instance. */
  close: () => Promise<void>;
}

export interface CreateMetadataDbOptions {
  /** Filesystem path for persistence. Omit for an in-memory instance (tests/demo). */
  dataDir?: string;
}

/**
 * Create the metadata DB and apply the schema **if not already present**.
 *
 * The DDL itself isn't idempotent (no `IF NOT EXISTS` per object), so we gate it on
 * whether `evidata_meta` exists: a fresh instance (in-memory, or an empty `dataDir`)
 * gets the schema; a persisted `dataDir` is reused untouched. (M2 schema changes will
 * need a migration step — the real-Postgres path already has `db:migrate`.)
 */
export async function createMetadataDb(
  opts: CreateMetadataDbOptions = {},
): Promise<MetadataDbHandle> {
  const client = opts.dataDir ? new PGlite(opts.dataDir) : new PGlite();
  const db = drizzle(client, { schema });
  const present = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.schemata WHERE schema_name = 'evidata_meta'
     ) AS exists`,
  );
  if (!present.rows[0]?.exists) {
    // Apply the DDL atomically (PG DDL is transactional). An interrupted first boot
    // rolls back entirely, so a persisted dir is never left half-initialized — the
    // existence check above stays a reliable "fully applied" marker (Codex P2).
    // (Cross-version, in-place schema upgrades need a real migrator — tracked in #88.)
    await client.exec(`BEGIN;\n${SCHEMA_SQL}\nCOMMIT;`);
  }
  return {
    db,
    client,
    close: () => client.close(),
  };
}
