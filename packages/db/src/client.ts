/**
 * pglite-backed Drizzle client for the M0 MetadataStore (spec 10 §7).
 *
 * In M0 the metadata store runs in embedded pglite (default: in-memory). On
 * boot we apply the forward-only migrations in `./drizzle` (spec 10 §8); the
 * same Drizzle schema graduates to real Postgres in M1 with no code change.
 */
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema } from './schema';

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

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

/** Creates the metadata DB and applies migrations (idempotent). */
export async function createMetadataDb(
  opts: CreateMetadataDbOptions = {},
): Promise<MetadataDbHandle> {
  const client = opts.dataDir ? new PGlite(opts.dataDir) : new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return {
    db,
    client,
    close: () => client.close(),
  };
}
