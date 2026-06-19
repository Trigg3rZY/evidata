import { withConnections } from '@/lib/connection-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Capture + store a fresh SchemaSnapshot for the Connection (spec 08 §4/§6). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return withConnections(req, (user, connections) => connections.introspect(user.id, id));
}
