import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SessionTokensService } from '../auth/session-tokens.service.js';
import { unlockTokens, WorkspaceUnlockService } from './workspace-unlock.service.js';

const env: Record<string, string> = { USER_JWT_SECRET: 'user-access', USER_JWT_REFRESH_SECRET: 'user-refresh' };
const config = {
  get: (key: string) => env[key],
  getOrThrow: (key: string) => env[key],
} as unknown as ConfigService;

const jwt = new JwtService({});
const unlocks = new WorkspaceUnlockService(jwt, config);
const { unlockToken } = unlocks.issue('user-1', 'session-1', 'biz-1', 'pin-hash');

describe('WorkspaceUnlockService', () => {
  it('opens the workspace it was issued for', () => {
    expect(unlocks.opens(unlockToken, 'user-1', 'session-1', 'biz-1', 'pin-hash')).toBe(true);
  });

  it('is tied to the user, the session, the workspace and the PIN', () => {
    expect(unlocks.opens(unlockToken, 'user-2', 'session-1', 'biz-1', 'pin-hash')).toBe(false);
    expect(unlocks.opens(unlockToken, 'user-1', 'session-2', 'biz-1', 'pin-hash')).toBe(false);
    expect(unlocks.opens(unlockToken, 'user-1', 'session-1', 'biz-2', 'pin-hash')).toBe(false);
    expect(unlocks.opens(unlockToken, 'user-1', 'session-1', 'biz-1', 'new-pin-hash')).toBe(false);
  });

  it('opens nothing without a token, or with an access token', () => {
    const { accessToken } = new SessionTokensService(jwt, config).issue('user', { sub: 'user-1', sid: 'session-1', role: 'USER' });
    expect(unlocks.opens(undefined, 'user-1', 'session-1', 'biz-1', 'pin-hash')).toBe(false);
    expect(unlocks.opens(accessToken, 'user-1', 'session-1', 'biz-1', 'pin-hash')).toBe(false);
  });

  it('is never accepted as an access token', () => {
    expect(() => new SessionTokensService(jwt, config).verifyAccess('user', unlockToken)).toThrow();
  });
});

describe('reads across workspaces', () => {
  const owner = { id: 'user-1', sessionId: 'session-1' };

  it('splits the unlocks one header carries', () => {
    expect(unlockTokens(' a, b ,,c')).toEqual(['a', 'b', 'c']);
    expect(unlockTokens(['a,b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(unlockTokens(undefined)).toEqual([]);
  });

  it('keeps a PIN-locked workspace shut without its unlock', () => {
    expect(unlocks.isShut(owner, { id: 'biz-1', pinHash: 'pin-hash' }, [])).toBe(true);
    expect(unlocks.isShut(owner, { id: 'biz-1', pinHash: 'pin-hash' }, ['junk', unlockToken])).toBe(false);
    expect(unlocks.isShut(owner, { id: 'biz-2', pinHash: 'pin-hash' }, [unlockToken])).toBe(true);
  });

  it("never shuts a workspace without a PIN, nor for a super admin's read-only view", () => {
    expect(unlocks.isShut(owner, { id: 'biz-1', pinHash: null }, [])).toBe(false);
    expect(unlocks.isShut({ ...owner, impersonatedBy: 'admin-1' }, { id: 'biz-1', pinHash: 'pin-hash' }, [])).toBe(false);
  });
});
