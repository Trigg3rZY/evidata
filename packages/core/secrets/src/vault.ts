/**
 * EnvKeyCredentialVault — the M1 CredentialVault adapter (spec 08 §3).
 *
 * AES-256-GCM authenticated encryption with a deployer-provided key. A fresh
 * 96-bit IV per encryption; the 128-bit GCM auth tag is stored alongside and
 * verified on decrypt (detecting tampering). The AAD is the Connection id, so a
 * ciphertext is bound to its row and cannot be swapped between Connections.
 *
 * `keyId`/`v` enable key rotation: multiple keys can be loaded, new writes use the
 * active key, and decryption selects the key the blob was written with — so old
 * blobs keep decrypting while a background re-encrypt migrates them.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { CredentialVault, EncryptedSecret } from '@evidata/ports';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit IV, the GCM standard
const KEY_BYTES = 32; // AES-256
const SCHEME_VERSION = 1;

export interface VaultKey {
  id: string;
  /** Exactly 32 raw bytes. */
  key: Buffer;
}

export interface VaultOptions {
  keys: ReadonlyArray<VaultKey>;
  /** Which key new encryptions use; must be present in `keys`. */
  activeKeyId: string;
}

export class EnvKeyCredentialVault implements CredentialVault {
  private readonly keys: Map<string, Buffer>;
  private readonly activeKeyId: string;

  constructor(opts: VaultOptions) {
    if (opts.keys.length === 0) {
      throw new Error('CredentialVault requires at least one key.');
    }
    this.keys = new Map(
      opts.keys.map((k) => {
        if (k.key.length !== KEY_BYTES) {
          throw new Error(`Vault key "${k.id}" must be ${KEY_BYTES} bytes (got ${k.key.length}).`);
        }
        return [k.id, k.key];
      }),
    );
    if (!this.keys.has(opts.activeKeyId)) {
      throw new Error(`Active key "${opts.activeKeyId}" is not in the key set.`);
    }
    this.activeKeyId = opts.activeKeyId;
  }

  encrypt(plaintext: string, aad: string): EncryptedSecret {
    // The active key is guaranteed present by the constructor.
    const key = this.keys.get(this.activeKeyId) as Buffer;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      v: SCHEME_VERSION,
      keyId: this.activeKeyId,
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }

  decrypt(secret: EncryptedSecret, aad: string): string {
    if (secret.v !== SCHEME_VERSION) {
      throw new Error(`Unsupported credential scheme version: ${secret.v}`);
    }
    const key = this.keys.get(secret.keyId);
    if (!key) {
      throw new Error(`Unknown credential key id: ${secret.keyId}`);
    }
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(secret.iv, 'base64'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(secret.authTag, 'base64'));
    // `final()` throws if the auth tag or AAD does not verify — tamper detection.
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(secret.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}

interface KeyEntry {
  id: string;
  key: string;
}

/**
 * Build a vault from environment variables. Returns null if no key is configured
 * (so a dev/test process without secrets simply has no vault).
 *
 * - Single key (common): `APP_ENCRYPTION_KEY` = base64 of 32 bytes (id defaults to
 *   `APP_ENCRYPTION_KEY_ID` or `'k1'`).
 * - Rotation: `APP_ENCRYPTION_KEYS` = JSON `[{ "id": "...", "key": "<base64>" }, …]`
 *   and `APP_ENCRYPTION_KEY_ID` selects the active one.
 */
export function credentialVaultFromEnv(env: NodeJS.ProcessEnv): EnvKeyCredentialVault | null {
  const decode = (id: string, b64: string): VaultKey => ({ id, key: Buffer.from(b64, 'base64') });

  if (env.APP_ENCRYPTION_KEYS) {
    let entries: KeyEntry[];
    try {
      entries = JSON.parse(env.APP_ENCRYPTION_KEYS) as KeyEntry[];
    } catch {
      throw new Error('APP_ENCRYPTION_KEYS must be valid JSON.');
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error('APP_ENCRYPTION_KEYS must be a non-empty JSON array.');
    }
    const activeKeyId = env.APP_ENCRYPTION_KEY_ID ?? entries[entries.length - 1]?.id;
    if (!activeKeyId)
      throw new Error('APP_ENCRYPTION_KEY_ID is required with APP_ENCRYPTION_KEYS.');
    return new EnvKeyCredentialVault({
      keys: entries.map((e) => decode(e.id, e.key)),
      activeKeyId,
    });
  }

  if (env.APP_ENCRYPTION_KEY) {
    const id = env.APP_ENCRYPTION_KEY_ID ?? 'k1';
    return new EnvKeyCredentialVault({
      keys: [decode(id, env.APP_ENCRYPTION_KEY)],
      activeKeyId: id,
    });
  }

  return null;
}
