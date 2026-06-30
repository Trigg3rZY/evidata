import { askSseResponse } from '@/lib/ask-route';
import { parseAskBody } from '@/lib/ask-stream';
import { currentUser } from '@/lib/auth';
import { getRuntime } from '@/lib/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Full thread incl. all Answer versions (spec 04 §1). */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const rt = await getRuntime();
  const user = await currentUser(req);
  // IDOR fix (#177): getThread returns null unless the thread is owned by this user
  // (or, anonymous, ownerId-null) — so a 404 never leaks another user's thread.
  const thread = await rt.service.getThread(id, user?.id);
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
  const user = await currentUser(req);
  return askSseResponse(
    { ...parsed, investigationId: id, ...(user ? { userId: user.id } : {}) },
    req.signal,
  );
}
