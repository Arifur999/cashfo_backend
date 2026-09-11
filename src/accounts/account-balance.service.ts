import { Injectable, NotFoundException } from '@nestjs/common';
import { AccountType, Prisma } from '@prisma/client';
import { MONEY_ACCOUNT_SUBTYPES } from './accounts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Accounting rule (product blueprint): for ASSET/EXPENSE accounts, DEBIT
// increases the balance and CREDIT decreases it; for LIABILITY/EQUITY/
// INCOME accounts, it's the reverse. Exported (Prompt 7) so ReportsService
// can reuse the exact same rule for the Trial Balance's debit/credit column
// split rather than redefining it.
export function isDebitPositive(accountType: AccountType): boolean {
  return accountType === 'ASSET' || accountType === 'EXPENSE';
}

export interface LedgerFilters {
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class AccountBalanceService {
  constructor(private readonly prisma: PrismaService) {}

  // Recomputes an account's balance FROM SCRATCH (openingBalance + every
  // entry, never from the cached value) and writes it back to
  // Account.currentBalance. Accepts an optional transaction client so
  // TransactionsService can call this inside the SAME $transaction as the
  // entries that changed the balance -- the cache must never be visibly
  // stale even for a moment between commits.
  //
  // IMPORTANT: this sums EVERY entry regardless of the parent Transaction's
  // status, including VOIDED ones. voidTransaction() never deletes or
  // excludes the original's entries -- it creates a new reversal
  // Transaction with mirrored entries, and the two together net to exactly
  // zero. Filtering out VOIDED transactions here would double-count the
  // cancellation: the original's contribution would vanish while the
  // reversal's opposite-direction entry would still count, leaving the
  // balance offset by 2x the voided amount instead of back at zero. There
  // is no "draft" status in this schema (TransactionStatus is only
  // POSTED/VOIDED) -- every entry that exists was a real, intentional
  // posting, so nothing should ever be excluded from this sum.
  async recalculateBalance(accountId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;

    const account = await client.account.findUnique({ where: { id: accountId } });
    if (!account) {
      throw new NotFoundException('Account not found');
    }

    const [debitAgg, creditAgg] = await Promise.all([
      client.transactionEntry.aggregate({
        where: { accountId, entryType: 'DEBIT' },
        _sum: { amount: true },
      }),
      client.transactionEntry.aggregate({
        where: { accountId, entryType: 'CREDIT' },
        _sum: { amount: true },
      }),
    ]);

    const debitTotal = new Prisma.Decimal(debitAgg._sum.amount ?? 0);
    const creditTotal = new Prisma.Decimal(creditAgg._sum.amount ?? 0);
    const opening = new Prisma.Decimal(account.openingBalance);

    const balance = isDebitPositive(account.accountType)
      ? opening.plus(debitTotal).minus(creditTotal)
      : opening.plus(creditTotal).minus(debitTotal);

    await client.account.update({ where: { id: accountId }, data: { currentBalance: balance } });
    return balance;
  }

  // Every entry touching this account, chronologically, with a running
  // balance computed the same way recalculateBalance() computes the final
  // one. Prompt 7 adds dateFrom/dateTo/page/limit:
  //
  // - dateFrom/dateTo only narrow which entries are DISPLAYED -- they never
  //   change what the running balance starts from. balanceBroughtForward is
  //   openingBalance + every entry strictly BEFORE dateFrom (computed
  //   separately, in full, regardless of pagination), so the displayed
  //   running balance is always the TRUE cumulative figure, never a false
  //   restart at zero just because the view is filtered.
  // - Pagination: fetches every entry from the start of the (possibly
  //   date-filtered) range through the END of the requested page, computes
  //   the running balance over that whole prefix in order, then slices out
  //   just the requested page for the response. This is deliberately O(page
  //   * limit) rather than O(limit) -- a running balance is only correct if
  //   computed from a real starting point through every prior entry in
  //   order, so a later page's entries genuinely depend on every entry
  //   before them. Fine at this app's realistic scale (a personal/small-
  //   business account's entry count); a materialized running-balance-
  //   checkpoint strategy would be the right fix if accounts ever grow into
  //   the tens of thousands of entries, but that's premature here.
  async getLedger(businessId: string, accountId: string, filters: LedgerFilters = {}) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.businessId !== businessId) {
      throw new NotFoundException('Account not found');
    }

