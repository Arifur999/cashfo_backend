// Wrong vault passwords, counted per person (User.vaultUnlockFailures and
// vaultUnlockFailedAt): ten in a ten-minute window that starts at the first
// wrong one, then no unlock at all -- not even with the right password --
// until the window ends. The lock screen shows the tries left.

export const UNLOCK_MAX_TRIES = 10;
export const UNLOCK_WINDOW_MS = 10 * 60 * 1000;

export interface UnlockFailures {
  vaultUnlockFailures: number;
  vaultUnlockFailedAt: Date | null;
}

export interface UnlockState {
  // Wrong tries still counting (0 once the window has ended).
  failures: number;
  triesLeft: number;
  lockedOut: boolean;
  // Seconds until the window ends (0 when locked out no longer applies).
  retryAfterSec: number;
}

// The window's start, before which a recorded failure no longer counts.
export const windowStartBefore = (now: Date): Date => new Date(now.getTime() - UNLOCK_WINDOW_MS);

export function unlockState(row: UnlockFailures, now: Date): UnlockState {
  const startedAt = row.vaultUnlockFailedAt;
  const live = !!startedAt && startedAt.getTime() > now.getTime() - UNLOCK_WINDOW_MS;
  const failures = live ? row.vaultUnlockFailures : 0;
  const triesLeft = Math.max(0, UNLOCK_MAX_TRIES - failures);
  const lockedOut = live && triesLeft === 0;
  const retryAfterSec = lockedOut && startedAt ? Math.max(1, Math.ceil((startedAt.getTime() + UNLOCK_WINDOW_MS - now.getTime()) / 1000)) : 0;
  return { failures, triesLeft, lockedOut, retryAfterSec };
}

// VAULT_TOKEN_EXPIRES_IN in seconds: a plain number of seconds or a jsonwebtoken
// span like "90s", "10m", "1h". Anything else is the 10 minutes it defaults to.
export function expiresInSeconds(raw: string | undefined): number {
  const match = /^(\d+)\s*(s|m|h|d)?$/.exec((raw ?? '').trim());
  if (!match) return 10 * 60;
  const n = Number(match[1]);
  const unit = match[2] ?? 's';
  const seconds = n * (unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400);
  return seconds > 0 ? seconds : 10 * 60;
}

export const VAULT_LOCK_MIN_MINUTES = 1;
export const VAULT_LOCK_MAX_MINUTES = 30;

// How long one unlock lasts: the person's own choice (1-30 minutes), never
// longer than the server allows.
export function effectiveLockSeconds(lockMinutes: number | null | undefined, serverSeconds: number): number {
  if (lockMinutes === null || lockMinutes === undefined) return serverSeconds;
  return Math.min(lockMinutes * 60, serverSeconds);
}
