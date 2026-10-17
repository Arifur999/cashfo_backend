import { Injectable } from '@nestjs/common';
import { END_USER_WHERE } from '../common/roles.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListWorkspaceOverviewQueryDto } from './dto/list-workspace-overview-query.dto.js';

interface OwnerRow {
  id: string;
  name: string;
  email: string;
  ownedBusinesses: Array<{
    name: string;
    isDefault: boolean;
    type: string;
    plan: { name: string; price: unknown; billingCycle: string } | null;
  }>;
}

export interface WorkspaceOverviewItem {
  userId: string;
  name: string;
  email: string;
  workspaceNames: string[];
  planName: string | null;
  planPrice: string | null;
  totalWorkspaces: number;
  additionalWorkspaces: number;
  estimatedMonthlyAddOnRevenue: string;
}

// Biggest estimated add-on first; ties go to whoever has more extra
// workspaces, then by name so a page is stable between requests.
const byAddOnDesc = (a: WorkspaceOverviewItem, b: WorkspaceOverviewItem) =>
  Number(b.estimatedMonthlyAddOnRevenue) - Number(a.estimatedMonthlyAddOnRevenue) ||
  b.additionalWorkspaces - a.additionalWorkspaces ||
  a.name.localeCompare(b.name);

@Injectable()
export class AdminWorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  // Owners with at least one workspace besides their personal one -- what
  // the page lists and counts as "people with extra workspaces". (Every
  // signup owns a personal workspace, so without isDefault: false this was
  // simply every registered user.) The add-on fee is computed, so the sort
  // and the page happen in memory over every matching owner, which the
  // summary and the spread need in full anyway; fine at expected volumes.
  async overview(query: ListWorkspaceOverviewQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where = { ...END_USER_WHERE, ownedBusinesses: { some: { deletedAt: null, isDefault: false } } };
    const [owners, totalAccounts] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: {
          ownedBusinesses: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' }, include: { plan: true } },
        },
      }),
      // "Out of N accounts": every real owner, with one workspace or many.
      this.prisma.user.count({ where: { ...END_USER_WHERE, ownedBusinesses: { some: { deletedAt: null } } } }),
    ]);

    const all = owners.map((user) => this.summarizeUser(user)).sort(byAddOnDesc);

    let totalAdditionalWorkspaces = 0;
    let totalEstimatedMonthlyAddOnRevenue = 0;
    const usersByWorkspaceCount = new Map<number, number>();
    for (const item of all) {
      totalAdditionalWorkspaces += item.additionalWorkspaces;
      totalEstimatedMonthlyAddOnRevenue += Number(item.estimatedMonthlyAddOnRevenue);
      usersByWorkspaceCount.set(item.totalWorkspaces, (usersByWorkspaceCount.get(item.totalWorkspaces) ?? 0) + 1);
    }

    return {
      summary: {
        totalUsers: all.length,
        totalAccounts,
        totalAdditionalWorkspaces,
        totalEstimatedMonthlyAddOnRevenue: totalEstimatedMonthlyAddOnRevenue.toFixed(2),
        // How many owners have 2, 3, 4... workspaces, smallest count first.
        spread: [...usersByWorkspaceCount].sort(([a], [b]) => a - b).map(([workspaces, users]) => ({ workspaces, users })),
      },
      items: all.slice((page - 1) * limit, page * limit),
      page,
      limit,
      totalCount: all.length,
    };
  }

  private summarizeUser(user: OwnerRow): WorkspaceOverviewItem {
    const defaultBusiness = user.ownedBusinesses.find((b) => b.isDefault);
    const additional = user.ownedBusinesses.filter((b) => !b.isDefault);
    const planPrice = defaultBusiness?.plan ? Number(defaultBusiness.plan.price) : null;
    // The add-on fee is half the owner's plan per month, charged for extra
    // BUSINESS workspaces only (group workspaces are free); a yearly plan's
    // price covers twelve months.
    const monthlyPlanPrice = planPrice !== null && defaultBusiness?.plan?.billingCycle === 'YEARLY' ? planPrice / 12 : planPrice;
    const billable = additional.filter((b) => b.type === 'BUSINESS').length;
    const estimatedMonthlyAddOnRevenue = monthlyPlanPrice !== null ? billable * monthlyPlanPrice * 0.5 : 0;

    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      workspaceNames: user.ownedBusinesses.map((b) => b.name),
      planName: defaultBusiness?.plan?.name ?? null,
      planPrice: planPrice !== null ? planPrice.toFixed(2) : null,
      totalWorkspaces: user.ownedBusinesses.length,
      additionalWorkspaces: additional.length,
      estimatedMonthlyAddOnRevenue: estimatedMonthlyAddOnRevenue.toFixed(2),
    };
  }
}
