import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import type { Role } from '@prisma/client';

// The two token audiences. Each signs with its own secrets, so an admin
// token is never accepted on end-user routes, or the other way round.
export type TokenAudience = 'admin' | 'user';

const AUDIENCE_ENV = {
  admin: { secret: 'JWT_SECRET', refreshSecret: 'JWT_REFRESH_SECRET', ttl: 'JWT_ACCESS_EXPIRES_IN', refreshTtl: 'JWT_REFRESH_EXPIRES_IN' },
  user: { secret: 'USER_JWT_SECRET', refreshSecret: 'USER_JWT_REFRESH_SECRET', ttl: 'USER_JWT_ACCESS_EXPIRES_IN', refreshTtl: 'USER_JWT_REFRESH_EXPIRES_IN' },
} as const satisfies Record<TokenAudience, Record<string, string>>;

// Both tokens name the better-auth session they belong to (sid). Guards and
// refresh() check that session is still alive, so ending it -- logout,
// revoking a device, suspension, a password reset -- signs the device out
// on its very next request, not when the access token happens to expire.
export interface SessionTokenClaims {
  sub: string;
  sid: string;
}

export interface AccessTokenClaims extends SessionTokenClaims {
  // Read by the frontends to pick routes; the backend always re-reads the
  // role from the database.
  role: Role;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class SessionTokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  issue(audience: TokenAudience, claims: AccessTokenClaims): IssuedTokens {
    const { sub, sid } = claims;
    return { accessToken: this.signAccess(audience, claims), refreshToken: this.sign({ sub, sid }, audience, 'refresh') };
  }

  signAccess(audience: TokenAudience, { sub, sid, role }: AccessTokenClaims): string {
    return this.sign({ sub, sid, role }, audience, 'access');
  }

  verifyAccess(audience: TokenAudience, token: string): AccessTokenClaims {
    return this.verify<AccessTokenClaims>(token, audience, 'access', 'Invalid or expired access token');
  }

  verifyRefresh(audience: TokenAudience, token: string): SessionTokenClaims {
    return this.verify<SessionTokenClaims>(token, audience, 'refresh', 'Invalid or expired refresh token');
  }

  private sign(payload: object, audience: TokenAudience, kind: 'access' | 'refresh'): string {
    const env = AUDIENCE_ENV[audience];
    const fallbackTtl = kind === 'access' ? '15m' : '7d';
    return this.jwt.sign(payload, {
      secret: this.config.getOrThrow<string>(kind === 'access' ? env.secret : env.refreshSecret),
      // Env vars are plain strings; jsonwebtoken types expiresIn as the `ms`
      // package's branded StringValue. "15m"/"7d" parse fine at runtime.
      expiresIn: (this.config.get<string>(kind === 'access' ? env.ttl : env.refreshTtl) ?? fallbackTtl) as JwtSignOptions['expiresIn'],
    });
  }

  private verify<TClaims extends SessionTokenClaims>(token: string, audience: TokenAudience, kind: 'access' | 'refresh', message: string): TClaims {
    const env = AUDIENCE_ENV[audience];
    let claims: TClaims;
    try {
      claims = this.jwt.verify<TClaims>(token, { secret: this.config.getOrThrow<string>(kind === 'access' ? env.secret : env.refreshSecret) });
    } catch {
      throw new UnauthorizedException(message);
    }
    // Tokens from before sessions carried a sid can't be tied to a device;
    // their owner simply signs in again.
    if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string') {
      throw new UnauthorizedException(message);
    }
    return claims;
  }
}
