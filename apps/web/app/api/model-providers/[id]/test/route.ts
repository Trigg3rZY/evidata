import { withModelProviders } from '@/lib/model-provider-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Probe a model provider's reachability (#119): a cheap key/endpoint check so a
 *  misconfigured model surfaces before a question fails. Owner-gated in the service. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return withModelProviders(req, (_user, providers) => providers.test(id));
}
