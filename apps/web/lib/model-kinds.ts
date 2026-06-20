/**
 * Model-provider kinds + capability facts shared by the create API, the admin UI,
 * and provider resolution (epic #106) — one source of truth so the allowlist and
 * the effort gate never drift. No node deps, so the client admin page can import it.
 */

/** Provider families the API accepts and the admin UI offers. */
export const MODEL_KINDS = [
  'deepseek',
  'openai',
  'google',
  'openai-compatible',
  'anthropic',
] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];

export function isModelKind(value: string): value is ModelKind {
  return (MODEL_KINDS as readonly string[]).includes(value);
}

/** Reasoning-effort values we accept (the OpenAI `reasoning_effort` scale). */
export const EFFORT_LEVELS = ['low', 'medium', 'high'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export function isEffortLevel(value: string): value is EffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(value);
}

/**
 * Kinds that expose an OpenAI-compatible reasoning-effort knob today. Only OpenAI's
 * reasoning models (o-series / gpt-5) accept `reasoning_effort`; deepseek-chat and
 * deepseek-reasoner take no effort param, and native Anthropic/Google effort isn't
 * exposed through our openai-compatible transport — so per decision B, effort is
 * gated to these kinds at registration. A self-hosted reasoner that speaks the
 * OpenAI reasoning API registers as `openai` with a custom Base URL. Revisit
 * per-vendor as models change.
 */
const EFFORT_CAPABLE_KINDS: ReadonlySet<string> = new Set(['openai']);

export function kindSupportsEffort(kind: string): boolean {
  return EFFORT_CAPABLE_KINDS.has(kind);
}
