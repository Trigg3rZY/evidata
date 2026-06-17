import { fixtureFor } from '@evidata/agent';
import { askStream, parseAskBody, pickScenario } from '@/lib/ask-stream';
import { getRuntime } from '@/lib/runtime';

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
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string): void => controller.enqueue(encoder.encode(chunk));
      // M0 replays a canned scenario via the FixtureProvider; a real provider slots in later.
      await askStream(
        { service: rt.service, providerFor: (q) => fixtureFor(pickScenario(q)) },
        parsed,
        write,
      );
      controller.close();
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
