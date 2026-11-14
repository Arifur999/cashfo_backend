import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BillingCycle, Prisma, UserStatus } from '@prisma/client';
import { AccountDeletionService } from '../account-deletion/account-deletion.service.js';
import { AccountExportService } from '../account-export/account-export.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { auditReason } from '../audit-logs/audit-entity-labels.js';
import { AuthSessionsService } from '../auth/auth-sessions.service.js';
import { SubscriptionsService } from '../billing/subscriptions.service.js';
import { END_USER_WHERE } from '../common/roles.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TwoStepService } from '../two-step/two-step.service.js';
import { ChangeOwnerPlanDto } from './dto/change-owner-plan.dto.js';
import { ListOwnersQueryDto } from './dto/list-owners-query.dto.js';
import { SupportAccessService } from '../support-access/support-access.service.js';
import { SuspendOwnerDto } from './dto/suspend-owner.dto.js';
import { ownerExtras } from './owner-detail.js';
import { ownerDateFilters, ownerOrderBy, workspaceCount } from './owner-filters.js';
import { OWNERS_EXPORT_LIMIT, ownersCsv } from './owners-export.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function trialEndsAt(subscription: { status: string; trialEndsAt: Date | null } | null, now = new Date()): Date | null {
  if (subscription?.status !== 'TRIALING' || !subscription.trialEndsAt) return null;
  return subscription.trialEndsAt > now ? subscription.trialEndsAt : null;
}

const OWNER_LIST_INCLUDE = {
  ownedBusinesses: { where: { deletedAt: null }, include: { plan: true } },
  subscription: { select: { status: true, trialEndsAt: true } },
} satisfies Prisma.UserInclude;

type OwnerWithBusinesses = Prisma.UserGetPayload<{ include: typeof OWNER_LIST_INCLUDE }>;

