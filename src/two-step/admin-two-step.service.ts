import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AdminAuthService } from '../admin-auth/admin-auth.service.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { AuthSessionsService } from '../auth/auth-sessions.service.js';
import { isAdminRole } from '../common/roles.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AdminEnableTwoStepDto, DisableTwoStepDto, RegenerateBackupCodesDto } from './dto/two-step.dto.js';
import type { SetupRequest } from './admin-or-setup-token.guard.js';
import { TwoStepService } from './two-step.service.js';

// The admin side of two-step sign-in: the same TwoStepService as customers
// use, plus an audit entry for every change and the set-up an admin goes
// through before getting in when it is required for everyone.
@Injectable()
export class AdminTwoStepService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly twoStep: TwoStepService,
    private readonly sessions: AuthSessionsService,
    private readonly adminAuth: AdminAuthService,
  ) {}

  status(adminId: string, trustedHeader?: string | string[]) {
    return this.twoStep.status(adminId, 'admin', trustedHeader);
  }

  // Signed in: the password confirms it. With a set-up token the password
  // was checked moments ago by the sign-in.
  async setup(req: SetupRequest, password?: string) {
    if (req.twoStepSetupUserId) {
      const admin = await this.requireActiveAdmin(req.twoStepSetupUserId);
      return this.twoStep.startSetup(admin, 'admin', null);
    }
    const admin = req.adminUser!;
    return this.twoStep.startSetup(admin, 'admin', { password, sessionId: admin.sessionId });
  }

  // Signed in: {backupCodes}. With a set-up token: the backup codes and the
  // admin's tokens, as a finished sign-in -- {backupCodes, audience,
  // accessToken, refreshToken, account, trustedDeviceToken?}.
  async enable(req: SetupRequest, dto: AdminEnableTwoStepDto) {
    const client = { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
    if (req.twoStepSetupUserId) {
      await this.requireActiveAdmin(req.twoStepSetupUserId);
      const { userId, backupCodes } = await this.twoStep.enableWithSetupToken(dto.setupToken!, dto.code);
      await this.audit(userId, 'ADMIN_TWO_STEP_ENABLED', userId, req.ip, { during: 'sign_in' });
      const admin = await this.requireActiveAdmin(userId);
      const sessionId = await this.sessions.create(userId, client);
      const { accessToken, refreshToken, adminUser } = await this.adminAuth.finishSignIn(admin, sessionId, client);
      const trusted = dto.trustDevice ? await this.twoStep.trustDevice(userId, client) : null;
      return {
        backupCodes,
        audience: 'admin' as const,
        accessToken,
        refreshToken,
        account: adminUser,
        ...(trusted && { trustedDeviceToken: trusted.token, trustedDeviceExpiresAt: trusted.expiresAt }),
      };
    }
    const admin = req.adminUser!;
    const result = await this.twoStep.enable(admin.id, dto.code);
    await this.audit(admin.id, 'ADMIN_TWO_STEP_ENABLED', admin.id, req.ip);
    return result;
  }

  async regenerateBackupCodes(admin: RequestAdminUser, dto: RegenerateBackupCodesDto, ipAddress?: string) {
    const result = await this.twoStep.regenerateBackupCodes(admin.id, { password: dto.password, sessionId: admin.sessionId }, dto.code);
    await this.audit(admin.id, 'ADMIN_BACKUP_CODES_REGENERATED', admin.id, ipAddress);
    return result;
  }

  async disable(admin: RequestAdminUser, dto: DisableTwoStepDto, ipAddress?: string) {
    await this.twoStep.disable(admin.id, 'admin', { password: dto.password, sessionId: admin.sessionId }, { code: dto.code, backupCode: dto.backupCode });
    await this.audit(admin.id, 'ADMIN_TWO_STEP_DISABLED', admin.id, ipAddress, { by: 'self' });
    return { success: true };
  }

  async removeTrustedDevice(adminId: string, id: string, ipAddress?: string) {
    await this.twoStep.removeTrustedDevice(adminId, id);
    await this.audit(adminId, 'ADMIN_TRUSTED_DEVICE_REMOVED', adminId, ipAddress, { trustedDeviceId: id });
    return { success: true };
  }

  async removeTrustedDevices(adminId: string, ipAddress?: string) {
    const removed = await this.twoStep.removeTrustedDevices(adminId);
    if (removed > 0) await this.audit(adminId, 'ADMIN_TRUSTED_DEVICE_REMOVED', adminId, ipAddress, { removed });
    return { removed };
  }

  private async requireActiveAdmin(userId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!admin || !isAdminRole(admin.role)) throw new UnauthorizedException('Admin no longer exists');
    if (admin.status !== 'ACTIVE') throw new ForbiddenException('This account has been suspended');
    return admin;
  }

  private async audit(adminId: string, action: string, entityId: string, ipAddress?: string, newValue?: Prisma.InputJsonObject) {
    await this.prisma.auditLog.create({ data: { adminUserId: adminId, action, entityType: 'AdminUser', entityId, newValue, ipAddress } });
  }
}
