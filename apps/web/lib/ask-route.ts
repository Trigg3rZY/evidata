import { askStream, type AskBody } from './ask-stream';
import { getRuntime, makeProvider, providerFromConfig } from './runtime';

/**
 * Shared SSE response for the Ask Data endpoints (new investigation + follow-up).
 * Streams reasoning/query/answer|message/usage/done; `signal` (the request's
 * AbortSignal) cancels the in-flight run on client disconnect / Stop (spec 13 §4).
 */
export async function askSseResponse(body: AskBody, signal: AbortSignal): Promise<Response> {
  const rt = await getRuntime();
  // If the request selected one of the caller's registered models, run against it
  // (decrypted key + endpoint); otherwise fall back to the env/fixture provider.
  const cfg =
    body.userId && body.modelProviderId
      ? await rt.modelProviders.resolveConfig(body.userId, body.modelProviderId)
      : null;
  const providerFor = cfg ? () => providerFromConfig(cfg) : makeProvider;
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
