import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';

// The pure rules of two-step sign-in, kept apart from the database so the
// specs can pin them down.

export const BACKUP_CODE_COUNT = 10;
// No 0/o, 1/l/i: a code copied off paper must read back the same.
const BACKUP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

// A pending second step lives this long, and allows this many wrong codes.
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
// An admin who must turn two-step on first gets longer: installing an app
// and scanning the code takes a few minutes.
export const SETUP_TTL_MS = 15 * 60 * 1000;
export const MAX_CHALLENGE_ATTEMPTS = 5;

// "Don't ask again on this computer for 30 days".
export const TRUSTED_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// How many trusted-device tokens one sign-in request may carry (one cookie
// per account that used the computer).
export const MAX_TRUSTED_TOKENS = 10;

// A Google-only account has no password to confirm set-up with; a sign-in
// this recent stands in for it.
export const RECENT_SIGN_IN_MS = 10 * 60 * 1000;

// Ten codes like "k7m2-x9pq".
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    let code = '';
    for (let i = 0; i < 8; i++) code += BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)];
    codes.add(`${code.slice(0, 4)}-${code.slice(4)}`);
  }
  return [...codes];
}

// As typed: any case, with or without the dash or spaces. Null when it
// can't be a backup code at all.
export function normalizeBackupCode(typed: string): string | null {
  const clean = typed.toLowerCase().replace(/[\s-]/g, '');
  return /^[a-z0-9]{8}$/.test(clean) ? clean : null;
}

// Keyed by a server secret (the pepper) and the account, so a copy of the
// table alone can't be searched for codes, and one code's hash is no use
// on another account.
export function hashBackupCode(pepper: Buffer, userId: string, normalized: string): string {
  return createHmac('sha256', pepper).update(`${userId}:${normalized}`).digest('hex');
}

export function newDeviceToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// The tokens a sign-in request carries in x-trusted-device: one per account
// that trusted this computer, comma-separated.
export function parseTrustedTokens(header: string | string[] | undefined): string[] {
  const raw = Array.isArray(header) ? header.join(',') : (header ?? '');
  return raw
    .split(',')
    .map((token) => token.trim())
    .filter((token) => /^[A-Za-z0-9_-]{20,200}$/.test(token))
    .slice(0, MAX_TRUSTED_TOKENS);
}

export type ChallengeProblem = 'CHALLENGE_EXPIRED' | 'TOO_MANY_ATTEMPTS';

// Why a challenge can no longer be answered, or null while it can.
export function challengeProblem(row: { expiresAt: Date; consumedAt: Date | null; attempts: number }, now: Date): ChallengeProblem | null {
  if (row.consumedAt || row.expiresAt <= now) return 'CHALLENGE_EXPIRED';
  if (row.attempts >= MAX_CHALLENGE_ATTEMPTS) return 'TOO_MANY_ATTEMPTS';
  return null;
}

export const TWO_STEP_MESSAGES = {
  CHALLENGE_EXPIRED: 'This sign-in has timed out. Please sign in again.',
  TOO_MANY_ATTEMPTS: 'Too many wrong codes. Please sign in again.',
  CODE_WRONG: "That code didn't work. Check the app and try again.",
  BACKUP_CODE_WRONG: "That backup code didn't work, or it was used already.",
} as const;
