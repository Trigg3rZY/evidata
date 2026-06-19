import { withConnections } from '@/lib/connection-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Probe connectivity + health, driving the Connection state machine (spec 08 §7). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return withConnections(req, (user, connections) => connections.test(user.id, id));
}
