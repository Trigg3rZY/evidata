import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMetadataDb, DrizzleMetadataStore, type MetadataDbHandle } from '@evidata/db';
import type { Complete } from '@evidata/provider-openai';
import { AuthoringAccessError } from './authoring-service';
import { CalibrationError, CalibrationService, type CalibrationDraft } from './calibration-service';

const blob = { v: 1, keyId: 'k1', iv: 'a', ciphertext: 'b', authTag: 'c' };
let handle: MetadataDbHandle;
let store: DrizzleMetadataStore;

/** A Complete that always answers with one submit_calibration tool call. */
const fakeComplete =
  (draft: CalibrationDraft): Complete =>
  () =>
    Promise.resolve({
      content: null,
      tool_calls: [
        {
          id: 't1',
          type: 'function' as const,
          function: { name: 'submit_calibration', arguments: JSON.stringify(draft) },
        },
      ],
    });

const svc = (complete: Complete | null): CalibrationService =>
  new CalibrationService({ store, complete, model: 'test-model' });

beforeAll(async () => {
  handle = await createMetadataDb();
  store = new DrizzleMetadataStore(handle.db);
  const owner = await store.createFirstUser({
    id: 'owner',
    username: 'owner',
    displayName: 'Owner',
    passwordHash: 'x',
  });
  await store.createConnection({
    id: 'c-cal',
    kind: 'postgres',
    name: 'PG',
    host: 'h',
    port: 5432,
    database: 'd',
    sslMode: 'disable',
    credentialBlob: blob,
    health: 'Healthy',
    createdBy: owner!.id,
  });
  await store.createConnectionMembership({
    id: 'm-cal',
    userId: 'owner',
    connectionId: 'c-cal',
    role: 'owner',
  });
  await store.saveSchemaSnapshot({
    id: 'snap-cal',
    connectionId: 'c-cal',
    status: 'complete',
    partial: false,
    payload: {
      dataSourceId: 'c-cal',
      capturedAt: '2026-06-20T00:00:00.000Z',
      partial: false,
      tables: [
        {
          name: 'customers',
          columns: [
            { name: 'id', dataType: 'int', nullable: false, primaryKey: true },
            { name: 'email', dataType: 'text', nullable: true },
          ],
        },
        {
          name: 'orders',
          columns: [
            { name: 'id', dataType: 'int', nullable: false, primaryKey: true },
            {
              name: 'customer_id',
              dataType: 'int',
              nullable: true,
              references: { table: 'customers', column: 'id' },
            },
            { name: 'total', dataType: 'numeric', nullable: true },
          ],
        },
      ],
    },
    capturedAt: new Date(),
  });
  // An empty connection (no snapshot) for the "nothing to calibrate" case.
  await store.createConnection({
    id: 'c-empty',
    kind: 'postgres',
    name: 'Empty',
    host: 'h',
    port: 5432,
    database: 'd',
    sslMode: 'disable',
    credentialBlob: blob,
    health: 'Healthy',
    createdBy: owner!.id,
  });
  await store.createConnectionMembership({
    id: 'm-empty',
    userId: 'owner',
    connectionId: 'c-empty',
    role: 'owner',
  });
  // Data sources (each its own, so tests don't interfere).
  for (const [id, conn] of [
    ['ds-fix', 'c-cal'],
    ['ds-model', 'c-cal'],
    ['ds-dedup', 'c-cal'],
    ['ds-ovr', 'c-cal'],
    ['ds-empty', 'c-empty'],
  ] as const) {
    await store.createDataSource({ id, name: id, kind: 'postgres', connectionId: conn });
  }
});

afterAll(async () => {
  await handle.close();
});

