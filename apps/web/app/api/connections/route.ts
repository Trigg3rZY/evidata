import { parseConnectionInput, withConnections } from '@/lib/connection-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** List the caller's Connections (summaries — never credentials). */
export function GET(req: Request): Promise<Response> {
  return withConnections(req, (user, connections) => connections.list(user.id));
}

/** Create a Connection — credentials are encrypted at rest (spec 08 §3/§6). */
export function POST(req: Request): Promise<Response> {
  return withConnections(
    req,
    async (user, connections) => {
      const body: unknown = await req.json().catch(() => null);
      return connections.create(user.id, parseConnectionInput(body));
    },
    201,
  );
}
