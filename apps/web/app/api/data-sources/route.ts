import { currentUser } from '@/lib/auth';
import { getRuntime } from '@/lib/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Data sources for the in-composer selector (id + name only; no internals). The
 *  open Sample is always listed; real published sources only for a member. */
export async function GET(req: Request): Promise<Response> {
  const rt = await getRuntime();
  const user = await currentUser(req);
  return Response.json(await rt.service.listDataSources(user?.id));
}
