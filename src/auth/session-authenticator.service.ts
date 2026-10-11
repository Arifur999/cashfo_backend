import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { AuthSessionsService } from './auth-sessions.service.js';
import { SessionTokensService, type TokenAudience } from './session-tokens.service.js';

export interface AuthenticatedSession {
  user: User;
  sessionId: string;
}

// Prefer the Authorization header (both frontends forward their
// httpOnly-cookie token that way), falling back to a same-origin cookie.
const extractAccessToken = (request: Request): string | undefined => {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length);
  return (request as Request & { cookies?: Record<string, string> }).cookies?.accessToken;
};

// The part of authentication both sides share: a valid access token for the
// audience, pointing at a live session that belongs to the token's user.
// Role and status rules stay with each guard.
@Injectable()
export class SessionAuthenticator {
  constructor(
    private readonly tokens: SessionTokensService,
    private readonly sessions: AuthSessionsService,
  ) {}

  async authenticate(audience: TokenAudience, request: Request): Promise<AuthenticatedSession> {
    const token = extractAccessToken(request);
    if (!token) throw new UnauthorizedException('Access token missing');

    const { sub, sid } = this.tokens.verifyAccess(audience, token);
    const session = await this.sessions.findActive(sid);
    if (!session || session.userId !== sub) {
      throw new UnauthorizedException('This session has been signed out');
    }
    return { user: session.user, sessionId: session.id };
  }
}
