import { currentUser, sessionCookie } from '@/lib/auth';
import { getRuntime } from '@/lib/runtime';
import { inviteErrorResponse } from '@/lib/invite-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RedeemBody {
  token?: unknown;
  signup?: { username?: unknown; displayName?: unknown; password?: unknown };
}

/** Redeem an invite token (M2-B1b): grant the role to the signed-in user, or sign up a
 *  new account (and set the session cookie). Anonymous redeem requires signup fields. */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as RedeemBody | null;
  const token = typeof body?.token === 'string' ? body.token : '';
  if (!token) return Response.json({ error: 'A token is required.' }, { status: 400 });

  const { invites } = await getRuntime();
  const user = await currentUser(req);
  const s = body?.signup;
  const signup =
    typeof s?.username === 'string' && typeof s?.displayName === 'string' && typeof s?.password === 'string'
      ? { username: s.username.trim(), displayName: s.displayName.trim(), password: s.password }
      : undefined;

  try {
    const result = await invites.redeem(token, {
      ...(user ? { currentUserId: user.id } : {}),
      ...(signup ? { signup } : {}),
    });
    const payload = { dataSourceId: result.dataSourceId, role: result.role };
    // A signup-on-redeem returns a fresh session → set the cookie so they're logged in.
    return result.sessionToken
      ? Response.json(payload, { headers: { 'set-cookie': sessionCookie(result.sessionToken) } })
      : Response.json(payload);
  } catch (e) {
    const mapped = inviteErrorResponse(e);
    if (mapped) return mapped;
    throw e;
  }
}
