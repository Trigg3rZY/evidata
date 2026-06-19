/**
 * Shared guard for the Data Source authoring routes (M2-S3, spec 09 §5/§7):
 * require a session, resolve the authoring service, and map its errors to status
 * codes. Owner-gating lives in the service (membership on the backing connection);
 * a non-owner gets 404 (no existence leak).
 */
import type { AuthedUser } from '@evidata/auth';
import { currentUser } from '@/lib/auth';
import { getRuntime } from '@/lib/runtime';
import {
  AuthoringAccessError,
  AuthoringValidationError,
  PublishReadinessError,
  type AuthoringDraft,
  type DataSourceAuthoringService,
} from './authoring-service';

/** Thrown by a handler for invalid request bodies → 400. */
export class BadRequestError extends Error {}

export async function withAuthoring(
  req: Request,
  fn: (user: AuthedUser, authoring: DataSourceAuthoringService) => Promise<unknown>,
  successStatus = 200,
): Promise<Response> {
  const user = await currentUser(req);
  if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
  const { authoring } = await getRuntime();
  try {
    return Response.json(await fn(user, authoring), { status: successStatus });
  } catch (e) {
    if (e instanceof AuthoringAccessError)
      return Response.json({ error: 'Not found.' }, { status: 404 });
    if (e instanceof PublishReadinessError)
      return Response.json({ error: e.message, missing: e.missing }, { status: 409 });
    if (e instanceof AuthoringValidationError || e instanceof BadRequestError)
      return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

function asPosInt(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : fallback;
}

/** Validate + normalize an authoring draft request body (throws BadRequestError). */
export function parseAuthoringDraft(raw: unknown): AuthoringDraft {
  if (typeof raw !== 'object' || raw === null) {
    throw new BadRequestError('Body must be a JSON object.');
  }
  const b = raw as Record<string, unknown>;
  const p = (typeof b.policy === 'object' && b.policy !== null ? b.policy : {}) as Record<
    string,
    unknown
  >;
  const stmt = p.statementTimeoutMs;
  return {
    includedTables: asStringArray(b.includedTables),
    sensitiveColumns: asStringArray(b.sensitiveColumns),
    overview: typeof b.overview === 'string' ? b.overview : '',
    policy: {
      rowLimit: asPosInt(p.rowLimit, 1000),
      timeoutMs: asPosInt(p.timeoutMs, 30_000),
      statementTimeoutMs: stmt == null ? null : asPosInt(stmt, 30_000),
      // Strict by default: only an explicit `false` turns a confirmation off.
      confirmOnBroadScan: p.confirmOnBroadScan !== false,
      confirmOnSensitiveAccess: p.confirmOnSensitiveAccess !== false,
    },
  };
}
