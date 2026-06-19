import { describe, expect, it } from 'vitest';
import { GET as setupGET, POST as setupPOST } from '../setup/route';
import { currentUser } from '@/lib/auth';
import { POST as loginPOST } from './login/route';
import { POST as logoutPOST } from './logout/route';

// One flow over a shared (module-memoized) runtime: setup → login → session → logout.
const json = (body: unknown): Request =>
  new Request('http://localhost', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const tokenFrom = (res: Response): string => {
  const cookie = res.headers.get('set-cookie') ?? '';
  return /evidata_session=([^;]+)/.exec(cookie)?.[1] ?? '';
};

const owner = {
  username: 'owner@example.com',
  password: 'a-strong-passphrase',
  displayName: 'Owner',
};

describe('auth flow (setup → login → session → logout)', () => {
  it('runs first-run, rejects a re-setup, logs in, resolves + revokes the session', async () => {
    // First-run available.
    expect(await (await setupGET()).json()).toEqual({ setupComplete: false });

    // Weak password rejected.
    expect((await setupPOST(json({ ...owner, password: 'short' }))).status).toBe(400);

    // Bootstrap the Owner — returns the user (no hash) + a session cookie.
    const created = await setupPOST(json(owner));
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as { user: Record<string, unknown> };
    expect(createdBody.user).toMatchObject({
      username: owner.username,
      displayName: owner.displayName,
    });
    expect(createdBody.user.passwordHash).toBeUndefined();
    expect(tokenFrom(created)).toBeTruthy();

    // Setup is now closed.
    expect(await (await setupGET()).json()).toEqual({ setupComplete: true });
    expect((await setupPOST(json(owner))).status).toBe(410);

    // Wrong password → generic 401; right password → 200 + cookie.
    expect((await loginPOST(json({ username: owner.username, password: 'nope' }))).status).toBe(
      401,
    );
    const loggedIn = await loginPOST(json({ username: owner.username, password: owner.password }));
    expect(loggedIn.status).toBe(200);
    const token = tokenFrom(loggedIn);
    expect(token).toBeTruthy();

    // The cookie resolves to the current user.
    const reqWithCookie = new Request('http://localhost', {
      headers: { cookie: `evidata_session=${token}` },
    });
    expect((await currentUser(reqWithCookie))?.username).toBe(owner.username);

    // Logout revokes it: the same cookie no longer resolves.
    const out = await logoutPOST(reqWithCookie);
    expect(out.status).toBe(200);
    expect(out.headers.get('set-cookie')).toMatch(/evidata_session=;/);
    expect(await currentUser(reqWithCookie)).toBeNull();
  });
});
