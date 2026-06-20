/**
 * AI calibration (M2-B2, #120, spec 09 §3) — drafts a Data Source's overview,
 * glossary terms, and entity mappings from its captured schema.
 *
 * Nothing it drafts reaches the Ask model without an explicit owner action:
 * - Glossary/mappings are persisted as **Suggested** (status-gated — the resolver
 *   feeds the model verified-only items), promoted later in the verification UI (B3).
 * - The overview has NO Suggested/Verified status and the resolver passes it to the
 *   model unfiltered, so calibration does NOT write it. It's returned in the result
 *   for the owner to review in the authoring form; their Save is the gate (Codex P1).
 *
 * Owner-gated via the backing Connection (same authz as authoring). The model sees
 * only structural schema (table/column names + types) — no row data, no redaction.
 */
import { randomUUID } from 'node:crypto';
import type { Complete } from '@evidata/provider-openai';
import type {
  MetadataStore,
  NewEntityMapping,
  NewGlossaryTerm,
  SchemaSnapshot,
} from '@evidata/ports';
import { authorizeDataSourceAccess } from './authoring-service';

/** Calibration couldn't run (e.g. no captured schema) — route → 409. */
export class CalibrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalibrationError';
  }
}

/** The model's (or fixture's) proposal before persistence. */
export interface CalibrationDraft {
  overview: string;
  glossary: Array<{ term: string; definition: string }>;
  mappings: Array<{ from: string; to: string }>;
}

export interface CalibrationResult {
  glossaryAdded: number;
  mappingsAdded: number;
  /** The full proposal (incl. items skipped as duplicates, and the overview, which is
   *  NOT persisted — the owner reviews + Saves it). For the UI. */
  draft: CalibrationDraft;
}

type CalibrationStore = Pick<
  MetadataStore,
  | 'getDataSource'
  | 'getConnectionRole'
  | 'getLatestSnapshot'
  | 'getGlossaryTerms'
  | 'getEntityMappings'
  | 'addGlossaryTerms'
  | 'addEntityMappings'
>;

export interface CalibrationServiceDeps {
  store: CalibrationStore;
  /** The provider transport, or null to use the deterministic schema-only fixture
   *  draft (keyless dev/CI/demo). */
  complete: Complete | null;
  /** Model id for the request (the transport closes over the real one; this keeps
   *  the request accurate). */
  model: string;
  newId?: (prefix: string) => string;
}

export class CalibrationService {
  private readonly newId: (prefix: string) => string;

  constructor(private readonly deps: CalibrationServiceDeps) {
    this.newId = deps.newId ?? ((p) => `${p}_${randomUUID()}`);
  }

  /** Draft + persist Suggested calibration for an owned Data Source. */
  async calibrate(userId: string, dataSourceId: string): Promise<CalibrationResult> {
    const { connectionId } = await authorizeDataSourceAccess(this.deps.store, userId, dataSourceId);
    const schema = await this.deps.store.getLatestSnapshot(connectionId);
    if (!schema || schema.tables.length === 0) {
      throw new CalibrationError(
        'Introspect the connection first — there is no schema to calibrate.',
      );
    }

    const draft = this.deps.complete
      ? await draftViaModel(schema, this.deps.complete, this.deps.model)
      : fixtureDraft(schema);

    // The overview is deliberately NOT persisted here (it would reach the model
    // unfiltered, bypassing review — Codex P1). It rides back in `draft` for the owner
    // to review + Save. Glossary / mappings ARE persisted, but as Suggested (the
    // resolver feeds the model verified-only), appended only when new — deduped against
    // every existing item (any status) so we never duplicate or downgrade a Verified one.
    const existingTerms = new Set(
      (await this.deps.store.getGlossaryTerms(dataSourceId)).map((t) =>
        t.term.trim().toLowerCase(),
      ),
    );
    const newTerms: NewGlossaryTerm[] = draft.glossary
      .filter((g) => g.term.trim() && g.definition.trim())
      .filter((g) => !existingTerms.has(g.term.trim().toLowerCase()))
      .map((g) => ({
        id: this.newId('gls'),
        dataSourceId,
        term: g.term.trim(),
        definition: g.definition.trim(),
        status: 'suggested' as const,
        provenance: 'ai_draft' as const,
      }));
    await this.deps.store.addGlossaryTerms(newTerms);

    const existingMaps = new Set(
      (await this.deps.store.getEntityMappings(dataSourceId)).map((m) => `${m.fromRef}→${m.toRef}`),
    );
    const newMaps: NewEntityMapping[] = draft.mappings
      .filter((m) => m.from.trim() && m.to.trim())
      .filter((m) => !existingMaps.has(`${m.from.trim()}→${m.to.trim()}`))
      .map((m) => ({
        id: this.newId('map'),
        dataSourceId,
        fromRef: m.from.trim(),
        toRef: m.to.trim(),
        status: 'suggested' as const,
        provenance: 'ai_draft' as const,
      }));
    await this.deps.store.addEntityMappings(newMaps);

    return { glossaryAdded: newTerms.length, mappingsAdded: newMaps.length, draft };
  }
}

