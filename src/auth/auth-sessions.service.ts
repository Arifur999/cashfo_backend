import { Inject, Injectable } from '@nestjs/common';
import { isAPIError } from 'better-auth/api';
import { PrismaService } from '../prisma/prisma.service.js';
import { BETTER_AUTH, type Auth } from './better-auth.js';

// The device a request comes from, as the app resolved it (req.ip already
// honours TRUST_PROXY). better-auth stores both on the session row.
export interface ClientInfo {
  ipAddress?: string;
  userAgent?: string;
}

export interface SignedIn {
  userId: string;
  sessionId: string;
}

const clientHeaders = ({ ipAddress, userAgent }: ClientInfo): Headers => {
  const headers = new Headers();
  if (ipAddress) headers.set('x-forwarded-for', ipAddress);
  if (userAgent) headers.set('user-agent', userAgent);
  return headers;
};

// The app's door into better-auth sessions. Admin and end-user sign-ins both
// end in one of these rows; the app's JWTs point at it (see
// SessionTokensService), so deleting it signs that device out.
@Injectable()
export class AuthSessionsService {
  constructor(
    @Inject(BETTER_AUTH) private readonly auth: Auth,
    private readonly prisma: PrismaService,
  ) {}

  // Email + password through better-auth itself, so its hooks and the Infra
  // dashboard see every sign-in. Null when better-auth refuses it: a wrong
  // email or password, or an account its session hook turns away.
  async signInWithPassword(email: string, password: string, client: ClientInfo): Promise<SignedIn | null> {
    try {
      const { token, user } = await this.auth.api.signInEmail({ body: { email, password }, headers: clientHeaders(client) });
      return { userId: user.id, sessionId: await this.idOfToken(token) };
    } catch (error) {
      if (isAPIError(error) && (error.statusCode === 401 || error.statusCode === 403)) return null;
      throw error;
    }
  }

  // A session for someone who has already proven who they are some other
  // way -- just registered, or opened a password-reset link.
  async create(userId: string, { ipAddress, userAgent }: ClientInfo): Promise<string> {
    const { internalAdapter } = await this.auth.$context;
    const session = await internalAdapter.createSession(userId, false, { ipAddress: ipAddress ?? '', userAgent: userAgent ?? '' });
    return session.id;
  }

  // The session a token points at, while it exists and hasn't expired.
  async findActive(sessionId: string) {
    const session = await this.prisma.authSession.findUnique({ where: { id: sessionId } });
    return session && session.expiresAt > new Date() ? session : null;
  }

  // Marks the session as just used -- Device Management's "last active".
  async touch(sessionId: string): Promise<void> {
    await this.prisma.authSession.updateMany({ where: { id: sessionId }, data: { updatedAt: new Date() } });
  }

  async revoke(sessionId: string): Promise<void> {
    const session = await this.prisma.authSession.findUnique({ where: { id: sessionId }, select: { token: true } });
    if (!session) return;
    const { internalAdapter } = await this.auth.$context;
    await internalAdapter.deleteSession(session.token);
  }

  // Signs a user out on every device: suspension, an admin password reset.
  async revokeAllForUser(userId: string): Promise<void> {
    const { internalAdapter } = await this.auth.$context;
    await internalAdapter.deleteUserSessions(userId);
  }

  private async idOfToken(token: string): Promise<string> {
    const { id } = await this.prisma.authSession.findUniqueOrThrow({ where: { token }, select: { id: true } });
    return id;
  }
}