    const debitPositive = isDebitPositive(account.accountType);
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 50;

    let balanceBroughtForward = new Prisma.Decimal(account.openingBalance);
    if (filters.dateFrom) {
      const priorEntries = await this.prisma.transactionEntry.findMany({
        where: { accountId, transaction: { transactionDate: { lt: new Date(filters.dateFrom) } } },
        select: { entryType: true, amount: true },
      });
      for (const entry of priorEntries) {
        const amount = new Prisma.Decimal(entry.amount);
        const delta = entry.entryType === 'DEBIT' ? (debitPositive ? amount : amount.negated()) : debitPositive ? amount.negated() : amount;
        balanceBroughtForward = balanceBroughtForward.plus(delta);
      }
    }

    const dateFilter: Prisma.DateTimeFilter = {};
    if (filters.dateFrom) dateFilter.gte = new Date(filters.dateFrom);
    if (filters.dateTo) dateFilter.lte = new Date(filters.dateTo);
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    const where: Prisma.TransactionEntryWhereInput = {
      accountId,
      ...(hasDateFilter && { transaction: { transactionDate: dateFilter } }),
    };

    const [total, entriesUpToPageEnd] = await Promise.all([
      this.prisma.transactionEntry.count({ where }),
      this.prisma.transactionEntry.findMany({
        where,
        include: { transaction: true },
        orderBy: [{ transaction: { transactionDate: 'asc' } }, { transaction: { createdAt: 'asc' } }],
        take: page * limit,
      }),
    ]);

    let running = balanceBroughtForward;
    const allRows = entriesUpToPageEnd.map((entry) => {
      const amount = new Prisma.Decimal(entry.amount);
      const delta = entry.entryType === 'DEBIT' ? (debitPositive ? amount : amount.negated()) : debitPositive ? amount.negated() : amount;
      running = running.plus(delta);
      return {
        entryId: entry.id,
        transactionId: entry.transactionId,
        date: entry.transaction.transactionDate,
        description: entry.transaction.description,
        referenceNo: entry.transaction.referenceNo,
        entryType: entry.entryType,
        amount: entry.amount,
        transactionStatus: entry.transaction.status,
        runningBalance: running,
      };
    });

    const pageRows = allRows.slice((page - 1) * limit, page * limit);

    return {
      accountId,
      accountName: account.name,
      openingBalance: account.openingBalance,
      balanceBroughtForward: balanceBroughtForward.toFixed(2),
      entries: pageRows,
      // Balance at the end of the LAST row actually returned in this page --
      // not necessarily the account's true current balance if a dateTo
      // filter or earlier page cuts off before the most recent activity.
      closingBalance: (pageRows.length > 0 ? pageRows[pageRows.length - 1].runningBalance : balanceBroughtForward).toFixed(2),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // Quick stats for the account detail page header. "Money In"/"Money Out"
  // are from the friendly, balance-direction perspective (matches Prompt
  // 6's language) -- NOT raw debit/credit: for a debit-positive account
  // (ASSET/EXPENSE) a DEBIT is "in" and a CREDIT is "out"; reversed for
  // credit-positive accounts. Accepts the same optional dateFrom/dateTo as
  // the ledger so the header cards match whatever range the user has
  // selected.
  async getAccountSummary(businessId: string, accountId: string, filters: { dateFrom?: string; dateTo?: string } = {}) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.businessId !== businessId) {
      throw new NotFoundException('Account not found');
    }

    const dateFilter: Prisma.DateTimeFilter = {};
    if (filters.dateFrom) dateFilter.gte = new Date(filters.dateFrom);
    if (filters.dateTo) dateFilter.lte = new Date(filters.dateTo);
    const hasDateFilter = Object.keys(dateFilter).length > 0;
    const where: Prisma.TransactionEntryWhereInput = {
      accountId,
      ...(hasDateFilter && { transaction: { transactionDate: dateFilter } }),
    };

    const [debitAgg, creditAgg, transactionCount] = await Promise.all([
      this.prisma.transactionEntry.aggregate({ where: { ...where, entryType: 'DEBIT' }, _sum: { amount: true } }),
      this.prisma.transactionEntry.aggregate({ where: { ...where, entryType: 'CREDIT' }, _sum: { amount: true } }),
      this.prisma.transactionEntry.count({ where }),
    ]);

