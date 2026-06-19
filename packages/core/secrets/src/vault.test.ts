import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EnvKeyCredentialVault, credentialVaultFromEnv } from './vault';

const k = (fill: number): Buffer => Buffer.alloc(32, fill);
const CONN = 'conn_abc';
const SECRET = 'postgres://user:p@ss@host:5432/db';

describe('EnvKeyCredentialVault', () => {
  it('round-trips with the correct AAD', () => {
    const vault = new EnvKeyCredentialVault({ keys: [{ id: 'k1', key: k(1) }], activeKeyId: 'k1' });
    const blob = vault.encrypt(SECRET, CONN);
    expect(blob.keyId).toBe('k1');
    expect(blob.v).toBe(1);
    expect(blob.ciphertext).not.toContain('p@ss'); // not plaintext
    expect(vault.decrypt(blob, CONN)).toBe(SECRET);
  });

  it('uses a fresh IV per encryption (no deterministic ciphertext)', () => {
    const vault = new EnvKeyCredentialVault({ keys: [{ id: 'k1', key: k(1) }], activeKeyId: 'k1' });
    const a = vault.encrypt(SECRET, CONN);
    const b = vault.encrypt(SECRET, CONN);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('fails to decrypt under a different AAD (blob cannot be swapped between connections)', () => {
    const vault = new EnvKeyCredentialVault({ keys: [{ id: 'k1', key: k(1) }], activeKeyId: 'k1' });
    const blob = vault.encrypt(SECRET, CONN);
    expect(() => vault.decrypt(blob, 'conn_other')).toThrow();
  });

  it('detects tampered ciphertext and tampered auth tag', () => {
    const vault = new EnvKeyCredentialVault({ keys: [{ id: 'k1', key: k(1) }], activeKeyId: 'k1' });
    const blob = vault.encrypt(SECRET, CONN);
    const flip = (b64: string): string => {
      const buf = Buffer.from(b64, 'base64');
      buf[0] = (buf[0] ?? 0) ^ 0xff;
      return buf.toString('base64');
    };
    expect(() => vault.decrypt({ ...blob, ciphertext: flip(blob.ciphertext) }, CONN)).toThrow();
    expect(() => vault.decrypt({ ...blob, authTag: flip(blob.authTag) }, CONN)).toThrow();
  });

  it('rejects a truncated auth tag (no integrity downgrade)', () => {
    const vault = new EnvKeyCredentialVault({ keys: [{ id: 'k1', key: k(1) }], activeKeyId: 'k1' });
    const blob = vault.encrypt(SECRET, CONN);
    const shortTag = Buffer.from(blob.authTag, 'base64').subarray(0, 8).toString('base64');
    expect(() => vault.decrypt({ ...blob, authTag: shortTag }, CONN)).toThrow(/auth tag length/);
  });

  it('rejects an unknown key id and an unsupported scheme version', () => {
    const vault = new EnvKeyCredentialVault({ keys: [{ id: 'k1', key: k(1) }], activeKeyId: 'k1' });
    const blob = vault.encrypt(SECRET, CONN);
    expect(() => vault.decrypt({ ...blob, keyId: 'nope' }, CONN)).toThrow(/Unknown credential key/);
    expect(() => vault.decrypt({ ...blob, v: 99 }, CONN)).toThrow(/scheme version/);
  });

  it('rotates keys: new writes use the active key; old blobs still decrypt', () => {
    const old = new EnvKeyCredentialVault({ keys: [{ id: 'k1', key: k(1) }], activeKeyId: 'k1' });
    const oldBlob = old.encrypt(SECRET, CONN);

    // Add k2 and make it active; k1 is retained so old blobs keep working.
    const rotated = new EnvKeyCredentialVault({
      keys: [
        { id: 'k1', key: k(1) },
        { id: 'k2', key: k(2) },
      ],
      activeKeyId: 'k2',
    });
    expect(rotated.decrypt(oldBlob, CONN)).toBe(SECRET); // old blob, old key
    const newBlob = rotated.encrypt(SECRET, CONN);
    expect(newBlob.keyId).toBe('k2'); // new write uses the active key
    expect(rotated.decrypt(newBlob, CONN)).toBe(SECRET);
  });

  it('validates the key set in the constructor', () => {
    expect(() => new EnvKeyCredentialVault({ keys: [], activeKeyId: 'k1' })).toThrow(
      /at least one/,
    );
    expect(
      () =>
        new EnvKeyCredentialVault({
          keys: [{ id: 'k1', key: Buffer.alloc(16) }],
          activeKeyId: 'k1',
        }),
    ).toThrow(/32 bytes/);
    expect(
      () => new EnvKeyCredentialVault({ keys: [{ id: 'k1', key: k(1) }], activeKeyId: 'k2' }),
    ).toThrow(/not in the key set/);
  });
});

describe('credentialVaultFromEnv', () => {
  it('returns null when no key is configured', () => {
    expect(credentialVaultFromEnv({})).toBeNull();
  });

  it('builds from a single APP_ENCRYPTION_KEY', () => {
    const vault = credentialVaultFromEnv({
      APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    });
    expect(vault).not.toBeNull();
    const blob = vault!.encrypt(SECRET, CONN);
    expect(blob.keyId).toBe('k1');
    expect(vault!.decrypt(blob, CONN)).toBe(SECRET);
  });

  it('builds a rotation set from APP_ENCRYPTION_KEYS + APP_ENCRYPTION_KEY_ID', () => {
    const keys = JSON.stringify([
      { id: 'k1', key: randomBytes(32).toString('base64') },
      { id: 'k2', key: randomBytes(32).toString('base64') },
    ]);
    const vault = credentialVaultFromEnv({
      APP_ENCRYPTION_KEYS: keys,
      APP_ENCRYPTION_KEY_ID: 'k2',
    });
    expect(vault!.encrypt(SECRET, CONN).keyId).toBe('k2');
  });

  it('rejects malformed APP_ENCRYPTION_KEYS', () => {
    expect(() => credentialVaultFromEnv({ APP_ENCRYPTION_KEYS: 'not json' })).toThrow(/valid JSON/);
  });
});
