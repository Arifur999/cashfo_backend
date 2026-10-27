import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthSessionsService, type ClientInfo } from '../auth/auth-sessions.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { parseDeviceLabel } from './device-label.js';
import { SecurityAlertsService } from './security-alerts.service.js';

// Settings > Security: the devices an end user is signed in on, and their
// login history. A device is a better-auth session -- which alone decides
// whether it is still signed in -- plus a UserSession row keyed by that
// session's id (jti). The row keeps the device label and stays behind after
// sign-out, for the history and the admin analytics built on it.
@Injectable()
export class UserSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AuthSessionsService,
    private readonly alerts: SecurityAlertsService,
  ) {}

  // One session can be exchanged for tokens more than once (a reloaded
  // Google sign-in page), and it is still one device: a second record only
  // touches it. A row created here is a sign-in on a device, which the
  // security alerts look at once the sign-in has answered (a new device;
  // the signup's verification email).
  async record(userId: string, sessionId: string, { ipAddress, userAgent }: ClientInfo): Promise<void> {
    const existing = await this.prisma.userSession.findUnique({ where: { jti: sessionId }, select: { id: true } });
    if (existing) {
      await this.prisma.userSession.update({ where: { id: existing.id }, data: { lastUsedAt: new Date() } });
      return;
    }
    try {
      const created = await this.prisma.userSession.create({
        data: { userId, jti: sessionId, deviceLabel: parseDeviceLabel(userAgent), ipAddress: ipAddress ?? 'unknown', userAgent },
      });
      this.alerts.afterNewSession(created);
    } catch (error) {
      // Two exchanges of the same session racing: the other one created it.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      await this.prisma.userSession.updateMany({ where: { jti: sessionId }, data: { lastUsedAt: new Date() } });
    }
  }

  async touch(sessionId: string): Promise<void> {
    await Promise.all([
      this.sessions.touch(sessionId),
      this.prisma.userSession.updateMany({ where: { jti: sessionId }, data: { lastUsedAt: new Date() } }),
    ]);
  }

  // Signs one device out; its tokens stop working on their next request.
  async end(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
    await this.prisma.userSession.updateMany({ where: { jti: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async endAllExcept(userId: string, keepSessionId: string): Promise<void> {
    await this.sessions.revokeOthersForUser(userId, keepSessionId);
    await this.prisma.userSession.updateMany({ where: { userId, revokedAt: null, jti: { not: keepSessionId } }, data: { revokedAt: new Date() } });
  }

  async endAll(userId: string): Promise<void> {
    await this.sessions.revokeAllForUser(userId);
    await this.prisma.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  // Every device still signed in, most recently used first. isCurrent is
  // exact: the request's own token names its session.
  async list(userId: string, currentSessionId: string) {
    const live = await this.prisma.authSession.findMany({ where: { userId, expiresAt: { gt: new Date() } }, select: { id: true } });
    const devices = await this.prisma.userSession.findMany({
      where: { userId, revokedAt: null, jti: { in: live.map((session) => session.id) } },
      orderBy: { lastUsedAt: 'desc' },
    });
    return devices.map((device) => ({
      id: device.id,
      deviceLabel: device.deviceLabel,
      ipAddress: device.ipAddress,
      createdAt: device.createdAt,
      lastUsedAt: device.lastUsedAt,
      isCurrent: device.jti === currentSessionId,
    }));
  }

  async revoke(userId: string, deviceId: string) {
    const device = await this.prisma.userSession.findUnique({ where: { id: deviceId } });
    if (!device || device.userId !== userId) {
      throw new NotFoundException('Session not found');
    }
    await this.end(device.jti);
    return { success: true };
  }

  // Settings > Security's "History" list -- every login attempt (success
  // AND failure) recorded against this account's email, most recent first.
  // Keyed by email rather than userId because LoginAttempt also records
  // attempts against emails that never resolve to a real user (login()'s
  // account_not_found case) -- so the whole table is email-keyed, including
  // the rows that DO belong to a real account.
  async loginHistory(email: string) {
    const attempts = await this.prisma.loginAttempt.findMany({
      where: { email },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return attempts.map((a) => ({
      id: a.id,
      ipAddress: a.ipAddress,
      deviceLabel: parseDeviceLabel(a.userAgent),
      success: a.success,
      failureReason: a.failureReason,
      createdAt: a.createdAt,
    }));
  }
}
