import { askStream, parseAskBody } from '@/lib/ask-stream';
import { getRuntime, makeProvider } from '@/lib/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Start an Investigation; streams reasoning/query/answer over SSE (spec 04 §1.1). */
export async function POST(req: Request): Promise<Response> {
  let raw: unknown = null;
  try {
    raw = await req.json();
  } catch {
    raw = null;
  }
  const parsed = parseAskBody(raw);
  if ('error' in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  const rt = await getRuntime();
  const encoder = new TextEncoder();
  // Disconnect-safe: once the client goes away, `cancel()` flips `closed` and
  // writes become no-ops, so a late enqueue can't throw out of `start`.
  // (Cancelling the in-flight runner needs an AbortSignal through @evidata/agent
  // — tracked as a follow-up; in M0 the work is cheap and bounded.)
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
      // Real provider when configured (AGENT_PROVIDER=openai), else the FixtureProvider.
      // `req.signal` fires on client disconnect / Stop, cancelling the in-flight run
      // so the server stops spending (spec 13 §4).
      await askStream(
        { service: rt.service, providerFor: makeProvider },
        parsed,
        write,
        req.signal,
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

/** History rail. */
export async function GET(): Promise<Response> {
  const rt = await getRuntime();
  return Response.json(await rt.service.list());
}
