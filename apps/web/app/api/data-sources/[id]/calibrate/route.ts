import { currentUser } from '@/lib/auth';
import { getRuntime } from '@/lib/runtime';
import { AuthoringAccessError } from '@/lib/authoring-service';
import { CalibrationError } from '@/lib/calibration-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Draft Suggested context/glossary/mappings for a Data Source with the configured
 *  model (M2-B2, #120). Owner-gated; nothing drafted is Verified or reaches the Ask
 *  model until promoted. 404 for a non-owner; 409 when there's no schema yet. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const user = await currentUser(req);
  if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
  const { calibration } = await getRuntime();
  try {
    return Response.json(await calibration.calibrate(user.id, id));
  } catch (e) {
    if (e instanceof AuthoringAccessError)
      return Response.json({ error: 'Not found.' }, { status: 404 });
    if (e instanceof CalibrationError) return Response.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
