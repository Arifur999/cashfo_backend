import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Prisma, PlatformUserStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChangePlanDto } from './dto/change-plan.dto.js';
import { ListPlatformUsersQueryDto, SORTABLE_FIELDS } from './dto/list-platform-users-query.dto.js';
import { SuspendUserDto } from './dto/suspend-user.dto.js';
import { BanUserDto } from './dto/ban-user.dto.js';

const SEARCHABLE_FIELDS = ['name', 'email'] as const;

@Injectable()
export class PlatformUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async list(query: ListPlatformUsersQueryDto) {
    const page = query.page ?? 1;
    // 10 (not a rounder 20/25) so the 18 seeded rows visibly span two pages
    // out of the box, without needing to tweak the URL to see pagination work.
    const limit = query.limit ?? 10;

    const where: Prisma.PlatformUserWhereInput = {};
    if (query.search) {
      where.OR = SEARCHABLE_FIELDS.map((field) => ({
        [field]: { contains: query.search, mode: 'insensitive' as const },
      }));
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.planId) {
      where.planId = query.planId;
    }

    const sortBy = query.sortBy ?? '-createdAt';
    const descending = sortBy.startsWith('-');
    const sortField = descending ? sortBy.slice(1) : sortBy;
    const orderBy: Prisma.PlatformUserOrderByWithRelationInput = SORTABLE_FIELDS.includes(sortField as any)
      ? { [sortField]: descending ? 'desc' : 'asc' }
      : { createdAt: 'desc' };

    const [data, total] = await Promise.all([
      this.prisma.platformUser.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: { plan: { select: { id: true, name: true, slug: true } } },
      }),
      this.prisma.platformUser.count({ where }),
    ]);

    return { data, meta: { page, limit, total, totalPage: Math.ceil(total / limit) } };
  }

  async getById(id: string) {
    const user = await this.prisma.platformUser.findUnique({
      where: { id },
      include: { plan: { select: { id: true, name: true, slug: true } } },
    });
    if (!user) {
      throw new NotFoundException('Platform user not found');
    }

    const activityLog = await this.prisma.auditLog.findMany({
      where: { entityType: 'PlatformUser', entityId: id },
      orderBy: { createdAt: 'desc' },
      include: { adminUser: { select: { id: true, name: true } } },
    });

    return { ...user, activityLog };
  }

  async suspend(id: string, dto: SuspendUserDto, adminId: string, ipAddress?: string) {
    const user = await this.requireUser(id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.platformUser.update({
        where: { id },
        data: { status: PlatformUserStatus.SUSPENDED, suspendedAt: new Date(), suspendedReason: dto.reason },
      });
      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'USER_SUSPENDED',
          entityType: 'PlatformUser',
          entityId: id,
          oldValue: { status: user.status },
          newValue: { status: PlatformUserStatus.SUSPENDED, reason: dto.reason },
          ipAddress,
        },
      });
      return result;
    });

    return updated;
  }

  async activate(id: string, adminId: string, ipAddress?: string) {
    const user = await this.requireUser(id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.platformUser.update({
        where: { id },
        data: { status: PlatformUserStatus.ACTIVE, suspendedAt: null, suspendedReason: null },
      });
      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'USER_ACTIVATED',
          entityType: 'PlatformUser',
          entityId: id,
          oldValue: { status: user.status },
          newValue: { status: PlatformUserStatus.ACTIVE },
          ipAddress,
        },
      });
      return result;
    });

    return updated;
  }

  async ban(id: string, dto: BanUserDto, adminId: string, ipAddress?: string) {
    const user = await this.requireUser(id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.platformUser.update({
        where: { id },
        data: { status: PlatformUserStatus.BANNED },
      });
      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'USER_BANNED',
          entityType: 'PlatformUser',
          entityId: id,
          oldValue: { status: user.status },
          newValue: { status: PlatformUserStatus.BANNED, reason: dto.reason },
          ipAddress,
        },
      });
      return result;
    });

    return updated;
  }

  async resetPassword(id: string, adminId: string, ipAddress?: string) {
    await this.requireUser(id);

    // PlatformUser has no password field yet -- the real end-user auth system
    // doesn't exist until the separate user-app plan. This generates and
    // returns a temp password for the admin to relay manually; there is
    // nowhere to persist it against this minimal model, and the audit log
    // deliberately never records the value itself.
    const tempPassword = this.generateTempPassword();

    await this.prisma.auditLog.create({
      data: {
        adminUserId: adminId,
        action: 'PASSWORD_RESET_BY_ADMIN',
        entityType: 'PlatformUser',
        entityId: id,
        newValue: { note: 'Temporary password generated and shown to admin once; value not logged.' },
        ipAddress,
      },
    });

    return { tempPassword };
  }

  async impersonate(id: string, adminId: string, ipAddress?: string) {
    const user = await this.requireUser(id);

    const token = this.jwtService.sign(
      { sub: user.id, type: 'impersonation', impersonatedBy: adminId },
      { secret: this.configService.get<string>('JWT_SECRET'), expiresIn: '15m' },
    );

    await this.prisma.auditLog.create({
      data: {
        adminUserId: adminId,
        action: 'USER_IMPERSONATION_STARTED',
        entityType: 'PlatformUser',
        entityId: id,
        newValue: { sensitive: true, targetUserId: id, tokenExpiresInMinutes: 15 },
        ipAddress,
      },
    });

    return { token };
  }

  async changePlan(id: string, dto: ChangePlanDto, adminId: string, ipAddress?: string) {
    const user = await this.requireUser(id);

    const newPlan = await this.prisma.subscriptionPlan.findUnique({ where: { id: dto.newPlanId } });
    if (!newPlan) {
      throw new BadRequestException('Target plan does not exist');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.platformUser.update({
        where: { id },
        data: { planId: dto.newPlanId },
        include: { plan: { select: { id: true, name: true, slug: true } } },
      });

      await tx.planChangeLog.create({
        data: {
          platformUserId: id,
          fromPlanId: user.planId,
          toPlanId: dto.newPlanId,
          changedBy: adminId,
          reason: dto.reason,
        },
      });

      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'USER_PLAN_CHANGED',
          entityType: 'PlatformUser',
          entityId: id,
          oldValue: { planId: user.planId },
          newValue: { planId: dto.newPlanId, planName: newPlan.name, reason: dto.reason },
          ipAddress,
        },
      });

      return result;
    });

    return updated;
  }

  private async requireUser(id: string) {
    const user = await this.prisma.platformUser.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('Platform user not found');
    }
    return user;
  }

  private generateTempPassword(): string {
    // 12 random bytes -> readable base64url, trimmed to a typeable length.
    return randomBytes(12).toString('base64url');
  }
}
