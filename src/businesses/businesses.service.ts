import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { WorkspaceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateBusinessDto } from './dto/create-business.dto.js';
import { UpdateBusinessDto } from './dto/update-business.dto.js';
import { RequestBusinessMember } from '../business-access/interfaces/request-business-member.interface.js';
import { AccountsService } from '../accounts/accounts.service.js';

interface FeatureLimits {
  maxBusinessWorkspaces?: number;
  [key: string]: unknown;
}

@Injectable()
export class BusinessesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountsService: AccountsService,
  ) {}

  async list(userId: string) {
    const memberships = await this.prisma.businessMember.findMany({
      where: { userId, status: 'ACTIVE', business: { deletedAt: null } },
      include: { business: true },
      orderBy: { joinedAt: 'asc' },
    });

    // Computed once outside the map loop -- every non-default BUSINESS
    // workspace in this list shares the same owner's plan, so there's no
    // need to re-derive it (and re-query the owner's default workspace) per row.
    const fee = await this.getAdditionalWorkspaceMonthlyFee(userId);

    return memberships.map((m) => ({
      id: m.business.id,
      name: m.business.name,
      type: m.business.type,
      currency: m.business.currency,
      isDefault: m.business.isDefault,
      role: m.role,
      phone: m.business.phone,
      email: m.business.email,
      hasPinLock: m.business.pinHash !== null,
      trialEndsAt: m.business.trialEndsAt,
      monthlyFee: m.business.type === 'BUSINESS' && !m.business.isDefault ? fee : null,
    }));
  }

  // ARCHITECTURAL ASSUMPTION (Prompt 3, documented per spec): the schema has
  // no User.planId -- billing is tracked per-Business (Business.planId, set
  // on the admin panel's PlatformUser/Payment side). Until real multi-
  // workspace billing exists, we treat "the user's plan" as whatever plan is
  // on their default PERSONAL workspace, and a newly-created BUSINESS
  // workspace inherits that same plan reference. This means plan limits are
  // effectively per-user, not per-workspace, for now -- revisit if/when
  // workspaces need independent billing. Shared by create() and getLimits()
  // (the latter lets the frontend show/disable the "Create workspace" UI
  // proactively instead of only finding out via a failed POST).
  private async getPlanLimitInfo(userId: string) {
    const defaultBusiness = await this.prisma.business.findFirst({
      where: { ownerId: userId, isDefault: true },
      include: { plan: true },
    });

    const limits = (defaultBusiness?.plan?.featureLimits as FeatureLimits | undefined) ?? {};
    // No plan on record is treated as the most restrictive case (0) rather
    // than unlimited -- an unconfigured plan should never silently grant
    // more than the free tier would.
    const maxBusinessWorkspaces = limits.maxBusinessWorkspaces ?? 0;

    const currentCount = await this.prisma.business.count({
      where: { ownerId: userId, type: WorkspaceType.BUSINESS, deletedAt: null },
    });

    return { maxBusinessWorkspaces, currentCount, planId: defaultBusiness?.planId };
  }

  // 50% of the owner's plan price per additional (non-default) workspace --
  // ledger/display only for now, no real charge/payment gateway integration.
  // Reuses the SAME "owner's default workspace's plan" lookup getPlanLimitInfo()
  // already relies on (see that method's own comment on why billing is
  // per-user, not per-workspace, until real multi-workspace billing exists).
  private async getAdditionalWorkspaceMonthlyFee(userId: string): Promise<string | null> {
    const defaultBusiness = await this.prisma.business.findFirst({
      where: { ownerId: userId, isDefault: true },
      include: { plan: true },
    });
    if (!defaultBusiness?.plan) return null;
    return (Number(defaultBusiness.plan.price) * 0.5).toFixed(2);
  }

  // Additional workspaces are no longer gated by SubscriptionPlan.featureLimits.
  // maxBusinessWorkspaces -- product decision: creating one is always allowed
  // regardless of plan; the only thing that varies by plan is the monthly
  // add-on fee (getAdditionalWorkspaceMonthlyFee(), already 0.00 for a free
  // plan since it's 50% of a 0 price). maxBusinessWorkspaces/atLimit are kept
  // in the response shape for informational display only -- atLimit is now
  // always false.
  async getLimits(userId: string) {
    const { maxBusinessWorkspaces, currentCount } = await this.getPlanLimitInfo(userId);
    return { maxBusinessWorkspaces, currentCount, atLimit: false };
  }

  async create(userId: string, dto: CreateBusinessDto) {
    if (dto.type !== WorkspaceType.BUSINESS) {
      throw new BadRequestException(
        'Only BUSINESS-type workspaces can be created here -- every account already has one PERSONAL workspace created automatically at signup.',
      );
    }

    const { planId } = await this.getPlanLimitInfo(userId);

    const pinHash = dto.pin ? await bcrypt.hash(dto.pin, 10) : null;

    const business = await this.prisma.$transaction(async (tx) => {
      const created = await tx.business.create({
        data: {
          ownerId: userId,
          name: dto.name,
          type: WorkspaceType.BUSINESS,
          currency: dto.currency ?? 'BDT',
          planId,
          isDefault: false,
          phone: dto.phone ?? null,
          email: dto.email ?? null,
          pinHash,
          trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        },
      });

      await tx.businessMember.create({
        data: { businessId: created.id, userId, role: 'OWNER' },
      });

      // Prompt 4: a workspace should never exist without its starter Chart
      // of Accounts -- seeded in the SAME transaction as the workspace/
      // membership rows above, for the same all-or-nothing reason.
      await this.accountsService.seedDefaultAccounts(created.id, WorkspaceType.BUSINESS, tx);

      return created;
    });

    // Computed AFTER the transaction commits, not inside it -- this reads via
    // the plain (non-transactional) PrismaService client, and calling it from
    // inside an open interactive transaction against `prisma dev`'s limited
    // connection pool starves that transaction until it hits its 5s timeout
    // (P2028), exactly like the bug already fixed once in
    // UserAuthService.register() (see that method's own comment).
    const monthlyFee = await this.getAdditionalWorkspaceMonthlyFee(userId);

    return {
      id: business.id,
      name: business.name,
      type: business.type,
      currency: business.currency,
      isDefault: business.isDefault,
      role: 'OWNER' as const,
      phone: business.phone,
      email: business.email,
      hasPinLock: business.pinHash !== null,
      trialEndsAt: business.trialEndsAt,
      monthlyFee,
    };
  }

  async getOne(businessId: string) {
    const business = await this.requireBusiness(businessId);
    return {
      id: business.id,
      name: business.name,
      type: business.type,
      currency: business.currency,
      isDefault: business.isDefault,
      planId: business.planId,
      createdAt: business.createdAt,
      updatedAt: business.updatedAt,
      phone: business.phone,
      email: business.email,
      hasPinLock: business.pinHash !== null,
      trialEndsAt: business.trialEndsAt,
      monthlyFee:
        business.type === 'BUSINESS' && !business.isDefault
          ? await this.getAdditionalWorkspaceMonthlyFee(business.ownerId)
          : null,
    };
  }

  async update(businessId: string, member: RequestBusinessMember, dto: UpdateBusinessDto) {
    this.requireOwner(member);
    await this.requireBusiness(businessId);

    let pinHash: string | undefined;
    if (dto.pin !== undefined) {
      pinHash = await bcrypt.hash(dto.pin, 10);
    }

    const updated = await this.prisma.business.update({
      where: { id: businessId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(pinHash !== undefined && { pinHash }),
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      type: updated.type,
      currency: updated.currency,
      isDefault: updated.isDefault,
      phone: updated.phone,
      email: updated.email,
      hasPinLock: updated.pinHash !== null,
      trialEndsAt: updated.trialEndsAt,
      monthlyFee:
        updated.type === 'BUSINESS' && !updated.isDefault
          ? await this.getAdditionalWorkspaceMonthlyFee(updated.ownerId)
          : null,
    };
  }

  async remove(businessId: string, member: RequestBusinessMember) {
    this.requireOwner(member);
    const business = await this.requireBusiness(businessId);

    if (business.isDefault) {
      throw new BadRequestException('Cannot delete your default Personal workspace -- every account must always have exactly one.');
    }

    // TODO (Prompt 5, once the Transaction Engine exists): count real
    // transactions in this workspace and block deletion if any exist. There
    // are no transactions yet in Prompt 3, so this check currently always
    // passes -- it's here as a placeholder so the real check has an obvious
    // place to land later.
    const transactionCount = 0;
    if (transactionCount > 0) {
      throw new BadRequestException('Cannot delete a workspace that still has transactions.');
    }

    await this.prisma.business.update({ where: { id: businessId }, data: { deletedAt: new Date() } });
    return { success: true };
  }

  async verifyPin(businessId: string, pin: string): Promise<{ valid: boolean }> {
    const business = await this.requireBusiness(businessId);
    if (!business.pinHash) return { valid: true }; // no lock configured -- nothing to verify
    const valid = await bcrypt.compare(pin, business.pinHash);
    return { valid };
  }

  private requireOwner(member: RequestBusinessMember) {
    if (member.role !== 'OWNER') {
      throw new ForbiddenException('Only the workspace owner can do this');
    }
  }

  private async requireBusiness(businessId: string) {
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business || business.deletedAt) {
      throw new NotFoundException('Workspace not found');
    }
    return business;
  }
}
