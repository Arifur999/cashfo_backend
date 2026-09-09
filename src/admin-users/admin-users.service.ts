import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateAdminDto } from './dto/create-admin.dto.js';
import { UpdateAdminDto } from './dto/update-admin.dto.js';

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  // Minimal read used to populate "assign to admin" / filter dropdowns
  // (Prompt 6 tickets) -- open to any authenticated admin, unlike list()
  // below which is SUPER_ADMIN only per Prompt 8's admin-management scope.
  listAssignable() {
    return this.prisma.adminUser.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });
  }

  list() {
    return this.prisma.adminUser.findMany({
      select: { id: true, name: true, email: true, role: true, status: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(dto: CreateAdminDto, creatorId: string, ipAddress?: string) {
    const existing = await this.prisma.adminUser.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('An admin with this email already exists');
    }

    const temporaryPassword = dto.temporaryPassword ?? this.generateTempPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    const admin = await this.prisma.adminUser.create({
      data: { name: dto.name, email: dto.email, role: dto.role, passwordHash, createdBy: creatorId },
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

    const result = await this.prisma.adminUser.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.role !== undefined && { role: dto.role }),
      },
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

    const result = await this.prisma.adminUser.update({ where: { id }, data: { status: 'SUSPENDED' } });

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

    return result;
  }

  async resetPassword(id: string, currentAdminId: string, ipAddress?: string) {
    await this.requireAdmin(id);

    const temporaryPassword = this.generateTempPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    await this.prisma.adminUser.update({ where: { id }, data: { passwordHash } });

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
    const admin = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }
    return admin;
  }

  private generateTempPassword(): string {
    return randomBytes(12).toString('base64url');
  }
}
