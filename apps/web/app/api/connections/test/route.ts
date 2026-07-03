import { parseConnectionInput, withConnections } from '@/lib/connection-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Probe an unsaved Connection draft. Nothing is encrypted or persisted. */
export function POST(req: Request): Promise<Response> {
  return withConnections(req, async (_user, connections) => {
    const body: unknown = await req.json().catch(() => null);
    return connections.testDraft(parseConnectionInput(body));
  });
}
