import { getRuntime } from '@/lib/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Overview of one Data Source for the Data Sources view (spec 04 §1):
 *  schema + safety posture only — never credentials/internals. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const rt = await getRuntime();
  const overview = rt.service.getDataSourceOverview(id);
  if (!overview) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json(overview);
}
