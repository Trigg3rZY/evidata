import { askSseResponse } from '@/lib/ask-route';
import { parseAskBody } from '@/lib/ask-stream';
import { currentUser } from '@/lib/auth';
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
  // Inject the authenticated user (never trust a client-supplied id): authorizes a
  // real published source; the open Sample needs none.
  const user = await currentUser(req);
  return askSseResponse({ ...parsed, ...(user ? { userId: user.id } : {}) }, req.signal);
}

/** History rail. */
export async function GET(): Promise<Response> {
  const rt = await getRuntime();
  return Response.json(await rt.service.list());
}
