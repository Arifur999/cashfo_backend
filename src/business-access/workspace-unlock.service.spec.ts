import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SessionTokensService } from '../auth/session-tokens.service.js';
import { WorkspaceUnlockService } from './workspace-unlock.service.js';

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