const CALIBRATION_TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_calibration',
    description:
      'Submit the proposed calibration for this data source: a concise overview, ' +
      'business glossary terms, and entity mappings.',
    parameters: {
      type: 'object',
      properties: {
        overview: {
          type: 'string',
          description: '1–2 sentence plain-language overview of the business domain this covers.',
        },
        glossary: {
          type: 'array',
          description: 'Plain-language definitions for non-obvious metrics/columns.',
          items: {
            type: 'object',
            properties: { term: { type: 'string' }, definition: { type: 'string' } },
            required: ['term', 'definition'],
            additionalProperties: false,
          },
        },
        mappings: {
          type: 'array',
          description: 'Business-name→table.column or FK-like table.column→table.column links.',
          items: {
            type: 'object',
            properties: { from: { type: 'string' }, to: { type: 'string' } },
            required: ['from', 'to'],
            additionalProperties: false,
          },
        },
      },
      required: ['overview', 'glossary', 'mappings'],
      additionalProperties: false,
    },
  },
};

const SYSTEM_PROMPT =
  'You calibrate a data source for an evidence-based AI data portal. Given the database ' +
  'schema, propose: (1) a concise overview of the business domain; (2) business glossary ' +
  'terms — plain-language definitions for non-obvious metrics/columns (e.g. what "spend" ' +
  'means in terms of a column + filter); (3) entity mappings — a business name to a ' +
  'table.column, or FK-like table.column to table.column relationships. Be conservative: ' +
  'only propose what the schema clearly supports. Call submit_calibration with your proposal.';

/** One forced tool call against the configured provider; falls back to the fixture
 *  draft if the model returns nothing usable (so calibration always produces a draft). */
async function draftViaModel(
  schema: SchemaSnapshot,
  complete: Complete,
  model: string,
): Promise<CalibrationDraft> {
  const msg = await complete(
    {
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Schema:\n${schemaToText(schema)}\n\nCalibrate this data source.`,
        },
      ],
      tools: [CALIBRATION_TOOL],
      tool_choice: { type: 'function', function: { name: 'submit_calibration' } },
      temperature: 0,
      max_tokens: 2048,
    },
    {},
  );
  const parsed = parseDraft(msg.tool_calls?.[0]?.function.arguments);
  return parsed ?? fixtureDraft(schema);
}

function parseDraft(argsJson: string | undefined): CalibrationDraft | null {
  if (!argsJson) return null;
  try {
    const o = JSON.parse(argsJson) as Record<string, unknown>;
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');
    const pairs = (v: unknown, a: string, b: string): Array<Record<string, string>> =>
      Array.isArray(v)
        ? v
            .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
            .map((x) => ({ [a]: str(x[a]), [b]: str(x[b]) }))
        : [];
    return {
      overview: str(o.overview),
      glossary: pairs(o.glossary, 'term', 'definition') as CalibrationDraft['glossary'],
      mappings: pairs(o.mappings, 'from', 'to') as CalibrationDraft['mappings'],
    };
  } catch {
    return null;
  }
}

/** A compact, bounded schema rendering for the prompt (structural metadata only). */
function schemaToText(schema: SchemaSnapshot): string {
  return schema.tables
    .slice(0, 40)
    .map((t) => {
      const cols = t.columns
        .slice(0, 30)
        .map((c) => {
          const fk = c.references ? ` →${c.references.table}.${c.references.column}` : '';
          const pk = c.primaryKey ? ' pk' : '';
          return `${c.name}:${c.dataType}${pk}${fk}`;
        })
        .join(', ');
      return `- ${t.name}(${cols})`;
    })
    .join('\n');
}

/** Deterministic, keyless draft: a basic overview + FK-derived mappings from the
 *  schema. Used when no provider is configured (dev/CI/demo). */
function fixtureDraft(schema: SchemaSnapshot): CalibrationDraft {
  const names = schema.tables.map((t) => t.name);
  const shown = names.slice(0, 8).join(', ');
  const overview = `A data source with ${names.length} table(s): ${shown}${
    names.length > 8 ? ', …' : ''
  }.`;
  const mappings = schema.tables.flatMap((t) =>
    t.columns
      .filter((c) => c.references)
      .map((c) => ({
        from: `${t.name}.${c.name}`,
        to: `${c.references!.table}.${c.references!.column}`,
      })),
  );
  return { overview, glossary: [], mappings };
}
