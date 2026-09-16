import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListWorkspaceOverviewQueryDto } from './dto/list-workspace-overview-query.dto.js';

@Injectable()
export class AdminWorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(query: ListWorkspaceOverviewQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    // Only users who own at least one (non-soft-deleted) Business are
    // relevant here -- a real signup always gets a default PERSONAL
    // Business, so in practice this is "every registered user", but the
    // filter guards against a user whose only workspace(s) were all deleted.
    const where = { ownedBusinesses: { some: { deletedAt: null } } };

    const [owners, totalCount] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          ownedBusinesses: {
            where: { deletedAt: null },
            include: { plan: true },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    const items = owners.map((user) => this.summarizeUser(user));

    // Separate pass over the whole matching set (not just this page) so the
    // summary totals reflect every owner, not only the current page --
    // intentionally a second query rather than folding this into the paged
    // one above; fine at expected data volumes, not worth a single
    // aggregate-query rewrite yet.
    const allOwners = await this.prisma.user.findMany({
      where,
      include: {
        ownedBusinesses: {
          where: { deletedAt: null },
          include: { plan: true },
        },
      },
    });

    let totalAdditionalWorkspaces = 0;
    let totalEstimatedMonthlyAddOnRevenue = 0;
    for (const user of allOwners) {
      const { additionalWorkspaces, estimatedMonthlyAddOnRevenue } = this.summarizeUser(user);
      totalAdditionalWorkspaces += additionalWorkspaces;
      totalEstimatedMonthlyAddOnRevenue += Number(estimatedMonthlyAddOnRevenue);
    }

    return {
      summary: {
        totalUsers: totalCount,
        totalAdditionalWorkspaces,
        totalEstimatedMonthlyAddOnRevenue: totalEstimatedMonthlyAddOnRevenue.toFixed(2),
      },
      items,
      page,
      limit,
      totalCount,
    };
  }

  private summarizeUser(user: {
    id: string;
    name: string;
    email: string;
    ownedBusinesses: Array<{
      isDefault: boolean;
      plan: { name: string; price: unknown } | null;
    }>;
  }) {
    const defaultBusiness = user.ownedBusinesses.find((b) => b.isDefault);
    const additional = user.ownedBusinesses.filter((b) => !b.isDefault);
    const planPrice = defaultBusiness?.plan ? Number(defaultBusiness.plan.price) : null;
    const estimatedMonthlyAddOnRevenue = planPrice !== null ? additional.length * planPrice * 0.5 : 0;

    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      planName: defaultBusiness?.plan?.name ?? null,
      planPrice: planPrice !== null ? planPrice.toFixed(2) : null,
      totalWorkspaces: user.ownedBusinesses.length,
      additionalWorkspaces: additional.length,
      estimatedMonthlyAddOnRevenue: estimatedMonthlyAddOnRevenue.toFixed(2),
    };
  }
}
