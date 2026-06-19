/**
 * Shared guard for the model-provider routes (epic #106): require a session,
 * resolve the service, map errors to status codes. Mirrors connection-routes.
 */
import type { AuthedUser } from '@evidata/auth';
import { currentUser } from '@/lib/auth';
import { getRuntime } from '@/lib/runtime';
import {
  ModelProviderAccessError,
  ModelProviderService,
  VaultUnavailableError,
} from '@/lib/model-provider-service';

/** Thrown by a handler for invalid request bodies → 400. */
export class BadRequestError extends Error {}

export async function withModelProviders(
  req: Request,
  fn: (user: AuthedUser, providers: ModelProviderService) => Promise<unknown>,
  successStatus = 200,
): Promise<Response> {
  const user = await currentUser(req);
  if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
  const { modelProviders } = await getRuntime();
  try {
    return Response.json(await fn(user, modelProviders), { status: successStatus });
  } catch (e) {
    if (e instanceof ModelProviderAccessError)
      return Response.json({ error: 'Not found.' }, { status: 404 });
    if (e instanceof BadRequestError) return Response.json({ error: e.message }, { status: 400 });
    if (e instanceof VaultUnavailableError)
      return Response.json({ error: e.message }, { status: 503 });
    throw e;
  }
}
