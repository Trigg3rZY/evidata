import { error, log } from 'node:console';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const databaseUrl = process.env.METADATA_DATABASE_URL;
if (!databaseUrl) {
  error('METADATA_DATABASE_URL is required for db:migrate.');
  process.exit(1);
}

const { Pool } = pg;
const pool = new Pool({ connectionString: databaseUrl, application_name: 'evidata-db-migrate' });
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');

try {
  await migrate(drizzle(pool), { migrationsFolder });
  log('Metadata migrations applied.');
} finally {
  await pool.end();
}