    const debitTotal = new Prisma.Decimal(debitAgg._sum.amount ?? 0);
    const creditTotal = new Prisma.Decimal(creditAgg._sum.amount ?? 0);
    const debitPositive = isDebitPositive(account.accountType);

    return {
      currentBalance: account.currentBalance,
      totalIn: (debitPositive ? debitTotal : creditTotal).toFixed(2),
      totalOut: (debitPositive ? creditTotal : debitTotal).toFixed(2),
      transactionCount,
    };
  }

  // Balance Overview page (the Wallet group's summary dashboard): every
  // money account with its opening/in/out/current figures, plus workspace-
  // wide totals. Money accounts are always ASSET type, so debit=in,
  // credit=out uniformly -- no per-account isDebitPositive check needed
  // the way getAccountSummary() needs one for a general account. Built as
  // exactly 2 queries (accounts + one grouped entry aggregate) rather than
  // one getAccountSummary() call per account -- both to avoid N+1 queries
  // and because this app's local dev Postgres has shown it can drop
  // connections under concurrent per-account query fan-out (see the
  // Receivable/Payable module's comments on the same issue).
  async getWalletsOverview(businessId: string) {
    const accounts = await this.prisma.account.findMany({
      where: { businessId, accountType: 'ASSET', accountSubtype: { in: MONEY_ACCOUNT_SUBTYPES } },
      orderBy: { displayOrder: 'asc' },
    });
    const accountIds = accounts.map((a) => a.id);

    const grouped =
      accountIds.length === 0
        ? []
        : await this.prisma.transactionEntry.groupBy({
            by: ['accountId', 'entryType'],
            where: { accountId: { in: accountIds } },
            _sum: { amount: true },
          });

    const inByAccount = new Map<string, Prisma.Decimal>();
    const outByAccount = new Map<string, Prisma.Decimal>();
    for (const row of grouped) {
      const amount = new Prisma.Decimal(row._sum.amount ?? 0);
      const target = row.entryType === 'DEBIT' ? inByAccount : outByAccount;
      target.set(row.accountId, amount);
    }

    let totalBalance = new Prisma.Decimal(0);
    let inactiveAmount = new Prisma.Decimal(0);
    const rows = accounts.map((account) => {
      const balance = new Prisma.Decimal(account.currentBalance);
      totalBalance = totalBalance.plus(balance);
      if (account.status === 'ARCHIVED') {
        inactiveAmount = inactiveAmount.plus(balance);
      }
      return {
        id: account.id,
        name: account.name,
        nameBn: account.nameBn,
        accountNumber: account.accountNumber,
        status: account.status,
        openingBalance: account.openingBalance.toFixed(2),
        totalIn: (inByAccount.get(account.id) ?? new Prisma.Decimal(0)).toFixed(2),
        totalOut: (outByAccount.get(account.id) ?? new Prisma.Decimal(0)).toFixed(2),
        currentBalance: balance.toFixed(2),
      };
    });

    return {
      totalAccounts: accounts.length,
      totalBalance: totalBalance.toFixed(2),
      inactiveAmount: inactiveAmount.toFixed(2),
      availableBalance: totalBalance.minus(inactiveAmount).toFixed(2),
      accounts: rows,
    };
  }

  // Data-integrity safety net: recalculates every account in a workspace
  // from scratch and reports any that didn't match their cached value
  // BEFORE this call overwrote it. Zero discrepancies proves the caching
  // approach (update-on-write rather than compute-on-read) is trustworthy.
  async reconcileWorkspace(businessId: string) {
    const accounts = await this.prisma.account.findMany({ where: { businessId } });

    const discrepancies: { accountId: string; name: string; cachedBalance: string; recalculatedBalance: string }[] = [];
    for (const account of accounts) {
      const cached = new Prisma.Decimal(account.currentBalance);
      const recalculated = await this.recalculateBalance(account.id);
      if (!cached.equals(recalculated)) {
        discrepancies.push({
          accountId: account.id,
          name: account.name,
          cachedBalance: cached.toFixed(2),
          recalculatedBalance: recalculated.toFixed(2),
        });
      }
    }

    return { totalAccounts: accounts.length, discrepancyCount: discrepancies.length, discrepancies };
  }
}
