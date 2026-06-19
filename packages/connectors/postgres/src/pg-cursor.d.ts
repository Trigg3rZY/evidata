// Minimal ambient types for `pg-cursor` (it ships no types). We use only the
// callback `read` and `close` (spec 08 §2 — server-side cursor, bounded reads).
declare module 'pg-cursor' {
  import type { FieldDef } from 'pg';

  interface CursorResult {
    fields: FieldDef[];
  }

  export default class Cursor<R = Record<string, unknown>> {
    constructor(text: string, values?: unknown[]);
    // Makes a Cursor a pg `Submittable`, so `client.query(new Cursor(...))` is typed
    // as returning a Cursor (not the generic Submittable).
    submit(connection: unknown): void;
    read(rowCount: number, cb: (err: Error | null, rows: R[], result: CursorResult) => void): void;
    close(cb: (err?: Error) => void): void;
  }
}
