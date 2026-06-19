import { withConnections } from '@/lib/connection-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Read one Connection (summary, no credentials). */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return withConnections(req, (user, connections) => connections.get(user.id, id));
}

/** Remove a Connection — returns the Data Sources it affected (spec 08 §6). */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return withConnections(req, (user, connections) => connections.remove(user.id, id));
}
