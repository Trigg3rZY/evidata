/**
 * Server-side singletons (built once per process, lazily). Holds the embedded
 * pglite metadata store + the seeded Sample connector behind one
 * InvestigationService. M0 uses an in-memory metadata DB (resets on restart).
 */
import { createMetadataDb, DrizzleMetadataStore } from '@evidata/db';
import {
  createSampleConnector,
  SAMPLE_DATA_SOURCE_ID,
  SAMPLE_SCHEMA_SNAPSHOT,
  sampleSafetyContext,
  sampleVerifiedContext,
} from '@evidata/connector-sample';
import { createSafetyGate } from '@evidata/safety';
import { createRedactor } from '@evidata/redaction';
import { InvestigationService, type DataSourceRuntime } from '@evidata/investigation';

export interface Runtime {
  service: InvestigationService;
}

// Stash on globalThis so `next dev` hot-reloads reuse one in-memory DB instead
// of leaking a fresh pglite per reload.
const globalForRuntime = globalThis as typeof globalThis & {
  __evidataRuntime?: Promise<Runtime>;
};

async function build(): Promise<Runtime> {
  const db = await createMetadataDb();
  const sample = await createSampleConnector();

  const sampleRuntime: DataSourceRuntime = {
    id: SAMPLE_DATA_SOURCE_ID,
    name: 'Sample — Advertising Platform',
    connector: sample.connector,
    safetyContext: sampleSafetyContext(),
    schema: SAMPLE_SCHEMA_SNAPSHOT,
    context: sampleVerifiedContext(),
  };

  const service = new InvestigationService({
    dataSources: [sampleRuntime],
    gate: createSafetyGate(),
    redactor: createRedactor(),
    store: new DrizzleMetadataStore(db.db),
  });

  return { service };
}

/** Lazily build (and memoize) the runtime so module import stays cheap (no build-time DB). */
export function getRuntime(): Promise<Runtime> {
  if (!globalForRuntime.__evidataRuntime) {
    // Reset on failure so a transient build error (e.g. pglite init) can retry,
    // rather than caching a rejected promise forever.
    globalForRuntime.__evidataRuntime = build().catch((err: unknown) => {
      delete globalForRuntime.__evidataRuntime;
      throw err;
    });
  }
  return globalForRuntime.__evidataRuntime;
}
