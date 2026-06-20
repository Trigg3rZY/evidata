import { withMembers } from '@/lib/invite-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROLES = new Set(['owner', 'admin', 'querier']);

interface CreateBody {
  role?: unknown;
  ttlDays?: unknown;
}

/** List pending invites for a Data Source (manage_members). */
export function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withMembers(req, async (user, invites) => invites.listPending(user.id, (await params).id));
}

/** Mint a single-use invite link for a role (manage_members; owner-grant = owner only). */
export function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withMembers(
    req,
    async (user, invites) => {
      const { id } = await params;
      const body = (await req.json().catch(() => null)) as CreateBody | null;
      const role = typeof body?.role === 'string' && ROLES.has(body.role) ? body.role : null;
      if (!role) return Promise.reject(new Error('invalid role'));
      const ttlDays =
        typeof body?.ttlDays === 'number' && body.ttlDays > 0 ? body.ttlDays : undefined;
      return invites.create(user.id, id, role as 'owner' | 'admin' | 'querier', ttlDays);
    },
    201,
  );
}
