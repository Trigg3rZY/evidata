import type { ModelCapabilities, ModelParams } from '@evidata/ports';
import { BadRequestError, withModelProviders } from '@/lib/model-provider-routes';
import { EFFORT_LEVELS, MODEL_KINDS, isEffortLevel, kindSupportsEffort } from '@/lib/model-kinds';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS = new Set<string>(MODEL_KINDS);
const TOOL_CHOICE = new Set(['required', 'auto', 'none']);

interface CreateBody {
  name?: unknown;
  kind?: unknown;
  baseUrl?: unknown;
  model?: unknown;
  apiKey?: unknown;
  params?: unknown;
  capabilities?: unknown;
}

/** List the shared model pool (summaries — never the API key). */
export function GET(req: Request): Promise<Response> {
  return withModelProviders(req, (_user, providers) => providers.list());
}

/** Register a model provider — the API key is encrypted at rest (epic #106). */
export function POST(req: Request): Promise<Response> {
  return withModelProviders(
    req,
    async (user, providers) => {
      const body = (await req.json().catch(() => null)) as CreateBody | null;
      const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
      const name = str(body?.name);
      const kind = str(body?.kind);
      const model = str(body?.model);
      const baseUrl = str(body?.baseUrl) || null;
      const apiKey = typeof body?.apiKey === 'string' ? body.apiKey : '';

      if (!name || !model || !apiKey) {
        throw new BadRequestError('name, model, and apiKey are required.');
      }
      if (!KINDS.has(kind)) {
        throw new BadRequestError(`kind must be one of: ${[...KINDS].join(', ')}.`);
      }
      const params = parseParams(body?.params);
      // Effort is gated by kind (decision B): a model whose kind exposes no
      // reasoning-effort knob must not carry one, and the value must be valid.
      if (params.effort !== undefined) {
        if (!kindSupportsEffort(kind)) {
          throw new BadRequestError(`The "${kind}" model kind does not support an effort setting.`);
        }
        if (!isEffortLevel(params.effort)) {
          throw new BadRequestError(`effort must be one of: ${EFFORT_LEVELS.join(', ')}.`);
        }
      }
      return providers.create(user.id, {
        name,
        kind,
        baseUrl,
        model,
        apiKey,
        params,
        capabilities: parseCapabilities(body?.capabilities),
      });
    },
    201,
  );
}

function parseParams(raw: unknown): ModelParams {
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const out: ModelParams = {};
  if (typeof p.temperature === 'number') out.temperature = p.temperature;
  if (typeof p.effort === 'string' && p.effort.trim()) out.effort = p.effort.trim();
  if (typeof p.maxTokens === 'number' && Number.isInteger(p.maxTokens)) out.maxTokens = p.maxTokens;
  return out;
}

function parseCapabilities(raw: unknown): ModelCapabilities {
  const c = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const out: ModelCapabilities = {};
  if (typeof c.toolChoice === 'string' && TOOL_CHOICE.has(c.toolChoice)) {
    out.toolChoice = c.toolChoice as 'required' | 'auto' | 'none';
  }
  if (typeof c.structuredOutput === 'boolean') out.structuredOutput = c.structuredOutput;
  return out;
}
