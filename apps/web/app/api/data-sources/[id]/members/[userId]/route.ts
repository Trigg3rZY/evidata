import { withMembers } from '@/lib/invite-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Remove a member (manage_members; can't remove the last owner / an owner unless owner). */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
): Promise<Response> {
  const { id, userId } = await params;
  return withMembers(req, async (user, invites) => {
    await invites.removeMember(user.id, id, userId);
    return { ok: true };
  });
}
