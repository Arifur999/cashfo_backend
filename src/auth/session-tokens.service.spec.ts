import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SessionTokensService } from './session-tokens.service.js';

const env: Record<string, string> = {
  JWT_SECRET: 'admin-access',
  JWT_REFRESH_SECRET: 'admin-refresh',
  USER_JWT_SECRET: 'user-access',
  USER_JWT_REFRESH_SECRET: 'user-refresh',
};
const config = {
  get: (key: string) => env[key],
  getOrThrow: (key: string) => {
    if (!env[key]) throw new Error(`missing ${key}`);
    return env[key];
  },
} as unknown as ConfigService;

const jwt = new JwtService({});
const tokens = new SessionTokensService(jwt, config);
const claims = { sub: 'user-1', sid: 'session-1', role: 'SUPER_ADMIN' as const };

describe('SessionTokensService', () => {
  it('round-trips the user, session and role', () => {
    const { accessToken, refreshToken } = tokens.issue('admin', claims);
    expect(tokens.verifyAccess('admin', accessToken)).toMatchObject(claims);
    expect(tokens.verifyRefresh('admin', refreshToken)).toMatchObject({ sub: 'user-1', sid: 'session-1' });
  });

  it('keeps the audiences apart', () => {
    const { accessToken } = tokens.issue('admin', claims);
    expect(() => tokens.verifyAccess('user', accessToken)).toThrow(UnauthorizedException);
  });

  it('names its side in aud', () => {
    const { accessToken, refreshToken } = tokens.issue('user', { ...claims, role: 'USER' });
    expect(jwt.decode<{ aud: string }>(accessToken).aud).toBe('user');
    expect(jwt.decode<{ aud: string }>(refreshToken).aud).toBe('user');
  });

  it('keeps the audiences apart even when both sides share a secret', () => {
    const shared = new SessionTokensService(jwt, {
      get: () => undefined,
      getOrThrow: () => 'one-secret-for-everything',
    } as unknown as ConfigService);
    const { accessToken, refreshToken } = shared.issue('admin', claims);
    expect(() => shared.verifyAccess('user', accessToken)).toThrow(UnauthorizedException);
    expect(() => shared.verifyRefresh('user', refreshToken)).toThrow(UnauthorizedException);
    expect(shared.verifyAccess('admin', accessToken)).toMatchObject(claims);
  });

  it('rejects a token from before tokens named their side', () => {
    const legacy = jwt.sign({ sub: 'user-1', sid: 'session-1', role: 'SUPER_ADMIN' }, { secret: env.JWT_SECRET });
    expect(() => tokens.verifyAccess('admin', legacy)).toThrow(UnauthorizedException);
  });

  it('never accepts a refresh token as an access token', () => {
    const { refreshToken } = tokens.issue('user', { ...claims, role: 'USER' });
    expect(() => tokens.verifyAccess('user', refreshToken)).toThrow(UnauthorizedException);
  });

  it('rejects a token that names no session', () => {
    const legacy = jwt.sign({ sub: 'user-1' }, { secret: env.JWT_SECRET });
    expect(() => tokens.verifyAccess('admin', legacy)).toThrow(UnauthorizedException);
  });

  it('defaults to a 15 minute access token and a 7 day refresh token', () => {
    const { accessToken, refreshToken } = tokens.issue('user', { ...claims, role: 'USER' });
    const lifetime = (token: string) => {
      const { exp, iat } = jwt.decode<{ exp: number; iat: number }>(token);
      return exp - iat;
    };
    expect(lifetime(accessToken)).toBe(15 * 60);
    expect(lifetime(refreshToken)).toBe(7 * 24 * 60 * 60);
  });
});
