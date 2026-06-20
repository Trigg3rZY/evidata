/**
 * Shared guards for the Data Source member/invite routes (M2-B1b): require a session,
 * resolve the InviteService, and map its errors to status codes. Member-management
 * authz (the `manage_members` capability) lives in the service; a non-manager gets 404.
 */
import type { AuthedUser } from '@evidata/auth';
import { currentUser } from '@/lib/auth';
import { getRuntime } from '@/lib/runtime';
import { AuthoringAccessError, InviteError, type InviteService } from './invite-service';

const INVITE_ERROR_STATUS: Record<string, number> = {
  not_found: 404,
  expired: 410,
  redeemed: 409,
  username_taken: 409,
  signup_required: 400,
  forbidden_owner_grant: 403,
  last_owner: 409,
};

/** Map a thrown service error to a Response, or rethrow if not ours. */
export function inviteErrorResponse(e: unknown): Response | null {
  if (e instanceof AuthoringAccessError)
    return Response.json({ error: 'Not found.' }, { status: 404 });
  if (e instanceof InviteError) {
    return Response.json({ error: e.code }, { status: INVITE_ERROR_STATUS[e.code] ?? 400 });
  }
  return null;
}

/** Session-gated member/invite handler (manage_members is enforced in the service). */
export async function withMembers(
  req: Request,
  fn: (user: AuthedUser, invites: InviteService) => Promise<unknown>,
  successStatus = 200,
): Promise<Response> {
  const user = await currentUser(req);
  if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
  const { invites } = await getRuntime();
  try {
    return Response.json(await fn(user, invites), { status: successStatus });
  } catch (e) {
    const mapped = inviteErrorResponse(e);
    if (mapped) return mapped;
    throw e;
  }
}
