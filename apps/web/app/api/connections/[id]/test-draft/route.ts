import { parseConnectionPatch, withConnections } from '@/lib/connection-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Probe edited values without saving them. Blank secret fields keep the stored values. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return withConnections(req, async (user, connections) => {
    const body: unknown = await req.json().catch(() => null);
    return connections.testPatch(user.id, id, parseConnectionPatch(body));
  });
}
