import { parseConnectionPatch, withConnections } from '@/lib/connection-routes';

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

/** Edit a Connection in place — keeps the bound Data Source wired to the same id. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return withConnections(req, async (user, connections) => {
    const body: unknown = await req.json().catch(() => null);
    return connections.update(user.id, id, parseConnectionPatch(body));
  });
}

/** Remove a Connection — returns the Data Sources it affected (spec 08 §6). */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return withConnections(req, (user, connections) => connections.remove(user.id, id));
}
