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
import { PublishedDataSourceResolver } from './data-source-resolver';

const blob = { v: 1, keyId: 'k1', iv: 'a', ciphertext: 'b', authTag: 'c' };
const DS = 'ds-accept';

let handle: MetadataDbHandle;
let store: DrizzleMetadataStore;
let invites: InviteService;
let authoring: DataSourceAuthoringService;
let resolver: PublishedDataSourceResolver;

beforeAll(async () => {
  handle = await createMetadataDb();
  store = new DrizzleMetadataStore(handle.db);
  invites = new InviteService({ store, auth: new AuthService({ store }) });
  authoring = new DataSourceAuthoringService(store);
  // The published-source resolver — its query gate is (DS membership ∧ `query`). `list`
  // never builds a connector, so it proves the gate hermetically; `connectorFor` would
  // only run on a fully-resolved query (covered with real Postgres in the integration
  // test), so a stub that throws is never reached here.
  resolver = new PublishedDataSourceResolver(
    store,
    { connectorFor: () => Promise.reject(new Error('no live Postgres in the hermetic test')) },
    new Set(),
  );

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
  // A published Data Source the owner owns (the surface the matrix is enforced on),
  // bound to the connection + scoped — so the resolver reaches its authz gate (rather
  // than bailing earlier on a missing binding) for the negative cases.
  await store.createDataSource({ id: DS, name: 'PG', kind: 'postgres', connectionId: 'c1' });
  await store.upsertDataSourceConnection({
    id: 'dsc1',
    dataSourceId: DS,
    connectionId: 'c1',
    alias: null,
    includedTables: ['customers'],
    fieldRules: {},
  });
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

    // 3) The Querier CAN query — proven through the resolver's query gate, not just the
    //    matrix: the published source shows up in the Querier's list (the gate is
    //    membership ∧ `query`; `list` admits exactly the queryable sources). The matrix
    //    underpins it; the real read-only execution lives in the integration test.
    expect(canDataSource('querier', 'query')).toBe(true);
    expect((await resolver.list(quinn.id)).some((d) => d.id === DS)).toBe(true);
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

    // 5) A non-member has no access at all: the resolver's query gate denies them (no
    //    role → not listed; resolve returns null even though the binding exists), and
    //    the authoring surface rejects them too.
    expect(await store.getDataSourceRole('stranger', DS)).toBeNull();
    expect(canDataSource(null, 'query')).toBe(false);
    expect(await resolver.list('stranger')).toEqual([]);
    expect(await resolver.list()).toEqual([]); // anonymous
    expect(await resolver.resolve(DS, 'stranger')).toBeNull(); // gated past the binding
    expect(await resolver.resolve(DS)).toBeNull(); // anonymous
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
