import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PlatformUserStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePlanDto } from './dto/create-plan.dto.js';
import { UpdatePlanDto } from './dto/update-plan.dto.js';

@Injectable()
export class SubscriptionPlansService {
  constructor(private readonly prisma: PrismaService) {}

  // All plans, active and inactive -- also backs the plan filter dropdown in
  // User Management (Prompt 2).
  list() {
    return this.prisma.subscriptionPlan.findMany({ orderBy: { displayOrder: 'asc' } });
  }

  async getById(id: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id } });
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    const userCount = await this.prisma.platformUser.count({ where: { planId: id } });
    return { ...plan, userCount };
  }

  async create(dto: CreatePlanDto) {
    const existing = await this.prisma.subscriptionPlan.findUnique({ where: { slug: dto.slug } });
    if (existing) {
      throw new ConflictException('A plan with this slug already exists');
    }

    return this.prisma.subscriptionPlan.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        billingCycle: dto.billingCycle,
        price: dto.price,
        currency: dto.currency ?? 'BDT',
        trialDays: dto.trialDays ?? 0,
        isActive: dto.isActive ?? true,
        displayOrder: dto.displayOrder ?? 0,
        featureLimits: dto.featureLimits as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async update(id: string, dto: UpdatePlanDto, adminId: string, ipAddress?: string) {
    const plan = await this.requirePlan(id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.subscriptionPlan.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.slug !== undefined && { slug: dto.slug }),
          ...(dto.billingCycle !== undefined && { billingCycle: dto.billingCycle }),
          ...(dto.price !== undefined && { price: dto.price }),
          ...(dto.currency !== undefined && { currency: dto.currency }),
          ...(dto.trialDays !== undefined && { trialDays: dto.trialDays }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
          ...(dto.displayOrder !== undefined && { displayOrder: dto.displayOrder }),
          ...(dto.featureLimits !== undefined && { featureLimits: dto.featureLimits as unknown as Prisma.InputJsonValue }),
        },
      });

      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'PLAN_UPDATED',
          entityType: 'SubscriptionPlan',
          entityId: id,
          oldValue: plan as unknown as Prisma.InputJsonValue,
          newValue: result as unknown as Prisma.InputJsonValue,
          ipAddress,
        },
      });

      return result;
    });

    return updated;
  }

  async archive(id: string, adminId: string, ipAddress?: string) {
    await this.requirePlan(id);

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.subscriptionPlan.update({ where: { id }, data: { isActive: false } });
      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'PLAN_ARCHIVED',
          entityType: 'SubscriptionPlan',
          entityId: id,
          newValue: { isActive: false },
          ipAddress,
        },
      });
      return result;
    });
  }

  // Hard delete -- unlike archive, this is destructive, so it's blocked
  // outright if any PlatformUser is still on the plan (archive is the
  // correct action for "stop new signups but let existing users stay").
  async remove(id: string, adminId: string, ipAddress?: string) {
    await this.requirePlan(id);

    const usersOnPlan = await this.prisma.platformUser.count({ where: { planId: id } });
    if (usersOnPlan > 0) {
      throw new BadRequestException(
        `Cannot delete this plan -- ${usersOnPlan} user(s) are currently on it. Archive it instead.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.subscriptionPlan.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'PLAN_DELETED',
          entityType: 'SubscriptionPlan',
          entityId: id,
          ipAddress,
        },
      });
    });

    return { success: true };
  }

  async analytics() {
    const plans = await this.prisma.subscriptionPlan.findMany({ orderBy: { displayOrder: 'asc' } });

    const perPlan = await Promise.all(
      plans.map(async (plan) => {
        const [totalUsers, activeUsers] = await Promise.all([
          this.prisma.platformUser.count({ where: { planId: plan.id } }),
          this.prisma.platformUser.count({ where: { planId: plan.id, status: PlatformUserStatus.ACTIVE } }),
        ]);
        const revenueEstimate = Number(plan.price) * activeUsers;
        return {
          planId: plan.id,
          planName: plan.name,
          billingCycle: plan.billingCycle,
          totalUsers,
          activeUsers,
          revenueEstimate,
        };
      }),
    );

    const usersWithNoPlan = await this.prisma.platformUser.count({ where: { planId: null } });
    const freePlanIds = plans.filter((p) => p.billingCycle === 'FREE').map((p) => p.id);
    const freeUsers = perPlan.filter((p) => freePlanIds.includes(p.planId)).reduce((sum, p) => sum + p.totalUsers, 0) + usersWithNoPlan;
    const paidUsers = perPlan.filter((p) => !freePlanIds.includes(p.planId)).reduce((sum, p) => sum + p.totalUsers, 0);
    const totalUsers = freeUsers + paidUsers;

    return {
      perPlan,
      summary: {
        totalUsers,
        freeUsers,
        paidUsers,
        freePercentage: totalUsers > 0 ? Math.round((freeUsers / totalUsers) * 100) : 0,
        paidPercentage: totalUsers > 0 ? Math.round((paidUsers / totalUsers) * 100) : 0,
        totalRevenueEstimate: perPlan.reduce((sum, p) => sum + p.revenueEstimate, 0),
      },
    };
  }

  private async requirePlan(id: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id } });
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    return plan;
  }
}
