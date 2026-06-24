import { withSuggestions } from '@/lib/suggestion-routes';
import { SuggestionValidationError } from '@/lib/suggestion-service';
import { rerunForCorrection } from '@/lib/correction-rerun';
import { getRuntime } from '@/lib/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ReviewBody {
  action?: unknown;
  targetKind?: unknown;
  targetItemId?: unknown;
  definition?: unknown;
}

/** Review one correction (M2-B4): accept (→ promote the chosen Suggested item to
 *  Verified) or reject. Gated on `author`. The auto-rerun is B4 ②. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; sid: string }> },
): Promise<Response> {
  const { id, sid } = await params;
  return withSuggestions(req, async (user, suggestions) => {
    const body = (await req.json().catch(() => null)) as ReviewBody | null;
    if (body?.action === 'reject') {
      await suggestions.reject(user.id, id, sid);
      return { ok: true };
    }
    if (body?.action === 'accept') {
      const targetKind = body.targetKind === 'glossary' ? 'glossary' : 'mapping';
      const targetItemId = typeof body.targetItemId === 'string' ? body.targetItemId : '';
      if (!targetItemId) throw new SuggestionValidationError('A target item is required.');
      const definition = typeof body.definition === 'string' ? body.definition : null;
      const { investigationId, answerVersion } = await suggestions.accept(user.id, id, sid, {
        targetKind,
        targetItemId,
        definition,
      });
      // B4 ②: re-answer the affected investigation with the now-Verified knowledge (head-
      // guarded + best-effort; the accept already stands regardless).
      const rt = await getRuntime();
      const reran = await rerunForCorrection(rt, investigationId, answerVersion, user.id);
      return { ok: true, investigationId, reran };
    }
    throw new SuggestionValidationError('Unknown action.');
  });
}
