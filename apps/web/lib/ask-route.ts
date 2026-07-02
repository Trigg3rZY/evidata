import { fixtureFor, type AgentProvider } from '@evidata/agent';
import { SAMPLE_DATA_SOURCE_ID } from '@evidata/connector-sample';
import type { ModelSnapshot } from '@evidata/ports';
import { askStream, pickScenario, type AskBody } from './ask-stream';
import { VaultUnavailableError } from './model-provider-service';
import { getRuntime, providerFromConfig } from './runtime';

export function noRegisteredModelMessage(language: AskBody['language']): string {
  return language === 'zh-CN'
    ? '请先在 Admin > Models 注册一个模型，再对真实 Data Source 提问。'
    : 'Register a model in Admin > Models before asking a real Data Source.';
}

export function unboundInvestigationModelMessage(language: AskBody['language']): string {
  return language === 'zh-CN'
    ? '这个对话没有绑定注册模型。请新建对话并选择一个已注册模型。'
    : 'This conversation is not bound to a registered model. Start a new conversation with a registered model.';
}

export function canUseFixtureProvider(body: Pick<AskBody, 'dataSourceId' | 'userId'>): boolean {
  return body.dataSourceId === SAMPLE_DATA_SOURCE_ID && !body.userId;
}

export function canUseDefaultRegisteredModel(
  body: Pick<AskBody, 'investigationId' | 'userId'>,
): boolean {
  return !body.investigationId && Boolean(body.userId);
}

function fixtureProviderFor(question: string): AgentProvider {
  return fixtureFor(pickScenario(question));
}

/**
 * Shared SSE response for the Ask Data endpoints (new investigation + follow-up).
 * Streams reasoning/query/answer|message/usage/done; `signal` (the request's
 * AbortSignal) cancels the in-flight run on client disconnect / Stop (spec 13 §4).
 */
export async function askSseResponse(body: AskBody, signal: AbortSignal): Promise<Response> {
  const rt = await getRuntime();
  // The model is bound to the Investigation (#113): a follow-up runs on the STORED
  // model (ignore the client's current picker) so a conversation never switches models
  // mid-thread; a new turn uses the client's selection. Either way a selected model
  // must resolve to a real provider — never silently fall back to the env/default model
  // (#111); only the no-selection case uses the fallback. Models are a shared team pool
  // (#151), so any member resolves any selected model (the key stays server-side).
  const modelProviderId = body.investigationId
    ? await rt.service.getInvestigationModelProviderId(body.investigationId)
    : (body.modelProviderId ?? null);
  let effectiveBody = body;
  let providerFor = fixtureProviderFor;
  // Audit snapshot of the effective model recorded on a NEW Investigation (#116).
  let modelSnapshot: ModelSnapshot | null = null;
  if (modelProviderId) {
    let cfg;
    try {
      // A registered model can be selected by ANY authenticated member (shared pool,
      // #151) — but only an authenticated one: an anonymous Sample visitor must not be
      // able to run (and bill) a team key by passing a model id.
      cfg = body.userId ? await rt.modelProviders.resolveConfig(modelProviderId) : null;
    } catch (e) {
      // The vault isn't configured (APP_ENCRYPTION_KEY unset) — surface the same
      // clear 503 the management routes return, not a leaked 500 (operator misconfig).
      if (e instanceof VaultUnavailableError) {
        return Response.json({ error: 'The credential vault is not configured.' }, { status: 503 });
      }
      throw e;
    }
    if (!cfg) {
      return Response.json({ error: 'The selected model is unavailable.' }, { status: 404 });
    }
    providerFor = () => providerFromConfig(cfg);
    modelSnapshot = { source: 'registered', model: cfg.model, baseURL: cfg.baseURL ?? null };
  } else if (canUseDefaultRegisteredModel(body)) {
    let resolved;
    try {
      resolved = await rt.modelProviders.resolveDefaultConfig();
    } catch (e) {
      if (e instanceof VaultUnavailableError) {
        return Response.json({ error: 'The credential vault is not configured.' }, { status: 503 });
      }
      throw e;
    }
    if (!resolved) {
      return Response.json({ error: noRegisteredModelMessage(body.language) }, { status: 409 });
    }
    providerFor = () => providerFromConfig(resolved.config);
    modelSnapshot = {
      source: 'registered',
      model: resolved.config.model,
      baseURL: resolved.config.baseURL ?? null,
    };
    effectiveBody = { ...body, modelProviderId: resolved.id };
  } else if (!canUseFixtureProvider(body)) {
    return Response.json(
      {
        error: body.investigationId
          ? unboundInvestigationModelMessage(body.language)
          : noRegisteredModelMessage(body.language),
      },
      { status: 409 },
    );
  }
  const encoder = new TextEncoder();
  // Disconnect-safe: once the client goes away, `cancel()` flips `closed` and
  // writes become no-ops, so a late enqueue can't throw out of `start`.
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      await askStream(
        { service: rt.service, providerFor, modelSnapshot },
        effectiveBody,
        write,
        signal,
      );
      if (!closed) controller.close();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}
