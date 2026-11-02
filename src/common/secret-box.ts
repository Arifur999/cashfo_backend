import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM with one random IV per call. The output is
// "<iv-hex>:<authTag-hex>:<ciphertext-hex>": self-contained, so no extra
// column holds the IV or tag. Shared by the password vault (VAULT_ENCRYPTION_KEY)
// and two-step sign-in (TWO_FACTOR_ENCRYPTION_KEY, falling back to the vault key).
const ALGORITHM = 'aes-256-gcm';
const AUTH_TAG_BYTES = 16;

// The first of `names` that is set, as a 32-byte key (a 64-character hex
// string). Throws when none is set or the value is the wrong length.
export function keyFromEnv(names: readonly string[], env: NodeJS.ProcessEnv = process.env): Buffer {
  const name = names.find((candidate) => env[candidate]);
  if (!name) {
    throw new Error(`${names.join(' or ')} is not set`);
  }
  const key = Buffer.from(env[name] as string, 'hex');
  if (key.length !== 32) {
    throw new Error(`${name} must decode to exactly 32 bytes (a 64-char hex string)`);
  }
  return key;
}

export function sealSecret(plainText: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function openSecret(encoded: string, key: Buffer): string {
  const [ivHex, authTagHex, ciphertextHex] = encoded.split(':');
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Malformed ciphertext');
  }
  // Only the full 16-byte tag sealSecret() writes: a shorter one would be
  // easier to forge.
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'), { authTagLength: AUTH_TAG_BYTES });
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]).toString('utf8');
}
