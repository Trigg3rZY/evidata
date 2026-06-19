import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from './schema-sql';

const drizzleDir = fileURLToPath(new URL('../drizzle', import.meta.url));
const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

describe('MIGRATIONS ↔ drizzle files', () => {
  it('inlined migrations match the committed drizzle/*.sql, in order (no drift)', () => {
    const files = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    expect(MIGRATIONS.map((m) => m.name)).toEqual(files.map((f) => f.replace(/\.sql$/, '')));
    for (const m of MIGRATIONS) {
      const fileSql = readFileSync(`${drizzleDir}/${m.name}.sql`, 'utf8');
      expect(normalize(m.sql)).toBe(normalize(fileSql));
    }
  });
});
