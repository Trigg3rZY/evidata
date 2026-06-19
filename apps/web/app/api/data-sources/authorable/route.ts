import { withAuthoring } from '@/lib/authoring-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Sources the signed-in user may author (incl. drafts) — for the Data Sources view
 *  rail, so an owner can open a draft and publish it. Empty/401 when signed out. */
export async function GET(req: Request): Promise<Response> {
  return withAuthoring(req, (user, authoring) => authoring.listAuthorable(user.id));
}
