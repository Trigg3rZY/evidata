import { withMembers } from '@/lib/invite-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** List a Data Source's members + roles (manage_members). */
export function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withMembers(req, async (user, invites) => invites.listMembers(user.id, (await params).id));
}
