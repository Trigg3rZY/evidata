import { sessionCookie } from '@/lib/auth';
import { getRuntime } from '@/lib/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** First-run status — drives the setup screen vs login (spec 08 §5). */
export async function GET(): Promise<Response> {
  const { auth } = await getRuntime();
  return Response.json({ setupComplete: await auth.isSetupComplete() });
}

interface SetupBody {
  email?: unknown;
  password?: unknown;
  displayName?: unknown;
}

/** Bootstrap the initial Owner — accepted only while no user exists (410 after). */
export async function POST(req: Request): Promise<Response> {
  const { auth } = await getRuntime();
  if (await auth.isSetupComplete()) {
    return Response.json({ error: 'Setup is already complete.' }, { status: 410 });
  }
  const body = (await req.json().catch(() => null)) as SetupBody | null;
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';
  if (!email.includes('@') || password.length < 8 || !displayName) {
    return Response.json(
      { error: 'A valid email, a display name, and an 8+ character password are required.' },
      { status: 400 },
    );
  }
  const { user, token } = await auth.setup({ email, password, displayName });
  return Response.json({ user }, { headers: { 'set-cookie': sessionCookie(token) } });
}
