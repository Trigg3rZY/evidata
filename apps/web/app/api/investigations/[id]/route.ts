import { askSseResponse } from '@/lib/ask-route';
import { parseAskBody } from '@/lib/ask-stream';
import { getRuntime } from '@/lib/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Full thread incl. all Answer versions (spec 04 §1). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const rt = await getRuntime();
  const thread = await rt.service.getThread(id);
  if (!thread) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json(thread);
}

/** Follow-up turn on this Investigation: appends a new Answer version, with the
 *  prior turns as model context. Streams over SSE like the new-investigation POST. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
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
  return askSseResponse({ ...parsed, investigationId: id }, req.signal);
}
