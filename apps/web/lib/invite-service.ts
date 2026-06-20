/**
 * Data Source invites (M2-B1b, #121, spec 09 §6) — single-use, expiring invite
 * tokens that grant a Data Source role. Only the SHA-256 hash of the opaque token is
 * stored (like sessions); the raw token rides in the link. Redeeming either grants
 * the role to the signed-in user or creates an account (signup-on-redeem) + a session.
 *
 * Owner/admin-gated via the `manage_members` capability. Granting/removing an Owner
 * requires the caller be an Owner (admins manage admin/querier only); the last Owner
 * can't be removed (spec invariants).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { AuthService } from '@evidata/auth';
import type { DataSourceMemberView, DataSourceRole, MetadataStore } from '@evidata/ports';
import { AuthoringAccessError, requireDataSourceCapability } from './authoring-service';

const DEFAULT_TTL_DAYS = 7;
const hashToken = (token: string): string => createHash('sha256').update(token).digest('base64');

export type InviteErrorCode =
  | 'not_found' // unknown/invalid token
  | 'expired'
  | 'redeemed' // already used (or lost the claim race)
  | 'username_taken'
  | 'signup_required' // anonymous redeem without signup fields
  | 'forbidden_owner_grant' // admin tried to mint/remove an owner
  | 'last_owner'; // can't remove the only owner

export class InviteError extends Error {
  constructor(readonly code: InviteErrorCode) {
    super(code);
    this.name = 'InviteError';
  }
}

export interface SignupInput {
  username: string;
  displayName: string;
  password: string;
}

export interface RedeemResult {
  dataSourceId: string;
  role: DataSourceRole;
  /** A new session token when redemption created/authenticated a user (signup path). */
  sessionToken?: string;
}

type InviteStore = Pick<
  MetadataStore,
  | 'getDataSource'
  | 'getDataSourceRole'
  | 'createDataSourceMembership'
  | 'listDataSourceMembers'
  | 'removeDataSourceMembership'
  | 'createDataSourceInvite'
  | 'getDataSourceInviteByHash'
  | 'redeemDataSourceInvite'
  | 'listPendingDataSourceInvites'
  | 'deleteDataSourceInvite'
>;

export interface InviteServiceDeps {
  store: InviteStore;
  auth: Pick<AuthService, 'register'>;
  now?: () => Date;
  newId?: (prefix: string) => string;
}

export class InviteService {
  private readonly now: () => Date;
  private readonly newId: (prefix: string) => string;

  constructor(private readonly deps: InviteServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? ((p) => `${p}_${randomBytes(12).toString('hex')}`);
  }

  /** Mint an invite for a Data Source + role. Returns the raw token (for the link). */
  async create(
    userId: string,
    dataSourceId: string,
    role: DataSourceRole,
    ttlDays = DEFAULT_TTL_DAYS,
  ): Promise<{ token: string; expiresAt: string }> {
    const { role: callerRole } = await requireDataSourceCapability(
      this.deps.store,
      userId,
      dataSourceId,
      'manage_members',
    );
    if (role === 'owner' && callerRole !== 'owner') throw new InviteError('forbidden_owner_grant');

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.now().getTime() + ttlDays * 86_400_000);
    await this.deps.store.createDataSourceInvite({
      id: this.newId('inv'),
      dataSourceId,
      role,
      tokenHash: hashToken(token),
      createdBy: userId,
      expiresAt,
    });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  /** Redeem a token: grant the role to the signed-in user, or sign up a new one. */
  async redeem(
    token: string,
    opts: { currentUserId?: string; signup?: SignupInput },
  ): Promise<RedeemResult> {
    const invite = await this.deps.store.getDataSourceInviteByHash(hashToken(token));
    if (!invite) throw new InviteError('not_found');
    if (invite.redeemedAt) throw new InviteError('redeemed');
    if (new Date(invite.expiresAt).getTime() <= this.now().getTime()) {
      throw new InviteError('expired');
    }

    // Resolve the redeeming user: the current session, or a fresh signup-on-redeem.
    let userId = opts.currentUserId;
    let sessionToken: string | undefined;
    if (!userId) {
      if (!opts.signup) throw new InviteError('signup_required');
      const created = await this.deps.auth.register(opts.signup);
      if (!created) throw new InviteError('username_taken');
      userId = created.user.id;
      sessionToken = created.token;
    }

    // Atomic single-use claim — guards against a double-redeem race.
    if (!(await this.deps.store.redeemDataSourceInvite(invite.id, userId, this.now()))) {
      throw new InviteError('redeemed');
    }

    // Grant the role unless they're already a member (idempotent join — keep existing).
    const existing = await this.deps.store.getDataSourceRole(userId, invite.dataSourceId);
    if (!existing) {
      await this.deps.store.createDataSourceMembership({
        id: this.newId('dsm'),
        userId,
        dataSourceId: invite.dataSourceId,
        role: invite.role,
      });
    }
    return {
      dataSourceId: invite.dataSourceId,
      role: existing ?? invite.role,
      ...(sessionToken ? { sessionToken } : {}),
    };
  }

  async listMembers(userId: string, dataSourceId: string): Promise<DataSourceMemberView[]> {
    await requireDataSourceCapability(this.deps.store, userId, dataSourceId, 'manage_members');
    return this.deps.store.listDataSourceMembers(dataSourceId);
  }

  async removeMember(userId: string, dataSourceId: string, targetUserId: string): Promise<void> {
    const { role: callerRole } = await requireDataSourceCapability(
      this.deps.store,
      userId,
      dataSourceId,
      'manage_members',
    );
    const members = await this.deps.store.listDataSourceMembers(dataSourceId);
    const target = members.find((m) => m.userId === targetUserId);
    if (!target) return; // already gone — idempotent
    // Only an owner may remove an owner; never remove the last owner.
    if (target.role === 'owner') {
      if (callerRole !== 'owner') throw new InviteError('forbidden_owner_grant');
      if (members.filter((m) => m.role === 'owner').length <= 1)
        throw new InviteError('last_owner');
    }
    await this.deps.store.removeDataSourceMembership(dataSourceId, targetUserId);
  }

  async listPending(
    userId: string,
    dataSourceId: string,
  ): Promise<Array<{ id: string; role: DataSourceRole; expiresAt: string; createdAt: string }>> {
    await requireDataSourceCapability(this.deps.store, userId, dataSourceId, 'manage_members');
    return this.deps.store.listPendingDataSourceInvites(dataSourceId);
  }

  async revoke(userId: string, dataSourceId: string, inviteId: string): Promise<void> {
    await requireDataSourceCapability(this.deps.store, userId, dataSourceId, 'manage_members');
    await this.deps.store.deleteDataSourceInvite(dataSourceId, inviteId);
  }
}

export { AuthoringAccessError };
