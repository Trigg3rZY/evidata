import { currentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The signed-in user, or 401 — used by the admin UI to gate + show logout. */
export async function GET(req: Request): Promise<Response> {
  const user = await currentUser(req);
  if (!user) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
  return Response.json({ user });
}
