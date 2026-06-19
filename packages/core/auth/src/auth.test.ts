import { describe, expect, it } from 'vitest';
import type { NewSession, NewUser, UserRecord } from '@evidata/ports';
import { AuthService, type AuthStore } from './auth';

/** In-memory AuthStore so the auth tests stay hermetic (no DB). */
class FakeStore implements AuthStore {
  private byId = new Map<string, UserRecord>();
  private byEmail = new Map<string, string>();
  private sessions = new Map<string, { userId: string; expiresAt: Date }>();

  countUsers(): Promise<number> {
    return Promise.resolve(this.byId.size);
  }
  createUser(u: NewUser): Promise<UserRecord> {
    const rec: UserRecord = { ...u, createdAt: '2026-06-19T00:00:00.000Z' };
    this.byId.set(u.id, rec);
    this.byEmail.set(u.email, u.id);
    return Promise.resolve(rec);
  }
  getUserByEmail(email: string): Promise<UserRecord | null> {
    const id = this.byEmail.get(email);
    return Promise.resolve(id ? (this.byId.get(id) ?? null) : null);
  }
  createSession(s: NewSession): Promise<void> {
    this.sessions.set(s.tokenHash, { userId: s.userId, expiresAt: s.expiresAt });
    return Promise.resolve();
  }
  getSessionUser(tokenHash: string): Promise<UserRecord | null> {
    const s = this.sessions.get(tokenHash);
    if (!s || s.expiresAt.getTime() <= Date.now()) return Promise.resolve(null);
    return Promise.resolve(this.byId.get(s.userId) ?? null);
  }
  deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
    return Promise.resolve();
  }
}

const owner = {
  email: 'owner@example.com',
  password: 'correct horse battery',
  displayName: 'Owner',
};

describe('AuthService — password hashing', () => {
  const auth = new AuthService({ store: new FakeStore() });

  it('round-trips a password and rejects the wrong one', async () => {
    const hash = await auth.hashPassword('s3cret-pw');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash).not.toContain('s3cret-pw');
    expect(await auth.verifyPassword('s3cret-pw', hash)).toBe(true);
    expect(await auth.verifyPassword('wrong', hash)).toBe(false);
  });

  it('salts each hash (same password → different encodings)', async () => {
    const a = await auth.hashPassword('same');
    const b = await auth.hashPassword('same');
    expect(a).not.toBe(b);
  });

  it('rejects a malformed encoded hash', async () => {
    expect(await auth.verifyPassword('x', 'not-a-hash')).toBe(false);
  });
});

describe('AuthService — first-run, login, sessions', () => {
  it('setup creates the first Owner and a working session; second setup is rejected', async () => {
    const auth = new AuthService({ store: new FakeStore() });
    expect(await auth.isSetupComplete()).toBe(false);

    const { user, token } = await auth.setup(owner);
    expect(user).toEqual({ id: user.id, email: owner.email, displayName: owner.displayName });
    expect((user as { passwordHash?: string }).passwordHash).toBeUndefined();
    expect(await auth.isSetupComplete()).toBe(true);
    expect(await auth.resolve(token)).toMatchObject({ email: owner.email });

    await expect(auth.setup({ ...owner, email: 'other@example.com' })).rejects.toThrow(/already/i);
  });

  it('login succeeds with the right password and fails generically otherwise', async () => {
    const auth = new AuthService({ store: new FakeStore() });
    await auth.setup(owner);

    const ok = await auth.login({ email: owner.email, password: owner.password });
    expect(ok?.user.email).toBe(owner.email);
    expect(ok?.token).toBeTruthy();

    expect(await auth.login({ email: owner.email, password: 'nope' })).toBeNull();
    expect(await auth.login({ email: 'ghost@example.com', password: owner.password })).toBeNull();
  });

  it('logout revokes the session; a resolved token then returns null', async () => {
    const auth = new AuthService({ store: new FakeStore() });
    const { token } = await auth.setup(owner);
    expect(await auth.resolve(token)).not.toBeNull();
    await auth.logout(token);
    expect(await auth.resolve(token)).toBeNull();
  });

  it('does not resolve an expired session', async () => {
    const auth = new AuthService({ store: new FakeStore(), sessionTtlMs: -1000 });
    const { token } = await auth.setup(owner);
    expect(await auth.resolve(token)).toBeNull();
  });

  it('resolve(null) is null (no cookie)', async () => {
    const auth = new AuthService({ store: new FakeStore() });
    expect(await auth.resolve(undefined)).toBeNull();
  });
});
