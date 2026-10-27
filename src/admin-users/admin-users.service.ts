import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthSessionsService } from '../auth/auth-sessions.service.js';
import { CredentialsService } from '../auth/credentials.service.js';
import { ADMIN_USER_WHERE } from '../common/roles.js';
import { generateTempPassword } from '../common/temp-password.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TwoStepService } from '../two-step/two-step.service.js';
import { CreateAdminDto } from './dto/create-admin.dto.js';
import { UpdateAdminDto } from './dto/update-admin.dto.js';

// What the admin panel sees of an admin account. Admins are User rows, so a
// bare row would also carry end-user columns (vault hash, referral code...).
const ADMIN_ACCOUNT_SELECT = { id: true, name: true, email: true, role: true, status: true, lastLoginAt: true, createdAt: true } as const;

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
    private readonly sessions: AuthSessionsService,
    private readonly twoStep: TwoStepService,
  ) {}

  // Minimal read used to populate "assign to admin" / filter dropdowns
  // (Prompt 6 tickets) -- open to any authenticated admin, unlike list()
  // below which is SUPER_ADMIN only per Prompt 8's admin-management scope.
  listAssignable() {
    return this.prisma.user.findMany({
      where: { ...ADMIN_USER_WHERE, status: 'ACTIVE' },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });
  }

  // Each admin with whether they use two-step sign-in (Admin team's
  // "Two-step" column and "Only 2 of 5 admins use two-step sign-in").
  async list() {
    const admins = await this.prisma.user.findMany({
      where: ADMIN_USER_WHERE,
      select: { ...ADMIN_ACCOUNT_SELECT, twoFactor: { select: { enabledAt: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return admins.map(({ twoFactor, ...admin }) => ({ ...admin, twoFactorEnabled: Boolean(twoFactor?.enabledAt) }));
  }

  async create(dto: CreateAdminDto, creatorId: string, ipAddress?: string) {
    // Any account, not just admins: end users share the table and its unique email.
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const temporaryPassword = dto.temporaryPassword ?? generateTempPassword();

    const admin = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        // Vouched for by the super admin creating it -- which is also what lets
        // better-auth link this address's Google sign-in to the account.
        data: { name: dto.name, email: dto.email, role: dto.role, createdBy: creatorId, emailVerified: true },
      });
      await this.credentials.set(created.id, temporaryPassword, tx);
      return created;
    });

    await this.prisma.auditLog.create({
      data: {
        adminUserId: creatorId,
        action: 'ADMIN_ACCOUNT_CREATED',
        entityType: 'AdminUser',
        entityId: admin.id,
        newValue: { name: admin.name, email: admin.email, role: admin.role },
        ipAddress,
      },
    });

    // Same one-time-reveal pattern as PlatformUsersService.resetPassword --
    // the value itself is never written to the audit log.
    return { id: admin.id, name: admin.name, email: admin.email, role: admin.role, temporaryPassword };
  }

  async update(id: string, dto: UpdateAdminDto, currentAdminId: string, ipAddress?: string) {
    const admin = await this.requireAdmin(id);

    // Prevent accidental self-lockout: an admin editing their own account
    // can still rename themselves, just not change their own role.
    if (dto.role !== undefined && id === currentAdminId) {
      throw new BadRequestException('You cannot change your own role.');
    }

    const result = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.role !== undefined && { role: dto.role }),
      },
      select: ADMIN_ACCOUNT_SELECT,
    });

    await this.prisma.auditLog.create({
      data: {
        adminUserId: currentAdminId,
        action: 'ADMIN_ACCOUNT_UPDATED',
        entityType: 'AdminUser',
        entityId: id,
        oldValue: { name: admin.name, role: admin.role },
        newValue: { name: result.name, role: result.role },
        ipAddress,
      },
    });

    return result;
  }

  async suspend(id: string, currentAdminId: string, ipAddress?: string) {
    if (id === currentAdminId) {
      throw new BadRequestException('You cannot suspend your own account.');
    }
    const admin = await this.requireAdmin(id);

    const result = await this.prisma.user.update({ where: { id }, data: { status: 'SUSPENDED' }, select: ADMIN_ACCOUNT_SELECT });

    await this.prisma.auditLog.create({
      data: {
        adminUserId: currentAdminId,
        action: 'ADMIN_ACCOUNT_SUSPENDED',
        entityType: 'AdminUser',
        entityId: id,
        oldValue: { status: admin.status },
        newValue: { status: result.status },
        ipAddress,
      },
    });

    // Signed out everywhere at once, not just refused on the next request.
    await this.sessions.revokeAllForUser(id);
    return result;
  }

  // The way back from suspend(): until now a suspended admin's email was
  // lost to the team for good (it can't be created again) short of a manual
  // database edit.
  async activate(id: string, currentAdminId: string, ipAddress?: string) {
    const admin = await this.requireAdmin(id);
    if (admin.status === 'ACTIVE') {
      return this.prisma.user.findUniqueOrThrow({ where: { id }, select: ADMIN_ACCOUNT_SELECT });
    }

    const result = await this.prisma.user.update({ where: { id }, data: { status: 'ACTIVE' }, select: ADMIN_ACCOUNT_SELECT });
    await this.prisma.auditLog.create({
      data: {
        adminUserId: currentAdminId,
        action: 'ADMIN_ACCOUNT_ACTIVATED',
        entityType: 'AdminUser',
        entityId: id,
        oldValue: { status: admin.status },
        newValue: { status: result.status },
        ipAddress,
      },
    });
    return result;
  }

  async resetPassword(id: string, currentAdminId: string, ipAddress?: string) {
    await this.requireAdmin(id);

    const temporaryPassword = generateTempPassword();
    await this.credentials.set(id, temporaryPassword);
    // Whoever was signed in with the old password is signed out.
    await this.sessions.revokeAllForUser(id);

    await this.prisma.auditLog.create({
      data: {
        adminUserId: currentAdminId,
        action: 'PASSWORD_RESET_BY_ADMIN',
        entityType: 'AdminUser',
        entityId: id,
        newValue: { note: 'Temporary password generated and shown to admin once; value not logged.' },
        ipAddress,
      },
    });

    return { temporaryPassword };
  }

  // AdminForgotPassword: "a super admin can set a new password for you" --
  // one the super admin chooses (resetPassword above generates one). The
  // admin is signed out everywhere; the password itself is never logged.
  async setPassword(id: string, password: string, currentAdminId: string, ipAddress?: string) {
    if (id === currentAdminId) {
      throw new BadRequestException('Change your own password from My account.');
    }
    await this.requireAdmin(id);
    await this.credentials.set(id, password);
    await this.sessions.revokeAllForUser(id);
    await this.prisma.auditLog.create({
      data: {
        adminUserId: currentAdminId,
        action: 'ADMIN_PASSWORD_SET_BY_ADMIN',
        entityType: 'AdminUser',
        entityId: id,
        newValue: { note: 'New password chosen by a super admin; value not logged.' },
        ipAddress,
      },
    });
    return { success: true };
  }

  // "Turn off two-step" for an admin who lost their phone and backup codes.
  // Not for yourself (My account does that, with your password and a code).
  // The admin is signed out everywhere; if two-step is required for every
  // admin, their next sign-in sets it up again.
  async disableTwoStep(id: string, currentAdminId: string, ipAddress?: string) {
    if (id === currentAdminId) {
      throw new BadRequestException('Turn off your own two-step sign-in from My account.');
    }
    await this.requireAdmin(id);
    if (!(await this.twoStep.removeAll(id))) {
      throw new ConflictException('Two-step sign-in is already off for this admin.');
    }
    await this.sessions.revokeAllForUser(id);
    await this.prisma.auditLog.create({
      data: {
        adminUserId: currentAdminId,
        action: 'ADMIN_TWO_STEP_DISABLED',
        entityType: 'AdminUser',
        entityId: id,
        newValue: { by: 'super_admin' },
        ipAddress,
      },
    });
    return { success: true };
  }

  private async requireAdmin(id: string) {
    const admin = await this.prisma.user.findUnique({ where: { id, ...ADMIN_USER_WHERE } });
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }
    return admin;
  }

}
