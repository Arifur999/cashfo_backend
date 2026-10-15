import { BadRequestException, Injectable } from '@nestjs/common';
import { AccountType, Prisma } from '@prisma/client';
import { isDebitPositive } from '../accounts/account-balance.service.js';
import { dhakaMonthRange } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CategoryBreakdownQueryDto } from './dto/category-breakdown-query.dto.js';
import { GeneralLedgerQueryDto } from './dto/general-ledger-query.dto.js';
import { MonthlyBreakdownQueryDto } from './dto/monthly-breakdown-query.dto.js';
import { MAX_REPORT_MONTHS, monthBucketsBetween } from './month-buckets.js';

const ACCOUNT_TYPE_ORDER: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];

// Same 8 keys as BudgetCategory.color (see budget-category-visuals.ts) --
// reused here as a deterministic fallback for a category with no matching
// BudgetCategory row (e.g. one entered by hand via the Advanced Raw Journal
// Entry form, or one whose BudgetCategory was since deleted), cycled by
// rank so the chart still gets a distinct color per slice.
const FALLBACK_COLORS = ['blue', 'green', 'purple', 'orange', 'pink', 'yellow', 'red', 'indigo'];

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // General Ledger (product blueprint PART 8): every account in the
  // workspace, grouped in the standard 5-category order, each showing its
  // current balance -- NOT its full entry list. Prompt 7 explicitly offers
  // a choice between inlining every account's entries here or linking out
  // to /accounts/:id for the full statement; this takes the link-out
  // approach; deliberately, since inlining would mean this one response
  // could carry every entry from every account in the workspace at once
  // (the exact "heavy endpoint" the prompt warns about) -- Account.currentBalance
  // is already kept correct by the Transaction Engine (Prompt 5) and
  // verified by /accounts/reconcile, so re-deriving it here would be
  // redundant work for no benefit. Pagination (page/limit) applies to the
  // flat, already-sorted account list BEFORE it's split into type groups --
  // at this app's realistic Chart-of-Accounts size (a few dozen accounts at
  // most) every workspace fits on page 1 by default, but the params are
  // honored if a caller ever needs them.
  async getGeneralLedger(businessId: string, filters: GeneralLedgerQueryDto = {}) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 100;

    const [total, accounts] = await Promise.all([
      this.prisma.account.count({ where: { businessId } }),
      this.prisma.account.findMany({
        where: { businessId },
        orderBy: [{ accountType: 'asc' }, { displayOrder: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const groups = ACCOUNT_TYPE_ORDER.map((accountType) => ({
      accountType,
      accounts: accounts
        .filter((a) => a.accountType === accountType)
        .map((a) => ({
          id: a.id,
          name: a.name,
          nameBn: a.nameBn,
          accountSubtype: a.accountSubtype,
          currentBalance: a.currentBalance,
          isSystemAccount: a.isSystemAccount,
          status: a.status,
        })),
    }));

    return { groups, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  // Trial Balance (product blueprint PART 8): every account's closing
  // balance split into a Debit or Credit column based on its type's normal
  // balance side, with a total row. This is both a real report AND a live
  // diagnostic of the Transaction Engine -- the two totals are
  // mathematically guaranteed to match if (and only if) every transaction
  // ever posted was genuinely balanced, which is exactly what
  // TransactionsService.createTransaction() enforces at write time. Uses
  // the CACHED Account.currentBalance (kept correct on every create/void,
  // and independently verified by /accounts/reconcile) rather than
  // recalculating from raw entries -- there's no reason to redo that work
  // here.
  //
  // Includes EVERY account regardless of ACTIVE/ARCHIVED status --
  // Prompt 4's archive() only blocks archiving an account that still has
  // active CHILDREN, not one with a nonzero balance, so an archived account
  // can still be carrying real money. Excluding it would silently break the
  // debit=credit identity this report exists to prove.
  async getTrialBalance(businessId: string) {
    const accounts = await this.prisma.account.findMany({
      where: { businessId },
      orderBy: [{ accountType: 'asc' }, { displayOrder: 'asc' }],
    });

    let totalDebit = new Prisma.Decimal(0);
    let totalCredit = new Prisma.Decimal(0);

    const rows = accounts.map((account) => {
      const balance = new Prisma.Decimal(account.currentBalance);
      const debitPositive = isDebitPositive(account.accountType);

      // Standard trial balance convention: never show a negative number --
      // an account sitting on the "wrong" side of its normal balance (e.g.
      // an overdrawn cash account) flips into the OTHER column instead.
      let debit = new Prisma.Decimal(0);
      let credit = new Prisma.Decimal(0);
      if (debitPositive) {
        if (balance.gte(0)) debit = balance;
        else credit = balance.abs();
      } else {
        if (balance.gte(0)) credit = balance;
        else debit = balance.abs();
      }

      totalDebit = totalDebit.plus(debit);
      totalCredit = totalCredit.plus(credit);

      return {
        accountId: account.id,
        name: account.name,
        nameBn: account.nameBn,
        accountType: account.accountType,
        status: account.status,
        debit: debit.toFixed(2),
        credit: credit.toFixed(2),
      };
    });

    return {
      rows,
      totalDebit: totalDebit.toFixed(2),
      totalCredit: totalCredit.toFixed(2),
      isBalanced: totalDebit.equals(totalCredit),
    };
  }

  // Financial Reports page's two donut cards (Income by Category / Expense
  // by Category). "total" is the TRUE total across every category in
  // range, even though "categories" is capped at the top 10 by amount --
  // so a workspace with more than 10 categories still shows a correct
  // total/percent breakdown, just with the smaller categories omitted from
  // the list (same "top N, real total" convention as any typical top-N
  // report). Same "categoryId != null picks exactly one side of the
  // double-entry pair" trick used elsewhere (see
  // BudgetsService.listIncomeGoals()'s comment).
  async getCategoryBreakdown(businessId: string, query: CategoryBreakdownQueryDto) {
    const dateFilter: Prisma.DateTimeFilter = {};
    if (query.dateFrom) dateFilter.gte = new Date(query.dateFrom);
    if (query.dateTo) dateFilter.lte = new Date(query.dateTo);
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    const grouped = await this.prisma.transactionEntry.groupBy({
      by: ['categoryId'],
      where: {
        categoryId: { not: null },
        transaction: { businessId, status: 'POSTED', reversalOfId: null, transactionType: query.type, ...(hasDateFilter && { transactionDate: dateFilter }) },
      },
      _sum: { amount: true },
    });

    const categoryNames = grouped.map((g) => g.categoryId).filter((v): v is string => !!v);
    const budgetCategories = categoryNames.length
      ? await this.prisma.budgetCategory.findMany({ where: { businessId, type: query.type, name: { in: categoryNames } } })
      : [];
    const colorByName = new Map(budgetCategories.map((c) => [c.name, c.color]));

    const withAmounts = grouped
      .map((g, i) => ({
        name: g.categoryId!,
        amount: new Prisma.Decimal(g._sum.amount ?? 0),
        color: colorByName.get(g.categoryId!) ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
      }))
      .sort((a, b) => b.amount.comparedTo(a.amount));

    const total = withAmounts.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0));

    return {
      type: query.type,
      total: total.toFixed(2),
      categories: withAmounts.slice(0, 10).map((row) => ({
        name: row.name,
        amount: row.amount.toFixed(2),
        percent: total.isZero() ? 0 : Math.round(row.amount.dividedBy(total).times(100).toNumber()),
        color: row.color,
      })),
    };
  }

  // Insights › Reports: every category of one type, with a column per
  // calendar month in the range. The same "categoryId picks one side of the
  // pair" rule as getCategoryBreakdown(), but nothing is capped: the table
  // is the place a customer goes for every row. One groupBy per month
  // (at most MAX_REPORT_MONTHS) rather than a raw date_trunc, like the
  // trend below. `accountId` keeps only the transactions that touched that
  // wallet (the entry on the wallet side is the other half of the pair).
  async getMonthlyBreakdown(businessId: string, query: MonthlyBreakdownQueryDto) {
    const buckets = monthBucketsBetween(query.dateFrom, query.dateTo);
    if (buckets.length === 0) throw new BadRequestException(`Pick a range of 1 to ${MAX_REPORT_MONTHS} months, oldest day first`);

    const grouped = await Promise.all(
      buckets.map((bucket) =>
        this.prisma.transactionEntry.groupBy({
          by: ['categoryId'],
          where: {
            categoryId: { not: null },
            transaction: {
              businessId,
              status: 'POSTED',
              reversalOfId: null,
              transactionType: query.type,
              transactionDate: { gte: bucket.start, lt: bucket.end },
              ...(query.accountId && { entries: { some: { accountId: query.accountId } } }),
            },
          },
          _sum: { amount: true },
        }),
      ),
    );

    const byName = new Map<string, Prisma.Decimal[]>();
    grouped.forEach((rows, monthIndex) => {
      for (const row of rows) {
        if (!row.categoryId) continue;
        const amounts = byName.get(row.categoryId) ?? buckets.map(() => new Prisma.Decimal(0));
        amounts[monthIndex] = new Prisma.Decimal(row._sum.amount ?? 0);
        byName.set(row.categoryId, amounts);
      }
    });

    const names = [...byName.keys()];
    const budgetCategories = names.length ? await this.prisma.budgetCategory.findMany({ where: { businessId, type: query.type, name: { in: names } } }) : [];
    const colorByName = new Map(budgetCategories.map((c) => [c.name, c.color]));
    const sum = (values: Prisma.Decimal[]) => values.reduce((acc, v) => acc.plus(v), new Prisma.Decimal(0));

    const rows = names
      .map((name, i) => ({ name, color: colorByName.get(name) ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length], amounts: byName.get(name)!, total: sum(byName.get(name)!) }))
      .sort((a, b) => b.total.comparedTo(a.total));
    const totals = buckets.map((_, monthIndex) => sum(rows.map((row) => row.amounts[monthIndex])));

    return {
      type: query.type,
      months: buckets.map((bucket) => bucket.key),
      rows: rows.map((row) => ({ name: row.name, color: row.color, amounts: row.amounts.map((a) => a.toFixed(2)), total: row.total.toFixed(2) })),
      totals: totals.map((t) => t.toFixed(2)),
      total: sum(totals).toFixed(2),
    };
  }

  // Financial Reports page's "Income vs Savings" trend chart -- the last
  // `months` calendar months (oldest first), each with that month's total
  // Income (same categorized-entry trick as above) and total Savings Goal
  // contributions (see SavingsGoalsService.getOverview()'s "savedThisMonth"
  // for the identical per-month aggregate, just repeated across a range
  // instead of just the current month). Sequential per-month queries
  // rather than one grouped query spanning the whole range -- simplest way
  // to get a fixed month bucket per point without a raw SQL date_trunc,
  // and negligible cost at `months` <= ~24.
  async getIncomeVsSavingsTrend(businessId: string, months: number) {
    const points: { month: string; monthKey: string; income: string; savings: string }[] = [];

    // Months on the Dhaka calendar (the server clock is UTC, still last
    // month for the first six hours of each one here).
    for (let i = months - 1; i >= 0; i--) {
      const { start: monthStart, end: monthEnd } = dhakaMonthRange(-i);

      const [incomeAgg, savingsAgg] = await Promise.all([
        this.prisma.transactionEntry.aggregate({
          _sum: { amount: true },
          where: {
            categoryId: { not: null },
            transaction: { businessId, status: 'POSTED', reversalOfId: null, transactionType: 'INCOME', transactionDate: { gte: monthStart, lt: monthEnd } },
          },
        }),
        this.prisma.savingsGoalEntry.aggregate({
          _sum: { amount: true },
          where: { businessId, type: 'CONTRIBUTION', date: { gte: monthStart, lt: monthEnd } },
        }),
      ]);

      points.push({
        // A fixed English label (the server's own locale used to decide
        // it), plus YYYY-MM for a client that labels months itself.
        month: monthStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
        monthKey: monthStart.toISOString().slice(0, 7),
        income: new Prisma.Decimal(incomeAgg._sum.amount ?? 0).toFixed(2),
        savings: new Prisma.Decimal(savingsAgg._sum.amount ?? 0).toFixed(2),
      });
    }

    return points;
  }
}
