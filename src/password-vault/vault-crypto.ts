import { createHash } from 'node:crypto';
import { keyFromEnv, openSecret, sealSecret } from '../common/secret-box.js';

// AES-256-GCM, one random IV per call (common/secret-box.ts). Output format is
// "<iv-hex>:<authTag-hex>:<ciphertext-hex>" -- self-contained, no extra
// column needed to store the IV/tag separately. VAULT_ENCRYPTION_KEY must be
// exactly 32 bytes (a 64-char hex string) -- see .env.example.
const getKey = (): Buffer => keyFromEnv(['VAULT_ENCRYPTION_KEY']);

export function encryptVaultSecret(plainText: string): string {
  return sealSecret(plainText, getKey());
}

// Optional text fields (login, holder name, notes) are stored sealed with a
// prefix, so rows written before they were encrypted still read back as the
// plain text they are.
const SEALED_PREFIX = 'enc:v1:';

export function sealVaultText(plainText: string | null | undefined): string | null | undefined {
  if (plainText === null || plainText === undefined || plainText === '') return plainText;
  return `${SEALED_PREFIX}${encryptVaultSecret(plainText)}`;
}

export function openVaultText(stored: string | null): string | null {
  if (!stored?.startsWith(SEALED_PREFIX)) return stored;
  return decryptVaultSecret(stored.slice(SEALED_PREFIX.length));
}

export function isSealedVaultText(stored: string | null): boolean {
  return !stored || stored.startsWith(SEALED_PREFIX);
}

// A short, non-reversible fingerprint of the vault password hash. Unlock
// tokens carry it, so changing or resetting the vault password ends every
// unlock made with the old one.
export function vaultPasswordFingerprint(vaultPasswordHash: string): string {
  return createHash('sha256').update(vaultPasswordHash).digest('hex').slice(0, 16);
}

export function decryptVaultSecret(encoded: string): string {
  return openSecret(encoded, getKey());
}
