/**
 * M2 acceptance — the multi-user trust boundary, end-to-end (spec 09 §8).
 *
 * An Owner onboards a Querier via an invite token (signup-on-redeem), then the
 * capability matrix is enforced across services on the SAME published Data Source:
 * the Querier may query but is blocked from authoring and member management; an Admin
 * can manage members + author but cannot transfer ownership or mint an Owner; a
 * stranger has no access at all. This ties together B1a (authz matrix), B1b (invites)
 * and the authoring gate as one regression — the per-service mechanics are covered by
 * authz.test.ts / invite-service.test.ts / authoring-service.test.ts, and the real
 * read-only query path by data-source-resolver.integration.test.ts (gated on Postgres).
 * Hermetic: in-memory metadata, no Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMetadataDb, DrizzleMetadataStore, type MetadataDbHandle } from '@evidata/db';
import { AuthService } from '@evidata/auth';
import { canDataSource, type DataSourceCapability } from './authz';
import { AuthoringAccessError, DataSourceAuthoringService } from './authoring-service';
import { InviteService } from './invite-service';

const blob = { v: 1, keyId: 'k1', iv: 'a', ciphertext: 'b', authTag: 'c' };
const DS = 'ds-accept';

let handle: MetadataDbHandle;
let store: DrizzleMetadataStore;
let invites: InviteService;
let authoring: DataSourceAuthoringService;

beforeAll(async () => {
  handle = await createMetadataDb();
  store = new DrizzleMetadataStore(handle.db);
  invites = new InviteService({ store, auth: new AuthService({ store }) });
  authoring = new DataSourceAuthoringService(store);

  await store.createFirstUser({
    id: 'owner',
    username: 'owner',
    displayName: 'Owner',
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
  // A published Data Source the owner owns (the surface the matrix is enforced on).
  await store.createDataSource({ id: DS, name: 'PG', kind: 'postgres', connectionId: 'c1' });
  await store.setDataSourceLifecycle(DS, 'published');
  await store.createDataSourceMembership({
    id: 'm-own',
    userId: 'owner',
    dataSourceId: DS,
    role: 'owner',
  });
});

afterAll(async () => {
  await handle.close();
});

describe('M2 acceptance — multi-user trust boundary (spec 09 §8)', () => {
  it('Owner onboards a Querier via invite; the matrix is enforced across services', async () => {
    // 1) Owner mints a querier invite; an anonymous person redeems it (signup-on-redeem).
    const { token } = await invites.create('owner', DS, 'querier');
    const redeemed = await invites.redeem(token, {
      signup: { username: 'quinn', displayName: 'Quinn', password: 'pw-123456' },
    });
    expect(redeemed).toMatchObject({ dataSourceId: DS, role: 'querier' });
    expect(typeof redeemed.sessionToken).toBe('string'); // onboarded AND logged in
    const quinn = (await store.getUserByUsername('quinn'))!;

    // 2) The Querier is a member with exactly the 'querier' role.
    expect(await store.getDataSourceRole(quinn.id, DS)).toBe('querier');

    // 3) The capability matrix: a Querier may query, nothing else. The resolver's query
    //    gate is exactly (membership present ∧ `query`) — both hold here; the real
    //    read-only execution lives in data-source-resolver.integration.test.ts.
    expect(canDataSource('querier', 'query')).toBe(true);
    const denied: DataSourceCapability[] = [
      'author',
      'publish',
      'view_draft',
      'manage_members',
      'transfer_or_delete',
    ];
    for (const cap of denied) expect(canDataSource('querier', cap)).toBe(false);

    // 4) Enforced across services (membership ≠ authorization): a Querier — a real
    //    member — is still blocked from authoring and from member management.
    await expect(authoring.getEditable(quinn.id, DS)).rejects.toBeInstanceOf(AuthoringAccessError);
    await expect(invites.listMembers(quinn.id, DS)).rejects.toBeInstanceOf(AuthoringAccessError);
    await expect(invites.create(quinn.id, DS, 'querier')).rejects.toBeInstanceOf(
      AuthoringAccessError,
    );

    // 5) A non-member has no access at all: no role, no query, no authoring surface.
    expect(await store.getDataSourceRole('stranger', DS)).toBeNull();
    expect(canDataSource(null, 'query')).toBe(false);
    await expect(authoring.getEditable('stranger', DS)).rejects.toBeInstanceOf(
      AuthoringAccessError,
    );
  });

  it('an Admin manages members + authors, but cannot transfer ownership or mint an Owner', async () => {
    // Onboard an existing user as Admin via a logged-in redeem.
    await store.createUser({
      id: 'amir',
      username: 'amir',
      displayName: 'Amir',
      passwordHash: 'x',
    });
    const { token } = await invites.create('owner', DS, 'admin');
    await invites.redeem(token, { currentUserId: 'amir' });
    expect(await store.getDataSourceRole('amir', DS)).toBe('admin');

    // An Admin holds author + manage_members, and can mint querier/admin invites…
    expect(canDataSource('admin', 'author')).toBe(true);
    expect(canDataSource('admin', 'manage_members')).toBe(true);
    expect(typeof (await invites.create('amir', DS, 'querier')).token).toBe('string');

    // …but cannot mint an Owner invite, nor transfer/delete (owner-only).
    await expect(invites.create('amir', DS, 'owner')).rejects.toMatchObject({
      code: 'forbidden_owner_grant',
    });
    expect(canDataSource('admin', 'transfer_or_delete')).toBe(false);
  });
});
