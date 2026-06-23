import { withSuggestions } from '@/lib/suggestion-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SubmitBody {
  kind?: unknown;
  targetRef?: unknown;
  description?: unknown;
  proposedDefinition?: unknown;
}

/** Submit a correction from a blocked answer's Unblock Path (M2-B4). Gated on `query`
 *  (a member of the investigation's Data Source) in the service. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return withSuggestions(
    req,
    async (user, suggestions) => {
      const body = (await req.json().catch(() => null)) as SubmitBody | null;
      const str = (v: unknown): string => (typeof v === 'string' ? v : '');
      return suggestions.submit(user.id, id, {
        kind: str(body?.kind),
        targetRef: str(body?.targetRef) || null,
        description: str(body?.description),
        proposedDefinition: str(body?.proposedDefinition) || null,
      });
    },
    201,
  );
}
