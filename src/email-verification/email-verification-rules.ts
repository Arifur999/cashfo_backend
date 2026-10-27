import { createHash, randomBytes } from 'node:crypto';

// A verification link works once, for a day.
export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

// 256 random bits, so a plain sha256 is enough to store it (like the
// password reset links): the row is found with a unique lookup.
export const newVerifyToken = (): string => randomBytes(32).toString('hex');
export const hashVerifyToken = (rawToken: string): string => createHash('sha256').update(rawToken).digest('hex');

export interface VerifyTokenRow {
  email: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface VerifyTokenOwner {
  email: string;
  status: string;
}

// Whether a link still verifies its address at `now`: unused, in time, and
// for the address the account still has (support may have changed it since
// the link was mailed; the old address proves nothing about the new one).
export function verifyLinkUsable(row: VerifyTokenRow | null, owner: VerifyTokenOwner | null, now: Date): boolean {
  if (!row || row.usedAt || row.expiresAt <= now) return false;
  if (!owner || owner.status === 'DELETED') return false;
  return owner.email === row.email;
}
