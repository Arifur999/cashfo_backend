import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus, Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePlanDto } from './dto/create-plan.dto.js';
import { monthEnds, paidPeopleAtMonthEnds } from './plan-history.js';

// How far back the "paid people at the end of each month" chart looks.
const HISTORY_MONTHS = 6;
import { UpdatePlanDto } from './dto/update-plan.dto.js';

// The plan new accounts are put on (UserProvisioningService looks it up by
// this slug).
const FREE_PLAN_SLUG = 'free';

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
    // Real subscriber count -- plan is business-scoped (Business.planId), not
    // user-scoped, so this counts each real owner's DEFAULT workspace on this
    // plan (mirrors AdminOwnersService/AdminWorkspacesService's own real
    // Business queries, not the old PlatformUser sandbox).
    const userCount = await this.prisma.business.count({ where: { planId: id, isDefault: true, deletedAt: null } });
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
    // New sign-ups are put on the plan whose slug is "free"
    // (UserProvisioningService); renaming it would leave them on no plan.
    if (plan.slug === FREE_PLAN_SLUG && dto.slug !== undefined && dto.slug !== FREE_PLAN_SLUG) {
      throw new BadRequestException('The free plan keeps the slug "free" -- new accounts are put on it by that name.');
    }
    if (dto.slug !== undefined && dto.slug !== plan.slug && (await this.prisma.subscriptionPlan.findUnique({ where: { slug: dto.slug } }))) {
      throw new ConflictException('Another plan already uses this slug');
    }

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
  // outright if any real Business is still on the plan (archive is the
  // correct action for "stop new signups but let existing owners stay").
  async remove(id: string, adminId: string, ipAddress?: string) {
    await this.requirePlan(id);

    const plan = await this.prisma.subscriptionPlan.findUniqueOrThrow({ where: { id } });
    if (plan.slug === FREE_PLAN_SLUG) {
      throw new BadRequestException('The free plan cannot be deleted -- new accounts are put on it. Archive other plans instead.');
    }
    // Every reference, not just default workspaces: extra workspaces carry
    // the owner's plan too (deleting would silently clear it), and payments
    // and coupon redemptions block the delete at the database.
    const [workspaces, payments, redemptions] = await Promise.all([
      this.prisma.business.count({ where: { planId: id } }),
      this.prisma.payment.count({ where: { planId: id } }),
      this.prisma.couponRedemption.count({ where: { planId: id } }),
    ]);
    if (workspaces + payments + redemptions > 0) {
      throw new BadRequestException(
        `Cannot delete this plan -- ${workspaces} workspace(s), ${payments} payment(s) and ${redemptions} coupon redemption(s) refer to it. Archive it instead.`,
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

  // Real per-plan subscriber counts -- one real registered owner's default
  // Business per count, replacing the old PlatformUser-sandbox counts (see
  // AdminOwnersService/AdminWorkspacesService for the same real-Business
  // query pattern this mirrors). revenueEstimate stays an estimate (price *
  // activeUsers) since there is still no real payment-gateway integration
  // that collects actual charged revenue -- only the user-count input is
  // now real.
  async analytics() {
    const plans = await this.prisma.subscriptionPlan.findMany({ orderBy: { displayOrder: 'asc' } });

    const now = new Date();
    const perPlan = await Promise.all(
      plans.map(async (plan) => {
        const [totalUsers, activeUsers, trialing] = await Promise.all([
          this.prisma.business.count({ where: { planId: plan.id, isDefault: true, deletedAt: null } }),
          this.prisma.business.count({
            where: { planId: plan.id, isDefault: true, deletedAt: null, owner: { status: UserStatus.ACTIVE } },
          }),
          // Workspaces on the plan whose trial is still running.
          this.prisma.business.count({ where: { planId: plan.id, deletedAt: null, trialEndsAt: { gt: now } } }),
        ]);
        const revenueEstimate = Number(plan.price) * activeUsers;
        return {
          planId: plan.id,
          planName: plan.name,
          billingCycle: plan.billingCycle,
          totalUsers,
          activeUsers,
          trialing,
          revenueEstimate,
        };
      }),
    );

    // Paid people at each of the last month ends, from the successful
    // payments whose period could still be running then (a yearly payment
    // reaches back twelve months).
    const ends = monthEnds(now, HISTORY_MONTHS);
    const payments = await this.prisma.payment.findMany({
      where: { status: PaymentStatus.SUCCESS, createdAt: { gte: new Date(Date.UTC(ends[0].at.getUTCFullYear() - 1, ends[0].at.getUTCMonth(), 1)) } },
      select: { platformUserId: true, planId: true, paidAt: true, createdAt: true },
    });
    const history = paidPeopleAtMonthEnds(
      payments.map((payment) => ({ platformUserId: payment.platformUserId, planId: payment.planId, paidAt: payment.paidAt ?? payment.createdAt })),
      plans,
      ends,
    );

    const usersWithNoPlan = await this.prisma.business.count({
      where: { planId: null, isDefault: true, deletedAt: null },
    });
    const freePlanIds = plans.filter((p) => p.billingCycle === 'FREE').map((p) => p.id);
    const freeUsers = perPlan.filter((p) => freePlanIds.includes(p.planId)).reduce((sum, p) => sum + p.totalUsers, 0) + usersWithNoPlan;
    const paidUsers = perPlan.filter((p) => !freePlanIds.includes(p.planId)).reduce((sum, p) => sum + p.totalUsers, 0);
    const totalUsers = freeUsers + paidUsers;

    return {
      perPlan,
      history,
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
