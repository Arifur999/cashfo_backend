import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BillingCycle, Prisma, UserStatus } from '@prisma/client';
import { AccountsService } from '../accounts/accounts.service.js';
import { AuthSessionsService } from '../auth/auth-sessions.service.js';
import { CredentialsService } from '../auth/credentials.service.js';
import { SubscriptionsService } from '../billing/subscriptions.service.js';
import { END_USER_WHERE } from '../common/roles.js';
import { generateTempPassword } from '../common/temp-password.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TwoStepService } from '../two-step/two-step.service.js';
import { ChangeOwnerPlanDto } from './dto/change-owner-plan.dto.js';
import { ListOwnersQueryDto } from './dto/list-owners-query.dto.js';
import { SuspendOwnerDto } from './dto/suspend-owner.dto.js';
import { ownerDateFilters, ownerOrderBy, workspaceCount } from './owner-filters.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type OwnerWithBusinesses = Prisma.UserGetPayload<{
  include: { ownedBusinesses: { include: { plan: true } } };
}>;

@Injectable()
export class AdminOwnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountsService: AccountsService,
    private readonly sessions: AuthSessionsService,
    private readonly credentials: CredentialsService,
    private readonly subscriptions?: SubscriptionsService,
    private readonly twoStep?: TwoStepService,
  ) {}

  // A temporary password for a customer who can't get in, shown to the
  // admin once to hand over. Every device they were signed in on is signed
  // out, and the reset is in the audit log without the password.
  async resetPassword(userId: string, adminId: string, ipAddress?: string) {
    const owner = await this.prisma.user.findUnique({ where: { id: userId, ...END_USER_WHERE }, select: { id: true } });
    if (!owner) {
      throw new NotFoundException('Owner not found');
    }

    const temporaryPassword = generateTempPassword();
    await this.credentials.set(userId, temporaryPassword);
    await this.sessions.revokeAllForUser(userId);

    await this.prisma.auditLog.create({
      data: {
        adminUserId: adminId,
        action: 'OWNER_PASSWORD_RESET',
        entityType: 'User',
        entityId: userId,
        newValue: { note: 'Temporary password generated and shown to the admin once; value not logged.' },
        ipAddress,
      },
    });

    return { temporaryPassword };
  }

  // A customer who lost their phone and their backup codes: a super admin
  // turns two-step sign-in off, so the password alone signs in again. The
  // customer gets a bell row and an email; the audit log keeps who did it.
  async disableTwoStep(userId: string, adminId: string, ipAddress?: string) {
    const owner = await this.prisma.user.findUnique({ where: { id: userId, ...END_USER_WHERE }, select: { id: true } });
    if (!owner) {
      throw new NotFoundException('Owner not found');
    }
    if (!(await this.twoStep!.removeAll(userId))) {
      throw new ConflictException('Two-step sign-in is already off for this customer.');
    }
    await this.prisma.auditLog.create({
      data: { adminUserId: adminId, action: 'OWNER_TWO_STEP_DISABLED', entityType: 'User', entityId: userId, ipAddress },
    });
    await this.twoStep!.notifyCustomer(userId, 'OFF_BY_SUPPORT');
    return { success: true };
  }

  async list(query: ListOwnersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();
    // Joined, Last active and Workspaces narrow the list and its tab counts
    // alike, like the search and the plan do.
    const extra = ownerDateFilters(query);
    if (query.workspaces) {
      const owners = await this.prisma.business.groupBy({
        by: ['ownerId'],
        where: { deletedAt: null },
        having: { ownerId: { _count: workspaceCount(query.workspaces) } },
      });
      extra.push({ id: { in: owners.map((owner) => owner.ownerId) } });
    }

    // Every real signup gets a default Business (see UserAuthService.register()),
    // so in practice this "some non-deleted owned business" filter matches every
    // registered user -- it just guards against the edge case of a user whose
    // only workspace(s) were all soft-deleted.
    // Everything but the status, so the status tabs can count what each
    // one would show under the same search and plan.
    const baseWhere: Prisma.UserWhereInput = {
      ...END_USER_WHERE,
      ownedBusinesses: { some: { deletedAt: null } },
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
      ...(extra.length > 0 ? { AND: extra } : {}),
    };
    const where: Prisma.UserWhereInput = { ...baseWhere, ...(query.status ? { status: query.status } : {}) };

    const [owners, totalCount, byStatus] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: ownerOrderBy(query.sort),
        include: { ownedBusinesses: { where: { deletedAt: null }, include: { plan: true } } },
      }),
      this.prisma.user.count({ where }),
      this.prisma.user.groupBy({ by: ['status'], where: baseWhere, _count: true }),
    ]);

    const statusCounts = Object.fromEntries(Object.values(UserStatus).map((status) => [status, 0])) as Record<UserStatus, number>;
    for (const row of byStatus) statusCounts[row.status] = row._count;

    return {
      items: owners.map((owner) => this.summarizeOwner(owner)),
      page,
      limit,
      totalCount,
      statusCounts,
    };
  }

  // businessType and businessIsDefault say what kind of workspace the row
  // shows, so the personal one can be labelled as such whatever it is named.
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
      businessType: business?.type ?? null,
      businessIsDefault: business?.isDefault ?? null,
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
      where: { id: userId, ...END_USER_WHERE },
      include: {
        ownedBusinesses: { where: { deletedAt: null }, include: { plan: true } },
        subscription: { include: { plan: { select: { id: true, name: true, billingCycle: true, price: true } } } },
        twoFactor: { select: { enabledAt: true } },
      },
    });
    if (!owner) throw new NotFoundException('Owner not found');

    const business = owner.ownedBusinesses.find((b) => b.isDefault) ?? owner.ownedBusinesses[0] ?? null;
    const subscription = owner.subscription ?? null;

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
      // Two-step sign-in with an authenticator app (Settings > Security).
      twoFactorEnabled: Boolean(owner.twoFactor?.enabledAt),
      businessId: business?.id ?? null,
      businessName: business?.name ?? null,
      // What kind of workspace this is, as on the list's rows.
      businessType: business?.type ?? null,
      businessIsDefault: business?.isDefault ?? null,
      planId: business?.planId ?? null,
      planName: business?.plan?.name ?? null,
      workspaceCount: owner.ownedBusinesses.length,
      // The customer's plan as billing sees it (UserSubscription); null
      // only for an account that has never been used.
      subscription: subscription && {
        planId: subscription.planId,
        planName: subscription.plan.name,
        billingCycle: subscription.plan.billingCycle,
        price: subscription.plan.price,
        status: subscription.status,
        trialEndsAt: subscription.trialEndsAt,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        lockedPrice: subscription.lockedPrice,
      },
      suspendedReason:
        owner.status === UserStatus.SUSPENDED && lastSuspension ? ((lastSuspension.newValue as { reason?: string } | null)?.reason ?? null) : null,
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
    // Signed out on every device at once, not just refused on the next request.
    await this.sessions.revokeAllForUser(userId);
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
      where: { id: userId, ...END_USER_WHERE },
      include: { ownedBusinesses: { where: { deletedAt: null } } },
    });
    if (!owner) throw new NotFoundException('Owner not found');

    const business = owner.ownedBusinesses.find((b) => b.isDefault) ?? owner.ownedBusinesses[0];
    if (!business) throw new NotFoundException('This owner has no workspace to change the plan for');

    const newPlan = await this.prisma.subscriptionPlan.findUnique({ where: { id: dto.newPlanId } });
    if (!newPlan) throw new BadRequestException('Target plan does not exist');
    const isFree = newPlan.billingCycle === BillingCycle.FREE;
    if (isFree && dto.currentPeriodEnd) throw new BadRequestException('The free plan has no end date');
    const subscriptions = this.subscriptions;
    if (!subscriptions) throw new Error('SubscriptionsService is not available');

    return this.prisma.$transaction(async (tx) => {
      // The customer's subscription is the plan; applyPlan() mirrors it onto
      // their workspaces and logs it in PlanChangeLog. A paid plan set here
      // ends on the date given, or keeps a running period's end; with
      // neither it never expires until an admin sets an end.
      const current = await subscriptions.ensure(userId, tx);
      const now = new Date();
      const samePlan = current.planId === newPlan.id;
      const runningEnd =
        current.plan.billingCycle !== BillingCycle.FREE && current.currentPeriodEnd && current.currentPeriodEnd > now ? current.currentPeriodEnd : null;
      const periodEnd = isFree ? null : dto.currentPeriodEnd !== undefined ? (dto.currentPeriodEnd ? new Date(dto.currentPeriodEnd) : null) : runningEnd;
      await subscriptions.applyPlan(tx, userId, newPlan.id, {
        changedBy: adminId,
        reason: dto.reason,
        fields: {
          status: 'ACTIVE',
          currentPeriodStart: isFree ? null : samePlan ? (current.currentPeriodStart ?? now) : now,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
          trialEndsAt: null,
          lockedPrice: isFree ? null : samePlan ? current.lockedPrice : null,
        },
      });
      // Selected, not the whole row: the Business carries the owner's
      // workspace PIN hash, and this answer travels on to the browser.
      const updated = await tx.business.findUniqueOrThrow({
        where: { id: business.id },
        select: { id: true, planId: true, plan: { select: { id: true, name: true, slug: true, billingCycle: true, price: true } } },
      });
      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'BUSINESS_PLAN_CHANGED',
          entityType: 'Business',
          entityId: business.id,
          oldValue: { planId: business.planId, currentPeriodEnd: current.currentPeriodEnd?.toISOString() ?? null },
          newValue: { planId: dto.newPlanId, planName: newPlan.name, reason: dto.reason, currentPeriodEnd: periodEnd?.toISOString() ?? null },
          ipAddress,
        },
      });
      return { ...updated, currentPeriodEnd: periodEnd };
    });
  }

  private async requireOwner(userId: string) {
    // Role-scoped: admin accounts share the User table and must never be
    // suspended, re-planned or reset through the owner endpoints.
    const owner = await this.prisma.user.findUnique({ where: { id: userId, ...END_USER_WHERE } });
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
      where: { id: userId, ...END_USER_WHERE },
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
