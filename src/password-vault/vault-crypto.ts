import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM, one random IV per call. Output format is
// "<iv-hex>:<authTag-hex>:<ciphertext-hex>" -- self-contained, no extra
// column needed to store the IV/tag separately. VAULT_ENCRYPTION_KEY must be
// exactly 32 bytes (a 64-char hex string) -- see .env.example.
const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  const hex = process.env.VAULT_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error('VAULT_ENCRYPTION_KEY is not set');
  }
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) {
    throw new Error('VAULT_ENCRYPTION_KEY must decode to exactly 32 bytes (a 64-char hex string)');
  }
  return key;
}

export function encryptVaultSecret(plainText: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decryptVaultSecret(encoded: string): string {
  const [ivHex, authTagHex, ciphertextHex] = encoded.split(':');
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Malformed vault ciphertext');
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]);
  return plaintext.toString('utf8');
}
