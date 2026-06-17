import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SCHEMA_SQL } from './schema-sql';

const drizzleDir = fileURLToPath(new URL('../drizzle', import.meta.url));
const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

describe('SCHEMA_SQL ↔ drizzle migrations', () => {
  it('matches the concatenation of the committed migration files (no drift)', () => {
    const combined = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => readFileSync(`${drizzleDir}/${f}`, 'utf8'))
      .join('\n--> statement-breakpoint\n');
    expect(normalize(SCHEMA_SQL)).toBe(normalize(combined));
  });
});
