/**
 * CredentialVault port (spec 08 §3).
 *
 * Authenticated, key-rotatable encryption for the highest-value secret in the
 * system — business Connection credentials. The interface is provider-agnostic so
 * a roadmap KMS/secret-manager adapter (AWS KMS, Vault) drops in unchanged; M1
 * ships the `EnvKeyCredentialVault` adapter in `@evidata/secrets`.
 *
 * Plaintext credentials exist only transiently at encrypt time and at execution
 * time inside the executor — never in API responses, Evidence, errors, or logs.
 */

/** An opaque, self-describing encrypted blob (all binary fields base64). Stored as
 *  the Connection's `credential_blob`; `keyId`/`v` allow key rotation. */
export interface EncryptedSecret {
  /** Scheme version, for forward migration. */
  v: number;
  /** Which key encrypted this blob — lets decryption select the key on rotation. */
  keyId: string;
  /** Per-encryption random IV (96-bit for AES-GCM). */
  iv: string;
  ciphertext: string;
  /** GCM authentication tag (128-bit) — detects tampering / wrong AAD. */
  authTag: string;
}

export interface CredentialVault {
  /** Encrypt `plaintext`, binding it to `aad` (the Connection id) so a blob cannot
   *  be swapped between Connections without the auth check failing. */
  encrypt(plaintext: string, aad: string): EncryptedSecret;
  /** Decrypt `secret`; throws if the auth tag or `aad` does not verify. */
  decrypt(secret: EncryptedSecret, aad: string): string;
}
