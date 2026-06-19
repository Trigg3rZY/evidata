/**
 * Shared guard for the connection-management routes (spec 08 §6): require a
 * session, resolve the ConnectionService, and map service errors to status codes.
 * Connection management is the only surface gated in M1 — the Sample Ask flow
 * stays open (the agreed demo-friendly scope).
 */
import { ConnectionAccessError, VaultUnavailableError } from '@evidata/connection';
import type { AuthedUser } from '@evidata/auth';
import type { ConnectionService } from '@evidata/connection';
import { currentUser } from '@/lib/auth';
import { getRuntime } from '@/lib/runtime';

/** Thrown by a handler for invalid input → 400. */
export class BadRequestError extends Error {}

export async function withConnections(
  req: Request,
  fn: (user: AuthedUser, connections: ConnectionService) => Promise<unknown>,
  successStatus = 200,
): Promise<Response> {
  const user = await currentUser(req);
  if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
  const { connections } = await getRuntime();
  try {
    return Response.json(await fn(user, connections), { status: successStatus });
  } catch (e) {
    // Non-members can't tell a connection exists — treat as not-found.
    if (e instanceof ConnectionAccessError)
      return Response.json({ error: 'Not found.' }, { status: 404 });
    if (e instanceof BadRequestError) return Response.json({ error: e.message }, { status: 400 });
    if (e instanceof VaultUnavailableError)
      return Response.json({ error: e.message }, { status: 503 });
    throw e;
  }
}
