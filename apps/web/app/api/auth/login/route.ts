import { sessionCookie } from '@/lib/auth';
import { getRuntime } from '@/lib/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface LoginBody {
  username?: unknown;
  password?: unknown;
}

/** Local account login (spec 08 §5). Failures are generic — no account enumeration. */
export async function POST(req: Request): Promise<Response> {
  const { auth } = await getRuntime();
  const body = (await req.json().catch(() => null)) as LoginBody | null;
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  const result = username && password ? await auth.login({ username, password }) : null;
  if (!result) {
    return Response.json({ error: 'Invalid username or password.' }, { status: 401 });
  }
  return Response.json(
    { user: result.user },
    { headers: { 'set-cookie': sessionCookie(result.token) } },
  );
}
