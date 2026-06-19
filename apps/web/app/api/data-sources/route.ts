import { getRuntime } from '@/lib/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Data sources for the in-composer selector (id + name only; no internals). */
export async function GET(): Promise<Response> {
  const rt = await getRuntime();
  return Response.json(await rt.service.listDataSources());
}
