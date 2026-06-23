/**
 * Shared guard for the correction-loop suggestion routes (M2-B4, #123): require a
 * session, resolve the SuggestionService, and map its errors to status codes. The
 * per-capability authz (`query` to submit, `author` to review) lives in the service;
 * a caller without it gets 404 (AuthoringAccessError — no existence leak).
 */
import type { AuthedUser } from '@evidata/auth';
import { currentUser } from '@/lib/auth';
import { getRuntime } from '@/lib/runtime';
import { AuthoringAccessError } from './authoring-service';
import { VerificationValidationError } from './verification-service';
import {
  SuggestionService,
  SuggestionStateError,
  SuggestionValidationError,
} from './suggestion-service';

export async function withSuggestions(
  req: Request,
  fn: (user: AuthedUser, suggestions: SuggestionService) => Promise<unknown>,
  successStatus = 200,
): Promise<Response> {
  const user = await currentUser(req);
  if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
  const { suggestions } = await getRuntime();
  try {
    return Response.json(await fn(user, suggestions), { status: successStatus });
  } catch (e) {
    if (e instanceof AuthoringAccessError)
      return Response.json({ error: 'Not found.' }, { status: 404 });
    if (e instanceof SuggestionStateError)
      return Response.json({ error: 'already_reviewed' }, { status: 409 });
    if (e instanceof SuggestionValidationError || e instanceof VerificationValidationError)
      return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
