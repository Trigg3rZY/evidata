// @evidata/secrets — CredentialVault adapter (AES-256-GCM) for Connection
// credentials (spec 08 §3). The port lives in @evidata/ports.
export { EnvKeyCredentialVault, credentialVaultFromEnv } from './vault';
export type { VaultKey, VaultOptions } from './vault';
