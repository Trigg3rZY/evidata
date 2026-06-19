import { withModelProviders } from '@/lib/model-provider-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Remove a model provider (and its encrypted key). */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return withModelProviders(req, (user, providers) => providers.remove(user.id, id));
}
