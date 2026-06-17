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
