import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMetadataDb, DrizzleMetadataStore, type MetadataDbHandle } from '@evidata/db';
import { AuthService } from '@evidata/auth';
import { AuthoringAccessError, InviteService } from './invite-service';

const blob = { v: 1, keyId: 'k1', iv: 'a', ciphertext: 'b', authTag: 'c' };
let handle: MetadataDbHandle;
let store: DrizzleMetadataStore;
let auth: AuthService;

const svc = (now?: () => Date): InviteService =>
  new InviteService({ store, auth, ...(now ? { now } : {}) });

beforeAll(async () => {
  handle = await createMetadataDb();
  store = new DrizzleMetadataStore(handle.db);
  auth = new AuthService({ store });

  // owner (first user), an admin, and an existing user — all real (FKs).
  await store.createFirstUser({
    id: 'owner',
    username: 'owner',
    displayName: 'Owner',
    passwordHash: 'x',
  });
  await store.createUser({
    id: 'admin',
    username: 'admin',
    displayName: 'Admin',
    passwordHash: 'x',
  });
  await store.createUser({
    id: 'existing',
    username: 'existing',
    displayName: 'Existing',
    passwordHash: 'x',
  });

  await store.createConnection({
    id: 'c1',
    kind: 'postgres',
    name: 'PG',
    host: 'h',
    port: 5432,
    database: 'd',
    sslMode: 'disable',
    credentialBlob: blob,
    health: 'Healthy',
    createdBy: 'owner',
  });
  await store.createDataSource({ id: 'ds', name: 'DS', kind: 'postgres', connectionId: 'c1' });
  await store.createDataSourceMembership({
    id: 'm-own',
    userId: 'owner',
    dataSourceId: 'ds',
    role: 'owner',
  });
  await store.createDataSourceMembership({
    id: 'm-adm',
    userId: 'admin',
    dataSourceId: 'ds',
    role: 'admin',
  });
});

afterAll(async () => {
  await handle.close();
});

describe('InviteService (M2-B1b, #121)', () => {
  it('owner-gates create/list on manage_members (non-member → 404)', async () => {
    await expect(svc().create('stranger', 'ds', 'querier')).rejects.toBeInstanceOf(
      AuthoringAccessError,
    );
    await expect(svc().listMembers('stranger', 'ds')).rejects.toBeInstanceOf(AuthoringAccessError);
  });

  it('an admin cannot mint an owner invite (only an owner can)', async () => {
    await expect(svc().create('admin', 'ds', 'owner')).rejects.toMatchObject({
      code: 'forbidden_owner_grant',
    });
    // …but an admin can mint admin/querier invites.
    const inv = await svc().create('admin', 'ds', 'querier');
    expect(typeof inv.token).toBe('string');
  });

  it('signup-on-redeem: anonymous creates an account + gets the role + a session', async () => {
    const { token } = await svc().create('owner', 'ds', 'querier');
    const res = await svc().redeem(token, {
      signup: { username: 'newbie', displayName: 'Newbie', password: 'pw-12345' },
    });
    expect(res).toMatchObject({ dataSourceId: 'ds', role: 'querier' });
    expect(typeof res.sessionToken).toBe('string'); // logged in
    const newUser = await store.getUserByUsername('newbie');
    expect(await store.getDataSourceRole(newUser!.id, 'ds')).toBe('querier');
  });

  it('logged-in redeem grants to the current user, no new session', async () => {
    const { token } = await svc().create('owner', 'ds', 'admin');
    const res = await svc().redeem(token, { currentUserId: 'existing' });
    expect(res).toMatchObject({ dataSourceId: 'ds', role: 'admin' });
    expect(res.sessionToken).toBeUndefined();
    expect(await store.getDataSourceRole('existing', 'ds')).toBe('admin');
  });

  it('a token is single-use: a second redeem is rejected', async () => {
    const { token } = await svc().create('owner', 'ds', 'querier');
    await svc().redeem(token, {
      signup: { username: 'once', displayName: 'Once', password: 'pw-12345' },
    });
    await expect(svc().redeem(token, { currentUserId: 'existing' })).rejects.toMatchObject({
      code: 'redeemed',
    });
  });

  it('rolls back the just-created account when the redeem loses the single-use claim (#147)', async () => {
    const { token } = await svc().create('owner', 'ds', 'querier');
    // The token is consumed first (stands in for the winner of a concurrent race).
    await svc().redeem(token, { currentUserId: 'existing' });
    // A second anonymous redeem signs up, but the claim then fails (already redeemed) →
    // the brand-new account is rolled back, leaving no orphan and freeing the username.
    await expect(
      svc().redeem(token, {
        signup: { username: 'racer', displayName: 'Racer', password: 'pw-12345' },
      }),
    ).rejects.toMatchObject({ code: 'redeemed' });
    expect(await store.getUserByUsername('racer')).toBeNull();
  });

  it('rejects an expired token', async () => {
    const { token } = await svc().create('owner', 'ds', 'querier', 7);
    const future = () => new Date(Date.now() + 8 * 86_400_000); // 8 days later
    await expect(svc(future).redeem(token, { currentUserId: 'existing' })).rejects.toMatchObject({
      code: 'expired',
    });
  });

  it('rejects signup with a taken username; requires signup when anonymous', async () => {
    const a = await svc().create('owner', 'ds', 'querier');
    await expect(
      svc().redeem(a.token, {
        signup: { username: 'owner', displayName: 'Dup', password: 'pw-12345' },
      }),
    ).rejects.toMatchObject({ code: 'username_taken' });

    const b = await svc().create('owner', 'ds', 'querier');
    await expect(svc().redeem(b.token, {})).rejects.toMatchObject({ code: 'signup_required' });
  });

  it('rejects weak signup input (empty username/name or short password — parity with setup)', async () => {
    const mk = () => svc().create('owner', 'ds', 'querier');
    // Empty (whitespace) username → would otherwise create an unreachable account.
    await expect(
      svc().redeem((await mk()).token, {
        signup: { username: '   ', displayName: 'X', password: 'pw-12345' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_signup' });
    // Password < 8 chars.
    await expect(
      svc().redeem((await mk()).token, {
        signup: { username: 'weakpw', displayName: 'X', password: 'short' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_signup' });
  });

  it('lists + revokes pending invites', async () => {
    const before = (await svc().listPending('owner', 'ds')).length;
    const { token } = await svc().create('owner', 'ds', 'querier');
    const pending = await svc().listPending('owner', 'ds');
    expect(pending.length).toBe(before + 1);
    await svc().revoke('owner', 'ds', pending[pending.length - 1]!.id);
    expect((await svc().listPending('owner', 'ds')).length).toBe(before);
    // A revoked token can't be redeemed.
    await expect(svc().redeem(token, { currentUserId: 'existing' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('member removal: blocks last owner + non-owner removing an owner', async () => {
    expect((await svc().listMembers('owner', 'ds')).some((m) => m.userId === 'owner')).toBe(true);
    // 'admin' (manage_members) cannot remove the owner.
    await expect(svc().removeMember('admin', 'ds', 'owner')).rejects.toMatchObject({
      code: 'forbidden_owner_grant',
    });
    // The owner cannot remove themselves while they're the only owner.
    await expect(svc().removeMember('owner', 'ds', 'owner')).rejects.toMatchObject({
      code: 'last_owner',
    });
    // But can remove a non-owner member.
    await svc().removeMember('owner', 'ds', 'admin');
    expect(await store.getDataSourceRole('admin', 'ds')).toBeNull();
  });
});
