import { askStream, type AskBody } from './ask-stream';
import { VaultUnavailableError } from './model-provider-service';
import { getRuntime, makeProvider, providerFromConfig } from './runtime';

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
  let providerFor = makeProvider;
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
      await askStream({ service: rt.service, providerFor }, body, write, signal);
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
