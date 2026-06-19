import { BadRequestError, withAuthoring } from '@/lib/authoring-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Transition the lifecycle: { lifecycle: 'published' } publishes (readiness-gated),
 *  { lifecycle: 'draft' } pulls it back. Owner-only. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  let raw: unknown = null;
  try {
    raw = await req.json();
  } catch {
    raw = null;
  }
  return withAuthoring(req, async (user, authoring) => {
    const lifecycle = (raw as { lifecycle?: unknown } | null)?.lifecycle;
    if (lifecycle === 'published') {
      await authoring.publish(user.id, id);
    } else if (lifecycle === 'draft') {
      await authoring.unpublish(user.id, id);
    } else {
      throw new BadRequestError('lifecycle must be "published" or "draft".');
    }
    return { lifecycle };
  });
}
