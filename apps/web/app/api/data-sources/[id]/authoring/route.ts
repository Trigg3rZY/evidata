import { parseAuthoringDraft, withAuthoring } from '@/lib/authoring-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Editable authoring state for the Data Sources detail page (owner-only). */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return withAuthoring(req, (user, authoring) => authoring.getEditable(user.id, id));
}

/** Save the draft: table scope + sensitive columns + overview + policy. */
export async function PUT(
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
    await authoring.save(user.id, id, parseAuthoringDraft(raw));
    return { ok: true };
  });
}
