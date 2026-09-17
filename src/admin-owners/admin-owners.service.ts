import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { AccountsService } from '../accounts/accounts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChangeOwnerPlanDto } from './dto/change-owner-plan.dto.js';
import { ListOwnersQueryDto } from './dto/list-owners-query.dto.js';
import { SuspendOwnerDto } from './dto/suspend-owner.dto.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type OwnerWithBusinesses = Prisma.UserGetPayload<{
  include: { ownedBusinesses: { include: { plan: true } } };
}>;

@Injectable()
export class AdminOwnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountsService: AccountsService,
  ) {}

  async list(query: ListOwnersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();

    // Every real signup gets a default Business (see UserAuthService.register()),
    // so in practice this "some non-deleted owned business" filter matches every
    // registered user -- it just guards against the edge case of a user whose
    // only workspace(s) were all soft-deleted.
    const where: Prisma.UserWhereInput = {
      ownedBusinesses: { some: { deletedAt: null } },
      ...(query.status ? { status: query.status } : {}),
      ...(query.planId ? { ownedBusinesses: { some: { deletedAt: null, isDefault: true, planId: query.planId } } } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search, mode: 'insensitive' } },
              { ownedBusinesses: { some: { deletedAt: null, name: { contains: search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };

    const [owners, totalCount] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { ownedBusinesses: { where: { deletedAt: null }, include: { plan: true } } },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: owners.map((owner) => this.summarizeOwner(owner)),
      page,
      limit,
      totalCount,
    };
  }

  private summarizeOwner(owner: OwnerWithBusinesses) {
    const business = owner.ownedBusinesses.find((b) => b.isDefault) ?? owner.ownedBusinesses[0] ?? null;
    const daysUsing = Math.max(0, Math.floor((Date.now() - owner.createdAt.getTime()) / MS_PER_DAY));

    return {
      userId: owner.id,
      name: owner.name,
      email: owner.email,
      phone: owner.phone,
      businessId: business?.id ?? null,
      businessName: business?.name ?? null,
      planId: business?.planId ?? null,
      planName: business?.plan?.name ?? null,
      workspaceCount: owner.ownedBusinesses.length,
      lastLoginAt: owner.lastLoginAt,
      daysUsing,
      status: owner.status,
    };
  }

  // Owner detail view (User Management's /admin/users/:id) -- same real
  // User+Business data as list()/summarizeOwner(), plus lastLoginAt/
  // createdAt and the real activity trail. User has no suspendedAt/
  // suspendedReason columns (unlike the old PlatformUser model) -- the
  // "why suspended" banner is derived from the most recent USER_SUSPENDED
  // AuditLog entry instead, so no schema change was needed for it.
  async getById(userId: string) {
    const owner = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { ownedBusinesses: { where: { deletedAt: null }, include: { plan: true } } },
    });
    if (!owner) throw new NotFoundException('Owner not found');

    const business = owner.ownedBusinesses.find((b) => b.isDefault) ?? owner.ownedBusinesses[0] ?? null;

    const activityLog = await this.prisma.auditLog.findMany({
      where: { entityId: { in: [userId, business?.id].filter((id): id is string => Boolean(id)) } },
      orderBy: { createdAt: 'desc' },
      include: { adminUser: { select: { id: true, name: true } } },
    });

    const lastSuspension = activityLog.find((log) => log.action === 'USER_SUSPENDED');

    return {
      userId: owner.id,
      name: owner.name,
      email: owner.email,
      phone: owner.phone,
      status: owner.status,
      createdAt: owner.createdAt,
      lastLoginAt: owner.lastLoginAt,
      businessId: business?.id ?? null,
      businessName: business?.name ?? null,
      planId: business?.planId ?? null,
      planName: business?.plan?.name ?? null,
      workspaceCount: owner.ownedBusinesses.length,
      suspendedReason:
        owner.status === UserStatus.SUSPENDED && lastSuspension
          ? ((lastSuspension.newValue as { reason?: string } | null)?.reason ?? null)
          : null,
      suspendedAt: owner.status === UserStatus.SUSPENDED ? (lastSuspension?.createdAt ?? null) : null,
      activityLog: activityLog.map((log) => ({
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        adminName: log.adminUser.name,
        createdAt: log.createdAt,
      })),
    };
  }

  async suspend(userId: string, dto: SuspendOwnerDto, adminId: string, ipAddress?: string) {
    const owner = await this.requireOwner(userId);

    const { id, status } = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: userId }, data: { status: UserStatus.SUSPENDED } });
      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'USER_SUSPENDED',
          entityType: 'User',
          entityId: userId,
          oldValue: { status: owner.status },
          newValue: { status: UserStatus.SUSPENDED, reason: dto.reason },
          ipAddress,
        },
      });
      return updated;
    });
    return { id, status };
  }

  async activate(userId: string, adminId: string, ipAddress?: string) {
    const owner = await this.requireOwner(userId);

    const { id, status } = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: userId }, data: { status: UserStatus.ACTIVE } });
      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'USER_ACTIVATED',
          entityType: 'User',
          entityId: userId,
          oldValue: { status: owner.status },
          newValue: { status: UserStatus.ACTIVE },
          ipAddress,
        },
      });
      return updated;
    });
    return { id, status };
  }

  // Changes the owner's DEFAULT Business onto a different real SubscriptionPlan
  // -- plan is business-scoped in the real schema (Business.planId), not
  // user-scoped, unlike the old PlatformUser.planId this replaces.
  async changePlan(userId: string, dto: ChangeOwnerPlanDto, adminId: string, ipAddress?: string) {
    const owner = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { ownedBusinesses: { where: { deletedAt: null } } },
    });
    if (!owner) throw new NotFoundException('Owner not found');

    const business = owner.ownedBusinesses.find((b) => b.isDefault) ?? owner.ownedBusinesses[0];
    if (!business) throw new NotFoundException('This owner has no workspace to change the plan for');

    const newPlan = await this.prisma.subscriptionPlan.findUnique({ where: { id: dto.newPlanId } });
    if (!newPlan) throw new BadRequestException('Target plan does not exist');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.business.update({
        where: { id: business.id },
        data: { planId: dto.newPlanId },
        include: { plan: true },
      });
      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'BUSINESS_PLAN_CHANGED',
          entityType: 'Business',
          entityId: business.id,
          oldValue: { planId: business.planId },
          newValue: { planId: dto.newPlanId, planName: newPlan.name, reason: dto.reason },
          ipAddress,
        },
      });
      return updated;
    });
  }

  private async requireOwner(userId: string) {
    const owner = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!owner) throw new NotFoundException('Owner not found');
    return owner;
  }

  // Wipes one owner's business/financial data back to a fresh, just-registered
  // state -- transactions, accounts (re-seeded from the default chart of
  // accounts template), contacts, savings goals, assets, budget/income
  // categories. Deliberately does NOT touch the User row itself (login stays
  // intact), BusinessMember rows, or Password Vault entries (VaultEntry) --
  // those are account-level, not "business/financial data".
  //
  // Targets the owner's DEFAULT business specifically (falls back to their
  // first owned business if, unexpectedly, none is marked default) -- matches
  // the Manage Owners list showing one row per owner, backed by that same
  // business.
  async resetOwnerData(userId: string, adminId: string, ipAddress?: string) {
    const owner = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { ownedBusinesses: { where: { deletedAt: null } } },
    });
    if (!owner) throw new NotFoundException('Owner not found');

    const business = owner.ownedBusinesses.find((b) => b.isDefault) ?? owner.ownedBusinesses[0];
    if (!business) throw new NotFoundException('This owner has no workspace to reset');

    await this.prisma.$transaction(async (tx) => {
      // FK-safe order: entries/children before their parents, Transaction
      // before Contact (Transaction.contactId references Contact), Account's
      // self-referencing parentId unset before Account rows are deleted.
      await tx.transactionEntry.deleteMany({ where: { transaction: { businessId: business.id } } });
      await tx.savingsGoalEntry.deleteMany({ where: { businessId: business.id } });
      await tx.transaction.deleteMany({ where: { businessId: business.id } });
      await tx.savingsGoal.deleteMany({ where: { businessId: business.id } });
      await tx.contact.deleteMany({ where: { businessId: business.id } });
      await tx.assetValueHistory.deleteMany({ where: { asset: { businessId: business.id } } });
      await tx.asset.deleteMany({ where: { businessId: business.id } });
      await tx.assetCategoryOption.deleteMany({ where: { businessId: business.id } });
      await tx.budgetCategory.deleteMany({ where: { businessId: business.id } });
      await tx.incomeGoal.deleteMany({ where: { businessId: business.id } });
      await tx.account.updateMany({ where: { businessId: business.id }, data: { parentId: null } });
      await tx.account.deleteMany({ where: { businessId: business.id } });

      await this.accountsService.seedDefaultAccounts(business.id, business.type, tx);

      await tx.business.update({ where: { id: business.id }, data: { monthlyBudgetTarget: null } });

      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'OWNER_DATA_RESET',
          entityType: 'Business',
          entityId: business.id,
          oldValue: { ownerId: owner.id, ownerEmail: owner.email, businessName: business.name },
          ipAddress,
        },
      });
    });

    return { businessId: business.id };
  }
}
