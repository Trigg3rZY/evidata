/**
 * Session-cookie glue for the auth routes (spec 08 §5). Kept framework-agnostic
 * (parse/serialize the Cookie header rather than next/headers) so the route
 * handlers stay pure Request→Response and unit-testable.
 *
 * The cookie holds the opaque session token; only its hash is stored server-side.
 */
import type { AuthedUser } from '@evidata/auth';
import { getRuntime } from './runtime';

const COOKIE = 'evidata_session';
const MAX_AGE = 30 * 24 * 60 * 60; // 30 days, matches the session TTL

const secure = (): string => (process.env.NODE_ENV === 'production' ? ' Secure;' : '');

/** Read the session token from a request's Cookie header. */
export function readSessionToken(req: Request): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === COOKIE) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        // Client-controlled, malformed percent-encoding → treat as no session.
        return null;
      }
    }
  }
  return null;
}

/** Set-Cookie value that stores the session token (HttpOnly, SameSite=Lax). */
export function sessionCookie(token: string): string {
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax;${secure()} Path=/; Max-Age=${MAX_AGE}`;
}

/** Set-Cookie value that clears the session. */
export function clearedCookie(): string {
  return `${COOKIE}=; HttpOnly; SameSite=Lax;${secure()} Path=/; Max-Age=0`;
}

/** Resolve the current user from the request's session cookie (null if signed out). */
export async function currentUser(req: Request): Promise<AuthedUser | null> {
  const { auth } = await getRuntime();
  return auth.resolve(readSessionToken(req));
}
