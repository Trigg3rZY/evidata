import { clearedCookie, readSessionToken } from '@/lib/auth';
import { getRuntime } from '@/lib/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Revoke the current session server-side and clear the cookie (spec 08 §5). */
export async function POST(req: Request): Promise<Response> {
  const token = readSessionToken(req);
  if (token) {
    const { auth } = await getRuntime();
    await auth.logout(token);
  }
  return Response.json({ ok: true }, { headers: { 'set-cookie': clearedCookie() } });
}
