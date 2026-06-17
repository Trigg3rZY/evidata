/**
 * pglite-backed Drizzle client for the M0 MetadataStore (spec 10 §7).
 *
 * In M0 the metadata store runs in embedded pglite (default: in-memory). On
 * boot we apply the schema by exec-ing the inlined DDL (see `schema-sql.ts` for
 * why it is inlined rather than read from disk). The same Drizzle schema
 * graduates to real Postgres in M1, where the file-based migrator can run.
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
  /** Filesystem path for persistence. Omit for an in-memory instance (tests, M0 default). */
  dataDir?: string;
}

/**
 * Creates the metadata DB and applies the schema by exec-ing `SCHEMA_SQL`.
 *
 * M0 default is a fresh in-memory instance (always empty → always safe).
 * WARNING: the DDL is not idempotent (no `IF NOT EXISTS`, no migration journal),
 * so calling this against a non-empty `dataDir` throws ("… already exists").
 * Reusing a persisted `dataDir` is unsupported until the file-based migrator
 * returns for the M1 real-Postgres path.
 */
export async function createMetadataDb(
  opts: CreateMetadataDbOptions = {},
): Promise<MetadataDbHandle> {
  const client = opts.dataDir ? new PGlite(opts.dataDir) : new PGlite();
  const db = drizzle(client, { schema });
  await client.exec(SCHEMA_SQL);
  return {
    db,
    client,
    close: () => client.close(),
  };
}
