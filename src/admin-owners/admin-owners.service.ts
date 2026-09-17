import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccountsService } from '../accounts/accounts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListOwnersQueryDto } from './dto/list-owners-query.dto.js';

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
      planName: business?.plan?.name ?? null,
      daysUsing,
      status: owner.status,
    };
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
