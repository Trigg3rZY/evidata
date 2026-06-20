import { withMembers } from '@/lib/invite-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Revoke a pending invite (manage_members). */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; inviteId: string }> },
): Promise<Response> {
  const { id, inviteId } = await params;
  return withMembers(req, async (user, invites) => {
    await invites.revoke(user.id, id, inviteId);
    return { ok: true };
  });
}
