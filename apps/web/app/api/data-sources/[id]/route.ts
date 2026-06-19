import { currentUser } from '@/lib/auth';
import { getRuntime } from '@/lib/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Overview of one Data Source for the Data Sources view (spec 04 §1):
 *  schema + safety posture only — never credentials/internals. A real source is
 *  visible only to a member (404 otherwise — no existence leak). */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const rt = await getRuntime();
  const user = await currentUser(req);
  const overview = await rt.service.getDataSourceOverview(id, user?.id);
  if (!overview) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json(overview);
}