@Injectable()
export class AdminOwnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountsService: AccountsService,
    private readonly sessions: AuthSessionsService,
    private readonly supportAccess?: SupportAccessService,
    private readonly subscriptions?: SubscriptionsService,
    private readonly twoStep?: TwoStepService,
    private readonly deletion?: AccountDeletionService,
    private readonly accountExport?: AccountExportService,
  ) {}

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
    const { baseWhere, where } = await this.listWhere(query);

    const [owners, totalCount, byStatus] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: ownerOrderBy(query.sort),
        include: OWNER_LIST_INCLUDE,
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

  // Users > Export CSV: every row the list's filters match (not just the
  // page on screen), up to OWNERS_EXPORT_LIMIT. Audited: it is a list of
  // real people's contact details.
  async exportList(query: ListOwnersQueryDto, adminId: string, ipAddress?: string) {
    const { where } = await this.listWhere(query);
    const owners = await this.prisma.user.findMany({
      where,
      take: OWNERS_EXPORT_LIMIT + 1,
      orderBy: ownerOrderBy(query.sort),
      include: OWNER_LIST_INCLUDE,
    });
    const truncated = owners.length > OWNERS_EXPORT_LIMIT;
    const rows = owners.slice(0, OWNERS_EXPORT_LIMIT).map((owner) => this.summarizeOwner(owner));
    await this.prisma.auditLog.create({
      data: {
        adminUserId: adminId,
        action: 'OWNERS_EXPORTED',
        entityType: 'User',
        newValue: { filters: { ...query, page: undefined, limit: undefined }, rows: rows.length, truncated } as Prisma.InputJsonValue,
        ipAddress,
      },
    });
    return { ...ownersCsv(rows), rows: rows.length, truncated };
  }

  // The list's filters as a where clause: baseWhere is everything but the
  // status, so the status tabs can count what each would show.
  private async listWhere(query: ListOwnersQueryDto): Promise<{ baseWhere: Prisma.UserWhereInput; where: Prisma.UserWhereInput }> {
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
    // only workspace(s) were all soft-deleted. A purged account (DELETED) has
    // no workspaces left and still shows, under the Deleted tab.
    const baseWhere: Prisma.UserWhereInput = {
      ...END_USER_WHERE,
      AND: [
        query.planId
          ? { ownedBusinesses: { some: { deletedAt: null, isDefault: true, planId: query.planId } } }
          : { OR: [{ ownedBusinesses: { some: { deletedAt: null } } }, { status: UserStatus.DELETED }] },
        ...(search
          ? [
              {
                OR: [
                  { name: { contains: search, mode: 'insensitive' } },
                  { email: { contains: search, mode: 'insensitive' } },
                  { phone: { contains: search, mode: 'insensitive' } },
                  { ownedBusinesses: { some: { deletedAt: null, name: { contains: search, mode: 'insensitive' } } } },
                ],
              } satisfies Prisma.UserWhereInput,
            ]
          : []),
        ...extra,
      ],
    };
    const where: Prisma.UserWhereInput = { ...baseWhere, ...(query.status ? { status: query.status } : {}) };
    return { baseWhere, where };
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
      // A running free trial: the day it ends (the plan chip reads "Trial
      // ends 4 Oct"). Null once it has run out, even before the lazy expiry.
      trialEndsAt: trialEndsAt(owner.subscription),
      workspaceCount: owner.ownedBusinesses.length,
      lastLoginAt: owner.lastLoginAt,
      daysUsing,
      status: owner.status,
      // PENDING_DELETION: the day the account is purged unless they sign in.
      deletionScheduledFor: owner.deletionScheduledFor,
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
        subscription: { include: { plan: { select: { id: true, name: true, billingCycle: true, price: true, featureLimits: true } } } },
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
    const extras = await ownerExtras(this.prisma, owner, subscription);

    return {
      userId: owner.id,
      name: owner.name,
      email: owner.email,
      phone: owner.phone,
      status: owner.status,
      createdAt: owner.createdAt,
      lastLoginAt: owner.lastLoginAt,
      preferredLanguage: owner.preferredLanguage,
      // Delete my account: asked on requestedAt, purged on scheduledFor
      // unless they sign in first (or support cancels it). Null otherwise.
      deletion:
        owner.status === UserStatus.PENDING_DELETION || owner.status === UserStatus.DELETED
          ? { requestedAt: owner.deletionRequestedAt, scheduledFor: owner.deletionScheduledFor }
          : null,
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
        // The reason an admin gave (suspend, plan change), for the history
        // line; the rest of the audit row stays on the audit log.
        reason: auditReason(log.newValue),
        createdAt: log.createdAt,
      })),
      ...extras,
    };
  }

  async suspend(userId: string, dto: SuspendOwnerDto, adminId: string, ipAddress?: string) {
    const owner = await this.requireOwner(userId);
    if (owner.status === UserStatus.PENDING_DELETION || owner.status === UserStatus.DELETED) {
      throw new ConflictException('This account is being deleted, so it cannot be suspended.');
    }
    // "Also sign out of every device now", on unless the admin unticks it.
    const signOut = dto.signOutEverywhere ?? true;

    const { id, status } = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: userId }, data: { status: UserStatus.SUSPENDED } });
      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'USER_SUSPENDED',
          entityType: 'User',
          entityId: userId,
          oldValue: { status: owner.status },
          newValue: { status: UserStatus.SUSPENDED, reason: dto.reason, signedOutEverywhere: signOut },
          ipAddress,
        },
      });
      return updated;
    });
    // Signed out on every device at once. Unticked, the devices stay signed
    // in but every request is refused while the account is suspended (the
    // guards check the status), so they are back in once it is turned on.
    if (signOut) await this.signOutDevices(userId);
    return { id, status };
  }

  async activate(userId: string, adminId: string, ipAddress?: string) {
    const owner = await this.requireOwner(userId);
    if (owner.status === UserStatus.PENDING_DELETION) {
      throw new ConflictException('This account is waiting to be deleted. Cancel the deletion instead.');
    }
    if (owner.status === UserStatus.DELETED) throw new ConflictException('This account was deleted and cannot be turned back on.');

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

  // "Cancel the deletion" for a customer who asked support to keep their
  // account (they could also just sign in). Only inside the 30 days.
  async restore(userId: string, adminId: string, ipAddress?: string) {
    const owner = await this.requireOwner(userId);
    if (owner.status !== UserStatus.PENDING_DELETION) throw new ConflictException('This account is not waiting to be deleted.');
    if (!(await this.deletion!.restoreByAdmin(userId))) {
      throw new ConflictException('The 30 days are over: this account is being deleted and cannot be restored.');
    }
    await this.prisma.auditLog.create({
      data: {
        adminUserId: adminId,
        action: 'OWNER_DELETION_CANCELLED',
        entityType: 'User',
        entityId: userId,
        oldValue: { status: owner.status, deletionScheduledFor: owner.deletionScheduledFor?.toISOString() ?? null },
        newValue: { status: UserStatus.ACTIVE },
        ipAddress,
      },
    });
    return { id: userId, status: UserStatus.ACTIVE };
  }

  // "Sign out of all devices" on the user's page: every session ends now and
  // the device list shows them signed out.
  async signOutEverywhere(userId: string, adminId: string, ipAddress?: string) {
    await this.requireOwner(userId);
    const signedIn = await this.prisma.authSession.count({ where: { userId, impersonatedBy: null, expiresAt: { gt: new Date() } } });
    await this.signOutDevices(userId);
    await this.prisma.auditLog.create({
      data: { adminUserId: adminId, action: 'OWNER_SIGNED_OUT_EVERYWHERE', entityType: 'User', entityId: userId, newValue: { sessions: signedIn }, ipAddress },
    });
    return { signedOut: signedIn };
  }

  // "Download a copy" before a reset: the same zip the customer's own
  // Download my data makes (the vault left out). Only with the support code
  // the customer made, like View as customer; audited either way.
  async exportOwnerData(userId: string, code: string, adminId: string, ipAddress?: string) {
    const owner = await this.requireOwner(userId);
    if (owner.status === UserStatus.DELETED) throw new ConflictException('This account was deleted; there is no data left to download.');
    await this.supportAccess!.requireConsent(userId, code, { adminId, refused: 'OWNER_DATA_EXPORT_REFUSED', ipAddress });
    const file = await this.accountExport!.export(userId);
    await this.prisma.auditLog.create({
      data: { adminUserId: adminId, action: 'OWNER_DATA_EXPORTED', entityType: 'User', entityId: userId, newValue: { fileName: file.fileName }, ipAddress },
    });
    return file;
  }

  // Better-auth sessions end, and the device rows are marked signed out
  // (revokeAllForUser leaves UserSession alone).
  private async signOutDevices(userId: string) {
    await this.sessions.revokeAllForUser(userId);
    await this.prisma.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
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
      await tx.investmentEntry.deleteMany({ where: { businessId: business.id } });
      await tx.investment.deleteMany({ where: { businessId: business.id } });
      await tx.investmentDeletion.deleteMany({ where: { businessId: business.id } });
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
