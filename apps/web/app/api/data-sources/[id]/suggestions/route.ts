import { withSuggestions } from '@/lib/suggestion-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The Data Source's open correction queue (manage via `author`). */
export function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withSuggestions(req, async (user, suggestions) =>
    suggestions.list(user.id, (await params).id),
  );
}
