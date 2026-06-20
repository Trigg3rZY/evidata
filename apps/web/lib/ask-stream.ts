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
  /** Set for a follow-up turn (continue this Investigation, append a version). */
  investigationId?: string;
  /** Regenerate the latest answer in place: a new version with no new user turn. */
  rerun?: boolean;
  /** Authenticated user id — server-injected from the session, NEVER parsed from
   *  the client body. Authorizes access to a real published source. */
  userId?: string;
  /** Selected registered model provider (epic #106); resolved against the user's
   *  own providers. Omit to use the env/fixture provider. Client-supplied. */
  modelProviderId?: string;
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
  // A SPEND trend WITH a time grain ("by month", "monthly", "over time") carries an
  // implicit window, so it answers with an inline chart — it must be matched before
  // the bare `trend` rule (which, lacking a window, routes to a clarification). Scoped
  // to spend only: the fixture is campaign_spend, so a revenue question must NOT match
  // it (it would otherwise stream a spend answer for a revenue ask — Codex P2).
  [
    /\bspend\b.*\b(by month|monthly|month over month|over time|each month|per month)\b|\b(monthly|month over month)\b.*\b(spend|trend)\b/i,
    'spend-trend',
  ],
  [/trend|trending/i, 'needs-timerange'],
  // Require the contact/email AND an account/customer subject, so "email me the
  // report" doesn't route into the contact_email fixture.
  [
    /\b(contact|email)s?\b.*\b(account|customer|client)s?\b|\b(account|customer|client)s?\b.*\b(contact|email)s?\b/i,
    'sensitive-redaction',
  ],
  // "top customers", "customers by spend", "biggest spenders" — not a bare "highest"
  // (which matches "why was ACME spend highest in June?").
  [
    /\btop\s+(customer|account|spender)s?\b|\b(customer|account)s?\s+by\s+spend\b|\b(biggest|highest|top)\s+spenders?\b/i,
    'top-customers',
  ],
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
  const modelProviderId =
    typeof body.modelProviderId === 'string' && body.modelProviderId
      ? body.modelProviderId
      : undefined;
  return {
    dataSourceId,
    question,
    language,
    ...(body.rerun === true ? { rerun: true } : {}),
    ...(modelProviderId ? { modelProviderId } : {}),
  };
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
    const result = await deps.service.ask(
      {
        dataSourceId: body.dataSourceId,
        question: body.question,
        language: body.language,
        ...(body.investigationId ? { investigationId: body.investigationId } : {}),
        ...(body.rerun ? { rerun: true } : {}),
        ...(body.userId ? { userId: body.userId } : {}),
        // Recorded on a NEW Investigation so follow-ups reuse this model (#113); the
        // service ignores it for a follow-up (that one is already bound).
        ...(body.modelProviderId ? { modelProviderId: body.modelProviderId } : {}),
      },
      {
        provider,
        sink: (event: AgentRunEvent) => write(sseEvent(event.type, event)),
        ...(signal ? { signal } : {}),
      },
    );
    // A conversational Message (greeting / drafted SQL / decline) is not an Answer —
    // no status/evidence chrome; the queries count is 0 (spec 13).
    if (result.kind === 'message') {
      write(sseEvent('message', result.message));
    } else {
      write(sseEvent('answer', result.answer));
    }
    // Cost transparency: when the real model ran, report tokens + round-trips +
    // queries so the UI can show what the turn cost (fixtures report nothing).
    const usage = readUsage(provider);
    if (usage) {
      const queries = result.kind === 'answer' ? result.answer.evidence.length : 0;
      write(sseEvent('usage', { ...usage, queries }));
    }
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
