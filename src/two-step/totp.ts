import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Time-based one-time codes, RFC 6238 over RFC 4226: HMAC-SHA-1, 6 digits,
// 30-second steps. What Google Authenticator, Microsoft Authenticator and
// the rest show by default.
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SEC = 30;
// A code from the step before or after the current one still counts:
// a phone clock a little off, or a code typed just as it changed.
export const TOTP_WINDOW = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

// Accepts the key as people type it: any case, spaces, '=' padding.
export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error('Not a base32 key');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// A new 160-bit secret (RFC 4226's recommended length), as base32.
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

// "JBSWY3DPEHPK3PXP" -> "JBSW Y3DP EHPK 3PXP", for typing it by hand.
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, '$1 ');
}

export function totpStep(now: Date | number): number {
  return Math.floor((typeof now === 'number' ? now : now.getTime()) / 1000 / TOTP_PERIOD_SEC);
}

export function hotp(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** TOTP_DIGITS;
  return binary.toString().padStart(TOTP_DIGITS, '0');
}

export function totpAt(secret: string, now: Date | number): string {
  return hotp(base32Decode(secret), totpStep(now));
}

// The step a typed code matches, within the window, or null. A step at or
// before `lastUsedStep` never matches again: each code works once.
export function matchTotp(secret: string, code: string, now: Date | number, lastUsedStep: number | null = null): number | null {
  const typed = code.replace(/\s/g, '');
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(typed)) return null;
  const key = base32Decode(secret);
  const current = totpStep(now);
  for (let step = current - TOTP_WINDOW; step <= current + TOTP_WINDOW; step++) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(typed))) return step;
  }
  return null;
}

// What the QR code on the set-up screen encodes (Key Uri Format):
// otpauth://totp/<issuer>:<account>?secret=...&issuer=...
export function otpauthUrl(issuer: string, account: string, secret: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  // encodeURIComponent, not URLSearchParams: some apps show a '+' for a space.
  const query = Object.entries({ secret, issuer, algorithm: 'SHA1', digits: String(TOTP_DIGITS), period: String(TOTP_PERIOD_SEC) })
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('&');
  return `otpauth://totp/${label}?${query}`;
}
