/**
 * Shared guard for the connection-management routes (spec 08 §6): require a
 * session, resolve the ConnectionService, and map service errors to status codes.
 * Connection management is the only surface gated in M1 — the Sample Ask flow
 * stays open (the agreed demo-friendly scope).
 */
import { ConnectionAccessError, VaultUnavailableError } from '@evidata/connection';
import type { AuthedUser } from '@evidata/auth';
import type {
  ConnectionService,
  CreateConnectionInput,
  UpdateConnectionInput,
} from '@evidata/connection';
import { currentUser } from '@/lib/auth';
import { getRuntime } from '@/lib/runtime';

/** Thrown by a handler for invalid input → 400. */
export class BadRequestError extends Error {}

const SSL_MODES = new Set(['disable', 'prefer', 'require', 'verify-ca', 'verify-full']);

export function parseConnectionInput(body: unknown): CreateConnectionInput {
  const b = objectBody(body);
  const input = {
    name: str(b.name),
    host: str(b.host),
    port: port(b.port),
    database: str(b.database),
    sslMode: str(b.sslMode) || 'require',
    user: str(b.user),
    password: typeof b.password === 'string' ? b.password : '',
  };
  if (!input.name || !input.host || !input.database || !input.user || !input.password) {
    throw new BadRequestError('name, host, database, user, and password are required.');
  }
  assertPort(input.port);
  assertSslMode(input.sslMode);
  return input;
}

export function parseConnectionPatch(body: unknown): UpdateConnectionInput {
  const b = objectBody(body);
  const patch: UpdateConnectionInput = {};
  if ('name' in b) patch.name = requiredStr(b.name, 'name');
  if ('host' in b) patch.host = requiredStr(b.host, 'host');
  if ('port' in b) {
    patch.port = port(b.port);
    assertPort(patch.port);
  }
  if ('database' in b) patch.database = requiredStr(b.database, 'database');
  if ('sslMode' in b) {
    patch.sslMode = requiredStr(b.sslMode, 'sslMode');
    assertSslMode(patch.sslMode);
  }
  if ('user' in b) {
    if (typeof b.user !== 'string') throw new BadRequestError('user must be a string.');
    if (b.user.trim()) patch.user = b.user.trim();
  }
  if ('password' in b) {
    if (typeof b.password !== 'string') throw new BadRequestError('password must be a string.');
    if (b.password) patch.password = b.password;
  }
  if (Object.keys(patch).length === 0) {
    throw new BadRequestError('At least one connection field is required.');
  }
  return patch;
}

export async function withConnections(
  req: Request,
  fn: (user: AuthedUser, connections: ConnectionService) => Promise<unknown>,
  successStatus = 200,
): Promise<Response> {
  const user = await currentUser(req);
  if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
  const { connections } = await getRuntime();
  try {
    return Response.json(await fn(user, connections), { status: successStatus });
  } catch (e) {
    // Non-members can't tell a connection exists — treat as not-found.
    if (e instanceof ConnectionAccessError)
      return Response.json({ error: 'Not found.' }, { status: 404 });
    if (e instanceof BadRequestError) return Response.json({ error: e.message }, { status: 400 });
    if (e instanceof VaultUnavailableError)
      return Response.json({ error: e.message }, { status: 503 });
    throw e;
  }
}

function objectBody(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function requiredStr(v: unknown, name: string): string {
  const s = str(v);
  if (!s) throw new BadRequestError(`${name} is required.`);
  return s;
}

function port(v: unknown): number {
  return typeof v === 'number' ? v : Number(v);
}

function assertPort(v: number): void {
  if (!Number.isInteger(v) || v < 1 || v > 65535) {
    throw new BadRequestError('port must be an integer between 1 and 65535.');
  }
}

function assertSslMode(v: string): void {
  if (!SSL_MODES.has(v)) {
    throw new BadRequestError(`sslMode must be one of: ${[...SSL_MODES].join(', ')}.`);
  }
}
