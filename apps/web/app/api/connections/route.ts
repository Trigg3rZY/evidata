import { BadRequestError, withConnections } from '@/lib/connection-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SSL_MODES = new Set(['disable', 'prefer', 'require', 'verify-ca', 'verify-full']);

interface CreateBody {
  name?: unknown;
  host?: unknown;
  port?: unknown;
  database?: unknown;
  sslMode?: unknown;
  user?: unknown;
  password?: unknown;
}

/** List Connections (summaries — never credentials). */
export function GET(req: Request): Promise<Response> {
  return withConnections(req, (_user, connections) => connections.list());
}

/** Create a Connection — credentials are encrypted at rest (spec 08 §3/§6). */
export function POST(req: Request): Promise<Response> {
  return withConnections(
    req,
    async (user, connections) => {
      const body = (await req.json().catch(() => null)) as CreateBody | null;
      const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
      const name = str(body?.name);
      const host = str(body?.host);
      const database = str(body?.database);
      const sslMode = str(body?.sslMode) || 'require';
      const dbUser = str(body?.user);
      const password = typeof body?.password === 'string' ? body.password : '';
      const port = typeof body?.port === 'number' ? body.port : Number(body?.port);

      if (!name || !host || !database || !dbUser || !password) {
        throw new BadRequestError('name, host, database, user, and password are required.');
      }
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new BadRequestError('port must be an integer between 1 and 65535.');
      }
      if (!SSL_MODES.has(sslMode)) {
        throw new BadRequestError(`sslMode must be one of: ${[...SSL_MODES].join(', ')}.`);
      }
      return connections.create(user.id, {
        name,
        host,
        port,
        database,
        sslMode,
        user: dbUser,
        password,
      });
    },
    201,
  );
}
