import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

// A code lasts ten minutes, takes five wrong tries, and can be sent five
// times (a minute apart).
export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const MAX_SENDS = 5;
export const RESEND_AFTER_MS = 60 * 1000;

// Why a code can't be used (or sent again).
export type CodeProblem = 'CODE_USED' | 'CODE_EXPIRED' | 'TOO_MANY_ATTEMPTS' | 'TOO_MANY_SENDS' | 'RESEND_TOO_SOON';

export const CODE_MESSAGES: Record<CodeProblem | 'CODE_WRONG' | 'CHALLENGE_NOT_FOUND', string> = {
  CODE_USED: 'This code was already used. Start again to get a new one.',
  CODE_EXPIRED: 'This code has expired. Start again to get a new one.',
  TOO_MANY_ATTEMPTS: 'Too many wrong codes. Start again to get a new one.',
  TOO_MANY_SENDS: 'The code was sent too many times. Start again to get a new one.',
  RESEND_TOO_SOON: 'Wait a moment before asking for the code again.',
  CODE_WRONG: 'That code is not right.',
  CHALLENGE_NOT_FOUND: 'This confirmation was not found. Start again.',
};

export const generateCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

// Only the hash is stored; salted with the row's own id.
export const hashCode = (code: string, id: string): string => createHash('sha256').update(`${code}${id}`).digest('hex');

export function codeMatches(code: string, id: string, storedHash: string): boolean {
  const given = Buffer.from(hashCode(code, id), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return given.length === stored.length && timingSafeEqual(given, stored);
}

export interface CodeState {
  attempts: number;
  sends: number;
  expiresAt: Date;
  consumedAt: Date | null;
  lastSentAt: Date;
}

// Why a typed code can't be checked at `now`, or null when it can.
export function verifyProblem(row: CodeState, now: Date): CodeProblem | null {
  if (row.consumedAt) return 'CODE_USED';
  if (row.expiresAt <= now) return 'CODE_EXPIRED';
  if (row.attempts >= MAX_ATTEMPTS) return 'TOO_MANY_ATTEMPTS';
  return null;
}

// Why the code can't be sent again at `now`, or null when it can.
export function resendProblem(row: CodeState, now: Date): CodeProblem | null {
  if (row.consumedAt) return 'CODE_USED';
  if (row.attempts >= MAX_ATTEMPTS) return 'TOO_MANY_ATTEMPTS';
  if (row.sends >= MAX_SENDS) return 'TOO_MANY_SENDS';
  if (now.getTime() - row.lastSentAt.getTime() < RESEND_AFTER_MS) return 'RESEND_TOO_SOON';
  return null;
}

// Seconds until the code may be sent again (0 = now).
export const resendAfterSec = (lastSentAt: Date, now: Date): number => Math.max(0, Math.ceil((lastSentAt.getTime() + RESEND_AFTER_MS - now.getTime()) / 1000));
