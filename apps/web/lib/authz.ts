/**
 * Data Source capability matrix (M2-B1a, #121, spec 09 §6) — the single decision
 * point for the governed AI surface. Each service method declares the capability it
 * needs; the guard resolves the caller's Data Source role and checks it here.
 *
 * Invariants (spec 09): Queriers can only query (never see Drafts, never reach
 * Connections); Admins author/publish/manage members but can't transfer ownership
 * or delete; only the Owner can. Connection-level ops are gated separately by
 * Connection membership (a Data Source Admin has no Connection reuse rights).
 */
import type { DataSourceRole } from '@evidata/ports';

export type DataSourceCapability =
  | 'author' // edit scope/policy/overview, calibrate, verify
  | 'publish' // publish / unpublish
  | 'view_draft' // see an unpublished source (authoring surface)
  | 'query' // ask the published source
  | 'manage_members' // invite / assign roles
  | 'transfer_or_delete'; // owner-only

const DS_CAPABILITIES: Record<DataSourceRole, ReadonlySet<DataSourceCapability>> = {
  owner: new Set([
    'author',
    'publish',
    'view_draft',
    'query',
    'manage_members',
    'transfer_or_delete',
  ]),
  admin: new Set(['author', 'publish', 'view_draft', 'query', 'manage_members']),
  querier: new Set(['query']),
};

/** Whether a role (null = no membership) has a capability on a Data Source. */
export function canDataSource(
  role: DataSourceRole | null | undefined,
  capability: DataSourceCapability,
): boolean {
  return role ? DS_CAPABILITIES[role].has(capability) : false;
}
