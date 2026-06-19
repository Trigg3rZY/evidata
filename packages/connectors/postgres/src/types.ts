import type { PoolConfig } from 'pg';

/**
 * Resolved connection parameters for one Connection. M1.3 takes these directly;
 * M1.6's ConnectionService decrypts the stored credential blob (via the
 * CredentialVault) into `user`/`password` right before constructing the connector,
 * so plaintext lives only here in-process, never on the Connection record.
 *
 * `user` must be a least-privilege **read-only** role (spec 08 §8); the SafetyGate
 * remains the primary control, the read-only role + READ ONLY tx are floors.
 */
export interface PostgresConnectionParams {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  /** TLS config derived from the Connection's sslMode. */
  ssl?: PoolConfig['ssl'];
}

/** Map a stored `sslMode` to node-postgres TLS config (spec 08 §6/§7). */
export function sslFor(sslMode: string): PoolConfig['ssl'] {
  switch (sslMode) {
    case 'disable':
      return false;
    case 'require':
    case 'prefer':
      // Encrypt, but don't verify the chain (self-signed internal DBs are common).
      return { rejectUnauthorized: false };
    case 'verify-ca':
    case 'verify-full':
      return { rejectUnauthorized: true };
    default:
      return false;
  }
}
