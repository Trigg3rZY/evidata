import { currentUser } from '@/lib/auth';
import { getRuntime } from '@/lib/runtime';
import { AuthoringAccessError } from '@/lib/authoring-service';
import { VerificationValidationError } from '@/lib/verification-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** List the Data Source's glossary terms + entity mappings (every status; author-capable). */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return run(req, (userId, rt) => rt.verification.list(userId, id));
}

interface ActionBody {
  action?: unknown;
  kind?: unknown;
  itemId?: unknown;
  definition?: unknown;
}

/** Promote (→Verified), reject (delete), or edit a glossary definition (M2-B3). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as ActionBody | null;
  const action = body?.action;
  const kind = body?.kind === 'mapping' ? 'mapping' : 'glossary';
  const itemId = typeof body?.itemId === 'string' ? body.itemId : '';

  return run(req, async (userId, rt) => {
    if (!itemId) throw new VerificationValidationError('itemId is required.');
    if (action === 'promote') {
      await rt.verification.promote(userId, id, kind, itemId);
    } else if (action === 'reject') {
      await rt.verification.reject(userId, id, kind, itemId);
    } else if (action === 'edit') {
      const definition = typeof body?.definition === 'string' ? body.definition : '';
      await rt.verification.editGlossary(userId, id, itemId, definition);
    } else {
      throw new VerificationValidationError('action must be promote, reject, or edit.');
    }
    return { ok: true };
  });
}

async function run(
  req: Request,
  fn: (userId: string, rt: Awaited<ReturnType<typeof getRuntime>>) => Promise<unknown>,
): Promise<Response> {
  const user = await currentUser(req);
  if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
  const rt = await getRuntime();
  try {
    return Response.json(await fn(user.id, rt));
  } catch (e) {
    if (e instanceof AuthoringAccessError)
      return Response.json({ error: 'Not found.' }, { status: 404 });
    if (e instanceof VerificationValidationError)
      return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
