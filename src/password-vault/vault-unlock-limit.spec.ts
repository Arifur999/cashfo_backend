import { effectiveLockSeconds, expiresInSeconds, UNLOCK_WINDOW_MS, unlockState, windowStartBefore } from './vault-unlock-limit.js';

const now = new Date('2026-10-28T10:00:00.000Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

describe('unlockState', () => {
  it('starts with ten tries', () => {
    expect(unlockState({ vaultUnlockFailures: 0, vaultUnlockFailedAt: null }, now)).toEqual({ failures: 0, triesLeft: 10, lockedOut: false, retryAfterSec: 0 });
  });

  it('counts the wrong tries inside the window', () => {
    expect(unlockState({ vaultUnlockFailures: 1, vaultUnlockFailedAt: ago(1000) }, now).triesLeft).toBe(9);
  });

  it('locks out at ten until the window that began at the first failure ends', () => {
    const state = unlockState({ vaultUnlockFailures: 10, vaultUnlockFailedAt: ago(4 * 60 * 1000) }, now);
    expect(state).toEqual({ failures: 10, triesLeft: 0, lockedOut: true, retryAfterSec: 6 * 60 });
  });

  it('forgets failures once the window has passed', () => {
    expect(unlockState({ vaultUnlockFailures: 10, vaultUnlockFailedAt: ago(UNLOCK_WINDOW_MS) }, now)).toEqual({
      failures: 0,
      triesLeft: 10,
      lockedOut: false,
      retryAfterSec: 0,
    });
  });

  it('puts the window start ten minutes back', () => {
    expect(windowStartBefore(now).toISOString()).toBe('2026-10-28T09:50:00.000Z');
  });
});

describe('lock time', () => {
  it('reads VAULT_TOKEN_EXPIRES_IN', () => {
    expect(expiresInSeconds('10m')).toBe(600);
    expect(expiresInSeconds('90s')).toBe(90);
    expect(expiresInSeconds('1h')).toBe(3600);
    expect(expiresInSeconds('300')).toBe(300);
    expect(expiresInSeconds(undefined)).toBe(600);
    expect(expiresInSeconds('soon')).toBe(600);
    expect(expiresInSeconds('0m')).toBe(600);
  });

  it("uses the person's minutes, capped by the server", () => {
    expect(effectiveLockSeconds(null, 600)).toBe(600);
    expect(effectiveLockSeconds(5, 600)).toBe(300);
    expect(effectiveLockSeconds(30, 600)).toBe(600);
    expect(effectiveLockSeconds(30, 3600)).toBe(1800);
  });
});
