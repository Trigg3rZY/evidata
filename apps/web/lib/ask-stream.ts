/**
 * Framework-agnostic glue between the HTTP layer and the InvestigationService:
 * SSE framing, request parsing, M0 scenario selection, and the run-to-SSE
 * orchestration. Kept out of the route handler so it is unit-testable without
 * Next. Wire format matches spec 03 §6 / 04 §1.1.
 */
import type { AgentProvider, AgentRunEvent } from '@evidata/agent';
import type { InvestigationService } from '@evidata/investigation';

export type Lang = 'en' | 'zh-CN';

export interface AskBody {
  dataSourceId: string;
  question: string;
  language: Lang;
}

/** Encode one Server-Sent Event frame. */
export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const SCENARIO_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Explicit mutation phrasings only — benign words like "drop"/"insert" alone
  // shouldn't route here (the real SafetyGate is the actual guard, regardless).
  [
    /\b(update|delete|void|truncate)\b|\b(insert into|drop table|alter table)\b/i,
    'mutation-attempt',
  ],
  [/reconcile|usage.*billing|billing.*usage/i, 'cross-area-reconcile'],
  [/trend|trending/i, 'needs-timerange'],
];

/** M0 maps a question to one of the canned Sample scenarios (FixtureProvider). */
export function pickScenario(question: string): string {
  for (const [pattern, id] of SCENARIO_PATTERNS) {
    if (pattern.test(question)) return id;
  }
  return 'acme-bill-up';
}

/** Validate and normalize a request body. */
export function parseAskBody(raw: unknown): AskBody | { error: string } {
  if (typeof raw !== 'object' || raw === null) return { error: 'Body must be a JSON object.' };
  const body = raw as Record<string, unknown>;
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) return { error: 'A question is required.' };
  const dataSourceId =
    typeof body.dataSourceId === 'string' && body.dataSourceId ? body.dataSourceId : 'sample';
  const language: Lang = body.language === 'zh-CN' ? 'zh-CN' : 'en';
  return { dataSourceId, question, language };
}

export interface AskStreamDeps {
  service: InvestigationService;
  providerFor: (question: string) => AgentProvider;
}

/**
 * Run one Ask Data turn, writing SSE frames via `write`. Streams `reasoning`/
 * `query` events as they occur, then `answer` + `done`. Never throws — a failure
 * emits a product-level `error` frame (no raw internals).
 */
export async function askStream(
  deps: AskStreamDeps,
  body: AskBody,
  write: (chunk: string) => void,
): Promise<void> {
  try {
    const { answer } = await deps.service.ask(
      { dataSourceId: body.dataSourceId, question: body.question, language: body.language },
      {
        provider: deps.providerFor(body.question),
        sink: (event: AgentRunEvent) => write(sseEvent(event.type, event)),
      },
    );
    write(sseEvent('answer', answer));
    write(sseEvent('done', {}));
  } catch {
    write(sseEvent('error', { message: 'The investigation could not be completed.' }));
  }
}
