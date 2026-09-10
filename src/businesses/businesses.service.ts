import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { WorkspaceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateBusinessDto } from './dto/create-business.dto.js';
import { UpdateBusinessDto } from './dto/update-business.dto.js';
import { RequestBusinessMember } from './interfaces/request-business-member.interface.js';

interface FeatureLimits {
  maxBusinessWorkspaces?: number;
  [key: string]: unknown;
}

@Injectable()
export class BusinessesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const memberships = await this.prisma.businessMember.findMany({
      where: { userId, status: 'ACTIVE', business: { deletedAt: null } },
      include: { business: true },
      orderBy: { joinedAt: 'asc' },
    });

    return memberships.map((m) => ({
      id: m.business.id,
      name: m.business.name,
      type: m.business.type,
      currency: m.business.currency,
      isDefault: m.business.isDefault,
      role: m.role,
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

  async getLimits(userId: string) {
    const { maxBusinessWorkspaces, currentCount } = await this.getPlanLimitInfo(userId);
    const atLimit = maxBusinessWorkspaces !== -1 && currentCount >= maxBusinessWorkspaces;
    return { maxBusinessWorkspaces, currentCount, atLimit };
  }

  async create(userId: string, dto: CreateBusinessDto) {
    if (dto.type !== WorkspaceType.BUSINESS) {
      throw new BadRequestException(
        'Only BUSINESS-type workspaces can be created here -- every account already has one PERSONAL workspace created automatically at signup.',
      );
    }

    const { maxBusinessWorkspaces, currentCount, planId } = await this.getPlanLimitInfo(userId);

    if (maxBusinessWorkspaces !== -1 && currentCount >= maxBusinessWorkspaces) {
      const message =
        maxBusinessWorkspaces === 0
          ? 'Your current plan does not include business workspaces. Upgrade to add one.'
          : `Your plan allows up to ${maxBusinessWorkspaces} business workspace(s). Upgrade to add more.`;
      throw new ForbiddenException(message);
    }

    return this.prisma.$transaction(async (tx) => {
      const business = await tx.business.create({
        data: {
          ownerId: userId,
          name: dto.name,
          type: WorkspaceType.BUSINESS,
          currency: dto.currency ?? 'BDT',
          planId,
          isDefault: false,
        },
      });

      await tx.businessMember.create({
        data: { businessId: business.id, userId, role: 'OWNER' },
      });

      return { id: business.id, name: business.name, type: business.type, currency: business.currency, isDefault: business.isDefault, role: 'OWNER' as const };
    });
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
    };
  }

  async update(businessId: string, member: RequestBusinessMember, dto: UpdateBusinessDto) {
    this.requireOwner(member);
    await this.requireBusiness(businessId);

    const updated = await this.prisma.business.update({
      where: { id: businessId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
      },
    });

    return { id: updated.id, name: updated.name, type: updated.type, currency: updated.currency, isDefault: updated.isDefault };
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
