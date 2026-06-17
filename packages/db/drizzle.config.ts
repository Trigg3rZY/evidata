import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit config — generates forward-only SQL migrations from `schema.ts`
 * into `./drizzle` (spec 10 §8). `generate` reads only the schema (no DB
 * connection); migrations are applied at runtime by the pglite migrator
 * (`createMetadataDb`). Regenerate with `pnpm --filter @evidata/db db:generate`.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
});
