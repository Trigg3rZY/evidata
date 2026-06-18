import { askSseResponse } from '@/lib/ask-route';
import { parseAskBody } from '@/lib/ask-stream';
import { getRuntime } from '@/lib/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Start a new Investigation; streams reasoning/query/answer over SSE (spec 04 §1.1). */
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
  return askSseResponse(parsed, req.signal);
}

/** History rail. */
export async function GET(): Promise<Response> {
  const rt = await getRuntime();
  return Response.json(await rt.service.list());
}
