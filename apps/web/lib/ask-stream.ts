/**
 * Framework-agnostic glue between the HTTP layer and the InvestigationService:
 * SSE framing, request parsing, M0 scenario selection, and the run-to-SSE
 * orchestration. Kept out of the route handler so it is unit-testable without
 * Next. Wire format matches spec 03 §6 / 04 §1.1.
 */
import type { AgentProvider, AgentRunEvent } from '@evidata/agent';
import type { InvestigationService } from '@evidata/investigation';
import type { ProviderUsage } from '@evidata/provider-openai';

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

/**
 * M0 maps a question to one of the canned Sample scenarios (FixtureProvider).
 * Routing is English-only (the M0 fixtures are English); a non-English typed
 * question falls through to the default scenario. Real, language-aware routing
 * arrives with the real AgentProvider.
 */
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

/** Read cumulative cost off a provider that reports it (the real one), else null. */
function readUsage(provider: AgentProvider): ProviderUsage | null {
  const usage = (provider as Partial<{ usage: ProviderUsage }>).usage;
  return usage && usage.calls > 0 ? usage : null;
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
  signal?: AbortSignal,
): Promise<void> {
  try {
    const provider = deps.providerFor(body.question);
    const { answer } = await deps.service.ask(
      { dataSourceId: body.dataSourceId, question: body.question, language: body.language },
      {
        provider,
        sink: (event: AgentRunEvent) => write(sseEvent(event.type, event)),
        ...(signal ? { signal } : {}),
      },
    );
    write(sseEvent('answer', answer));
    // Cost transparency: when the real model ran, report tokens + round-trips +
    // queries so the UI can show what the turn cost (fixtures report nothing).
    const usage = readUsage(provider);
    if (usage) write(sseEvent('usage', { ...usage, queries: answer.evidence.length }));
    write(sseEvent('done', {}));
  } catch (e) {
    // A cancelled turn (client Stop / disconnect) is not an error — emit `aborted`
    // (best-effort; the client may already be gone) and persist nothing.
    if (e instanceof Error && e.name === 'AbortError') {
      write(sseEvent('aborted', {}));
      return;
    }
    write(sseEvent('error', { message: 'The investigation could not be completed.' }));
  }
}
