/**
 * AuthService (spec 08 §5) — local accounts, server-side sessions, first-run.
 *
 * - Passwords hashed with **scrypt** (Node built-in, memory-hard; OWASP-acceptable).
 *   The encoded string carries its params + salt so verification is self-describing.
 * - Sessions are opaque 256-bit tokens; only the SHA-256 **hash** is stored, so a DB
 *   read can't impersonate. The raw token lives only in the client's cookie.
 * - First-run: `setup` is allowed only while no user exists; it creates the Owner.
 *
 * Framework-agnostic — the Next routes adapt it to cookies/HTTP.
 */
import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { MetadataStore } from '@evidata/ports';

/** scrypt as a promise (promisify loses the options overload in @types/node). */
function deriveKey(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, dk) => {
      if (err) reject(err);
      else resolve(dk);
    });
  });
}

// scrypt cost: N=2^14 (OWASP minimum), r=8, p=1, 32-byte key. maxmem covers 128*N*r.
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// A well-formed hash to verify against when the username is unknown, so login timing
// doesn't reveal whether the account exists (mitigates user enumeration).
const DUMMY_HASH = `scrypt$${N}$${R}$${P}$${'a'.repeat(24)}$${'b'.repeat(44)}`;

/** The auth subset of the store (so a fake/test store needn't implement everything). */
export type AuthStore = Pick<
  MetadataStore,
  | 'countUsers'
  | 'createFirstUser'
  | 'getUserByUsername'
  | 'createSession'
  | 'getSessionUser'
  | 'deleteSession'
>;

/** A user as exposed to callers — never the password hash. */
export interface AuthedUser {
  id: string;
  /** Login identifier (username-style; not RFC-email-enforced). */
  username: string;
  displayName: string;
}

export interface AuthServiceDeps {
  store: AuthStore;
  now?: () => Date;
  newId?: (prefix: string) => string;
  sessionTtlMs?: number;
}

export interface Credentials {
  username: string;
  password: string;
}

export class AuthService {
  private readonly now: () => Date;
  private readonly newId: (prefix: string) => string;
  private readonly ttlMs: number;

  constructor(private readonly deps: AuthServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? ((p) => `${p}_${randomBytes(12).toString('hex')}`);
    this.ttlMs = deps.sessionTtlMs ?? DEFAULT_TTL_MS;
  }

  async hashPassword(plain: string): Promise<string> {
    const salt = randomBytes(16);
    const dk = await deriveKey(plain, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
    return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${dk.toString('base64')}`;
  }

  async verifyPassword(plain: string, encoded: string): Promise<boolean> {
    const parts = encoded.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
    const salt = Buffer.from(saltB64 ?? '', 'base64');
    const expected = Buffer.from(hashB64 ?? '', 'base64');
    if (expected.length === 0) return false;
    const dk = await deriveKey(plain, salt, expected.length, {
      N: Number(nStr),
      r: Number(rStr),
      p: Number(pStr),
      maxmem: MAXMEM,
    });
    return dk.length === expected.length && timingSafeEqual(dk, expected);
  }

  isSetupComplete(): Promise<boolean> {
    return this.deps.store.countUsers().then((n) => n > 0);
  }

  /** First-run only: atomically create the initial Owner + a session. Throws if a
   *  user already exists (incl. losing a concurrent first-run race). */
  async setup(
    input: Credentials & { displayName: string },
  ): Promise<{ user: AuthedUser; token: string }> {
    // Hash before the atomic insert; createFirstUser is the single source of truth
    // for the zero-user invariant (a pre-check would still race).
    const user = await this.deps.store.createFirstUser({
      id: this.newId('usr'),
      username: input.username,
      displayName: input.displayName,
      passwordHash: await this.hashPassword(input.password),
    });
    if (!user) throw new Error('Setup is already complete.');
    const token = await this.startSession(user.id);
    return { user: publicUser(user.id, user.username, user.displayName), token };
  }

  /** Verify credentials and start a session; null on any failure (generic by design). */
  async login(input: Credentials): Promise<{ user: AuthedUser; token: string } | null> {
    const user = await this.deps.store.getUserByUsername(input.username);
    if (!user) {
      await this.verifyPassword(input.password, DUMMY_HASH); // constant-ish time
      return null;
    }
    if (!(await this.verifyPassword(input.password, user.passwordHash))) return null;
    const token = await this.startSession(user.id);
    return { user: publicUser(user.id, user.username, user.displayName), token };
  }

  async logout(token: string): Promise<void> {
    await this.deps.store.deleteSession(hashToken(token));
  }

  /** Resolve a cookie token to the current user (null if missing/expired/revoked). */
  async resolve(token: string | undefined | null): Promise<AuthedUser | null> {
    if (!token) return null;
    const user = await this.deps.store.getSessionUser(hashToken(token));
    return user ? publicUser(user.id, user.username, user.displayName) : null;
  }

  private async startSession(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.deps.store.createSession({
      id: this.newId('ses'),
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(this.now().getTime() + this.ttlMs),
    });
    return token;
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64');
}

function publicUser(id: string, username: string, displayName: string): AuthedUser {
  return { id, username, displayName };
}
