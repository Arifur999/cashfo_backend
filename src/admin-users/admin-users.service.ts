import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { AuthSessionsService } from '../auth/auth-sessions.service.js';
import { CredentialsService } from '../auth/credentials.service.js';
import { ADMIN_USER_WHERE } from '../common/roles.js';
import { PrismaService } from '../prisma/prisma.service.js';
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

  list() {
    return this.prisma.user.findMany({
      where: ADMIN_USER_WHERE,
      select: ADMIN_ACCOUNT_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(dto: CreateAdminDto, creatorId: string, ipAddress?: string) {
    // Any account, not just admins: end users share the table and its unique email.
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const temporaryPassword = dto.temporaryPassword ?? this.generateTempPassword();

    const admin = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { name: dto.name, email: dto.email, role: dto.role, createdBy: creatorId },
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

  async resetPassword(id: string, currentAdminId: string, ipAddress?: string) {
    await this.requireAdmin(id);

    const temporaryPassword = this.generateTempPassword();
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

  private async requireAdmin(id: string) {
    const admin = await this.prisma.user.findUnique({ where: { id, ...ADMIN_USER_WHERE } });
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }
    return admin;
  }

  private generateTempPassword(): string {
    return randomBytes(12).toString('base64url');
  }
}