describe('CalibrationService (M2-B2, #120)', () => {
  it('fixture path (no provider): derives FK mappings + proposes an overview (not persisted)', async () => {
    const res = await svc(null).calibrate('owner', 'ds-fix');
    expect(res.glossaryAdded).toBe(0);
    expect(res.mappingsAdded).toBe(1); // orders.customer_id → customers.id
    expect(res.draft.overview).toContain('orders'); // proposed in the result…

    const maps = await store.getEntityMappings('ds-fix', 'suggested');
    expect(maps).toContainEqual({
      fromRef: 'orders.customer_id',
      toRef: 'customers.id',
      status: 'suggested',
      provenance: 'ai_draft',
    });
    // …but the overview is NOT written to live context (the resolver feeds it
    // unfiltered; the owner reviews + Saves — Codex P1).
    expect(await store.getDataSourceContext('ds-fix')).toBeNull();
  });

  it('model path: persists drafted glossary + mappings as Suggested/ai_draft; overview not written', async () => {
    const res = await svc(
      fakeComplete({
        overview: 'Orders and customers.',
        glossary: [{ term: 'spend', definition: 'sum of orders.total' }],
        mappings: [{ from: 'Customer', to: 'customers.id' }],
      }),
    ).calibrate('owner', 'ds-model');
    expect(res).toMatchObject({ glossaryAdded: 1, mappingsAdded: 1 });
    expect(res.draft.overview).toBe('Orders and customers.');
    expect(await store.getDataSourceContext('ds-model')).toBeNull(); // overview not persisted

    const terms = await store.getGlossaryTerms('ds-model', 'suggested');
    expect(terms).toContainEqual({
      term: 'spend',
      definition: 'sum of orders.total',
      status: 'suggested',
      provenance: 'ai_draft',
    });
  });

  it('dedupes against existing items and never downgrades a Verified one', async () => {
    // Pre-seed a Verified term + mapping (e.g. already promoted by an owner).
    await store.addGlossaryTerms([
      {
        id: 'g-v',
        dataSourceId: 'ds-dedup',
        term: 'spend',
        definition: 'verified def',
        status: 'verified',
        provenance: 'admin',
      },
    ]);
    await store.addEntityMappings([
      {
        id: 'm-v',
        dataSourceId: 'ds-dedup',
        fromRef: 'Customer',
        toRef: 'customers.id',
        status: 'verified',
        provenance: 'admin',
      },
    ]);

    const res = await svc(
      fakeComplete({
        overview: '',
        glossary: [
          { term: 'SPEND', definition: 'ai def' }, // dup (case-insensitive) → skipped
          { term: 'revenue', definition: 'new' }, // new → added
        ],
        mappings: [
          { from: 'Customer', to: 'customers.id' }, // dup → skipped
          { from: 'Order', to: 'orders.id' }, // new → added
        ],
      }),
    ).calibrate('owner', 'ds-dedup');
    expect(res).toMatchObject({ glossaryAdded: 1, mappingsAdded: 1 });

    // The Verified items are untouched (still verified, single copy).
    const verified = await store.getGlossaryTerms('ds-dedup', 'verified');
    expect(verified.filter((t) => t.term.toLowerCase() === 'spend')).toHaveLength(1);
    expect(verified[0]?.definition).toBe('verified def');
    // No suggested 'spend' got added.
    const suggested = await store.getGlossaryTerms('ds-dedup', 'suggested');
    expect(suggested.some((t) => t.term.toLowerCase() === 'spend')).toBe(false);
    expect(suggested.some((t) => t.term === 'revenue')).toBe(true);
  });

  it('never writes the overview to live context (owner Saves it)', async () => {
    await store.upsertDataSourceContext({
      id: 'ctx-ovr',
      dataSourceId: 'ds-ovr',
      overview: 'Hand-written.',
      payload: {},
    });
    await svc(fakeComplete({ overview: 'AI overview', glossary: [], mappings: [] })).calibrate(
      'owner',
      'ds-ovr',
    );
    // Calibration leaves the stored overview untouched — it only proposes (in `draft`).
    expect((await store.getDataSourceContext('ds-ovr'))?.overview).toBe('Hand-written.');
  });

  it('owner-gates: a non-member is rejected (404)', async () => {
    await expect(svc(null).calibrate('stranger', 'ds-fix')).rejects.toBeInstanceOf(
      AuthoringAccessError,
    );
  });

  it('errors when there is no captured schema', async () => {
    await expect(svc(null).calibrate('owner', 'ds-empty')).rejects.toBeInstanceOf(CalibrationError);
  });
});
