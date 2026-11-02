import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dayDate, entryTotals, isDebitPositive, LIVE_TRANSACTION, signedNet } from './account-figures.js';
import { BALANCE_ADJUSTMENT_ACCOUNT_SUBTYPE, MONEY_ACCOUNT_SUBTYPES } from './accounts.service.js';
import { LEDGER_KINDS, ledgerKind, ledgerRowMatches, type LedgerKind } from './ledger-kind.js';
import { PrismaService } from '../prisma/prisma.service.js';

// The accounting rule lives in account-figures.ts; still exported from here
// for ReportsService's Trial Balance.
export { isDebitPositive } from './account-figures.js';

export interface LedgerFilters {
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
  direction?: 'in' | 'out';
  kind?: LedgerKind;
  search?: string;
  standingOnly?: boolean;
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

    // Sequential, not Promise.all -- reconcileWorkspace() calls this once
    // per account in a loop (outside any interactive transaction, so each
    // call's queries genuinely compete for separate pool connections), and
    // this local dev Postgres has grown increasingly prone to dropping
    // connections under concurrent query load over the course of long
    // sessions. Negligible latency cost for two quick aggregates.
    const debitAgg = await client.transactionEntry.aggregate({
      where: { accountId, entryType: 'DEBIT' },
      _sum: { amount: true },
    });
    const creditAgg = await client.transactionEntry.aggregate({
      where: { accountId, entryType: 'CREDIT' },
      _sum: { amount: true },
    });

    const debitTotal = new Prisma.Decimal(debitAgg._sum.amount ?? 0);
    const creditTotal = new Prisma.Decimal(creditAgg._sum.amount ?? 0);
    const opening = new Prisma.Decimal(account.openingBalance);

    const balance = isDebitPositive(account.accountType) ? opening.plus(debitTotal).minus(creditTotal) : opening.plus(creditTotal).minus(debitTotal);

    await client.account.update({ where: { id: accountId }, data: { currentBalance: balance } });
    return balance;
  }

  // Every entry touching this account, chronologically, with a running
  // balance computed the same way recalculateBalance() computes the final
  // one. Prompt 7 adds dateFrom/dateTo/page/limit:
  //
  // - dateFrom/dateTo only narrow which entries are DISPLAYED -- they never
  //   change what the running balance starts from. balanceBroughtForward is
  //   openingBalance + every entry strictly BEFORE dateFrom (two SUM
  //   aggregates, regardless of pagination), so the displayed running
  //   balance is always the TRUE cumulative figure, never a false restart
  //   at zero just because the view is filtered.
  // - closingBalance is the PERIOD's closing figure: brought forward plus
  //   every entry in the range, also summed by aggregate, so it's the same
  //   on every page. pageOpeningBalance/pageClosingBalance are the running
  //   balance just before the page's first row and after its last one, for
  //   a "carried over" line between pages. A page past the end has no rows
  //   and sits after the period's last entry, so both equal closingBalance.
  // - Pagination: fetches every entry in the (possibly date-filtered)
  //   range, computes the running balance over all of them in order, then
  //   slices out the requested page. A running balance is only correct if
  //   computed from a real starting point through every prior entry, and the
  //   filters' counts (received, sent, the kinds there are) need every row
  //   anyway. Fine at this app's realistic scale (a personal/small-business
  //   account's entry count); a materialized running-balance-checkpoint
  //   strategy would be the right fix if accounts ever grow into the tens
  //   of thousands of entries, but that's premature here.
  // - direction / kind / search narrow the rows shown, never the balances:
  //   each row keeps the running balance the whole period gives it.
  async getLedger(businessId: string, accountId: string, filters: LedgerFilters = {}) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.businessId !== businessId) {
      throw new NotFoundException('Account not found');
    }

    const debitPositive = isDebitPositive(account.accountType);
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 50;

    const dateFilter: Prisma.DateTimeFilter = {};
    if (filters.dateFrom) dateFilter.gte = new Date(filters.dateFrom);
    if (filters.dateTo) dateFilter.lte = new Date(filters.dateTo);
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    const standing = filters.standingOnly ? LIVE_TRANSACTION : {};
    const where: Prisma.TransactionEntryWhereInput = {
      accountId,
      ...((hasDateFilter || filters.standingOnly) && { transaction: { ...standing, ...(hasDateFilter && { transactionDate: dateFilter }) } }),
    };

    const [priorMovement, entries] = await Promise.all([
      filters.dateFrom
        ? this.netMovement({ accountId, transaction: { ...standing, transactionDate: { lt: new Date(filters.dateFrom) } } }, debitPositive)
        : new Prisma.Decimal(0),
      this.prisma.transactionEntry.findMany({
        where,
        // The transaction's other legs name where the money came from or
        // went to (a statement's particulars); its contact names a loan's
        // or a payment's other side.
        include: {
          transaction: {
            include: {
              entries: { select: { accountId: true, categoryId: true, account: { select: { name: true, accountSubtype: true } } } },
              contact: { select: { name: true, category: true } },
            },
          },
        },
        // The entry id breaks ties (one date holds many transactions, and a
        // transaction can touch the account twice) so every request sees the
        // same order and a row never shows on two pages or none.
        orderBy: [{ transaction: { transactionDate: 'asc' } }, { transaction: { createdAt: 'asc' } }, { id: 'asc' }],
      }),
    ]);

    // What the period's transactions belong to: an asset bought or sold, a
    // savings goal's move, and for a transfer's charge, the transfer's
    // receiving account.
    const transactionIds = [...new Set(entries.map((entry) => entry.transactionId))];
    const chargeForIds = [...new Set(entries.map((entry) => entry.transaction.chargeForId).filter((id): id is string => !!id))];
    const [assets, goalEntries, chargedTransfers] =
      transactionIds.length === 0
        ? [[], [], []]
        : await Promise.all([
            this.prisma.asset.findMany({
              where: { businessId, OR: [{ purchaseTransactionId: { in: transactionIds } }, { soldTransactionId: { in: transactionIds } }] },
              select: { id: true, name: true, purchaseTransactionId: true, soldTransactionId: true },
            }),
            this.prisma.savingsGoalEntry.findMany({ where: { businessId, transactionId: { in: transactionIds } }, select: { transactionId: true, savingsGoal: { select: { name: true } } } }),
            chargeForIds.length
              ? this.prisma.transactionEntry.findMany({ where: { transactionId: { in: chargeForIds }, entryType: 'DEBIT' }, select: { transactionId: true, account: { select: { name: true } } } })
              : [],
          ]);
    const assetBy = new Map<string, { id: string; name: string; side: 'PURCHASE' | 'SALE' }>();
    for (const asset of assets) {
      if (asset.purchaseTransactionId) assetBy.set(asset.purchaseTransactionId, { id: asset.id, name: asset.name, side: 'PURCHASE' });
      if (asset.soldTransactionId) assetBy.set(asset.soldTransactionId, { id: asset.id, name: asset.name, side: 'SALE' });
    }
    const goalBy = new Map(goalEntries.filter((entry) => entry.transactionId).map((entry) => [entry.transactionId!, entry.savingsGoal.name]));
    const chargedToBy = new Map(chargedTransfers.map((entry) => [entry.transactionId, entry.account.name]));

    const balanceBroughtForward = new Prisma.Decimal(account.openingBalance).plus(priorMovement);
    let running = balanceBroughtForward;
    const allRows = entries.map((entry) => {
      const amount = new Prisma.Decimal(entry.amount);
      const raises = (entry.entryType === 'DEBIT') === debitPositive;
      const balanceBefore = running;
      running = running.plus(raises ? amount : amount.negated());
      const legs = (entry.transaction.entries ?? []).filter((leg) => leg.accountId !== accountId);
      const asset = assetBy.get(entry.transactionId) ?? null;
      const { kind, party } = ledgerKind({
        transactionType: entry.transaction.transactionType,
        direction: raises ? 'in' : 'out',
        accountSubtype: account.accountSubtype,
        legs: legs.map((leg) => ({ accountName: leg.account.name, accountSubtype: leg.account.accountSubtype, categoryId: leg.categoryId })),
        contact: entry.transaction.contact ? { name: entry.transaction.contact.name, category: entry.transaction.contact.category } : null,
        asset,
        goalName: goalBy.get(entry.transactionId) ?? null,
        adjustmentSubtype: BALANCE_ADJUSTMENT_ACCOUNT_SUBTYPE,
      });
      return {
        entryId: entry.id,
        transactionId: entry.transactionId,
        transactionType: entry.transaction.transactionType,
        date: entry.transaction.transactionDate,
        // A quick entry keeps its note on the entry, not the transaction; a
        // statement row still deserves the words.
        description: entry.transaction.description ?? entry.note,
        referenceNo: entry.transaction.referenceNo,
        entryType: entry.entryType,
        amount: entry.amount,
        transactionStatus: entry.transaction.status,
        // The posting this row's transaction reversed. Both halves of a void
        // stay in the running balance: the wallet really moved, then moved
        // back.
        reversalOfId: entry.transaction.reversalOfId,
        balanceBefore,
        runningBalance: running,
        // The accounts on the other side of this posting ("Mutual trust
        // bank" for a transfer out), and its category when it has one.
        counterAccounts: [...new Set(legs.map((leg) => leg.account.name))],
        category: (entry.transaction.entries ?? []).find((leg) => leg.categoryId)?.categoryId ?? null,
        // Received or sent, what kind of row it is and who or what it was
        // with, and the feature records it belongs to.
        direction: raises ? ('in' as const) : ('out' as const),
        kind,
        party,
        contactId: entry.transaction.contactId,
        assetId: asset?.id ?? null,
        // A transfer's charge: the transfer, and the account it went to.
        chargeForId: entry.transaction.chargeForId,
        chargeFor: entry.transaction.chargeForId ? (chargedToBy.get(entry.transaction.chargeForId) ?? null) : null,
      };
    });
    const closingBalance = running;

    // What the filters show; the balances stay every row's true running
    // balance, as the whole period builds it.
    const filtered = !!(filters.direction || filters.kind || filters.search);
    const rows = filtered
      ? allRows.filter(
          (row) =>
            (!filters.direction || row.direction === filters.direction) &&
            (!filters.kind || row.kind === filters.kind) &&
            (!filters.search || ledgerRowMatches({ ...row, amount: new Prisma.Decimal(row.amount).toFixed(2) }, filters.search)),
        )
      : allRows;

    const pageStart = (page - 1) * limit;
    const pageRows = rows.slice(pageStart, pageStart + limit);
    // A page past the end has no rows and sits after the period's last
    // entry, so both equal closingBalance.
    const pageOpeningBalance = pageRows.length > 0 ? pageRows[0].balanceBefore : closingBalance;
    const pageClosingBalance = pageRows.length > 0 ? pageRows[pageRows.length - 1].runningBalance : closingBalance;
    const total = rows.length;

    return {
      accountId,
      accountName: account.name,
      // For a statement's heading.
      accountNumber: account.accountNumber,
      accountSubtype: account.accountSubtype,
      openingBalance: account.openingBalance,
      balanceBroughtForward: balanceBroughtForward.toFixed(2),
      entries: pageRows.map(({ balanceBefore: _before, ...row }) => row),
      // The whole period's closing figure, whichever page this is -- not
      // necessarily the account's current balance if dateTo cuts off before
      // the most recent activity.
      closingBalance: closingBalance.toFixed(2),
      pageOpeningBalance: pageOpeningBalance.toFixed(2),
      pageClosingBalance: pageClosingBalance.toFixed(2),
      // Every row of the period, received and sent, and the kinds there
      // are: the filters' counts and choices.
      counts: { all: allRows.length, in: allRows.filter((row) => row.direction === 'in').length, out: allRows.filter((row) => row.direction === 'out').length },
      kinds: LEDGER_KINDS.filter((kind) => allRows.some((row) => row.kind === kind)),
      filtered,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // Net movement of the entries `where` matches, signed the way this
  // account's type grows (see isDebitPositive()). Two SUM aggregates, so the
  // cost doesn't grow with the number of entries.
  private async netMovement(where: Prisma.TransactionEntryWhereInput, debitPositive: boolean) {
    const [debitAgg, creditAgg] = await Promise.all([
      this.prisma.transactionEntry.aggregate({ where: { ...where, entryType: 'DEBIT' }, _sum: { amount: true } }),
      this.prisma.transactionEntry.aggregate({ where: { ...where, entryType: 'CREDIT' }, _sum: { amount: true } }),
    ]);
    const debitTotal = new Prisma.Decimal(debitAgg._sum.amount ?? 0);
    const creditTotal = new Prisma.Decimal(creditAgg._sum.amount ?? 0);
    return debitPositive ? debitTotal.minus(creditTotal) : creditTotal.minus(debitTotal);
  }

  // Quick stats for the account detail page header (and the Ledger page's
  // summary cards, which pass the same dateFrom/dateTo). "Money In"/"Money
  // Out" are from the friendly, balance-direction perspective (matches
  // Prompt 6's language) -- NOT raw debit/credit: for a debit-positive
  // account (ASSET/EXPENSE) a DEBIT is "in" and a CREDIT is "out"; reversed
  // for credit-positive accounts.
  //
  // TRANSFER-type entries are split out into their own signed "adjustment"
  // figure (+ money arrived via transfer, - money left), same reasoning as
  // getWalletsOverview()'s Adjustment column: a transfer moves money
  // between this business's own accounts, so it isn't real income/spending
  // and would overstate both totalIn and totalOut if left mixed in. A non-
  // money account (Income/Expense/Equity) never has TRANSFER entries in
  // practice, so adjustment is just 0 there -- harmless.
  async getAccountSummary(businessId: string, accountId: string, filters: { dateFrom?: string; dateTo?: string } = {}) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.businessId !== businessId) {
      throw new NotFoundException('Account not found');
    }

    const dateFilter: Prisma.DateTimeFilter = {};
    if (filters.dateFrom) dateFilter.gte = new Date(filters.dateFrom);
    if (filters.dateTo) dateFilter.lte = new Date(filters.dateTo);
    const hasDateFilter = Object.keys(dateFilter).length > 0;
    const transactionDateFilter: Prisma.TransactionWhereInput = hasDateFilter ? { transactionDate: dateFilter } : {};
    const baseWhere: Prisma.TransactionEntryWhereInput = { accountId, ...(hasDateFilter && { transaction: transactionDateFilter }) };
    // In/Out/Adjustment leave out voided transactions and their reversals:
    // the pair nets to zero, but counted gross it reads as money that both
    // came in and went out.
    const nonTransferWhere: Prisma.TransactionEntryWhereInput = {
      accountId,
      transaction: { ...transactionDateFilter, ...LIVE_TRANSACTION, transactionType: { not: 'TRANSFER' } },
    };
    const transferWhere: Prisma.TransactionEntryWhereInput = {
      accountId,
      transaction: { ...transactionDateFilter, ...LIVE_TRANSACTION, transactionType: 'TRANSFER' },
    };

    const [debitAgg, creditAgg, transferDebitAgg, transferCreditAgg, transactionCount] = await Promise.all([
      this.prisma.transactionEntry.aggregate({ where: { ...nonTransferWhere, entryType: 'DEBIT' }, _sum: { amount: true } }),
      this.prisma.transactionEntry.aggregate({ where: { ...nonTransferWhere, entryType: 'CREDIT' }, _sum: { amount: true } }),
      this.prisma.transactionEntry.aggregate({ where: { ...transferWhere, entryType: 'DEBIT' }, _sum: { amount: true } }),
      this.prisma.transactionEntry.aggregate({ where: { ...transferWhere, entryType: 'CREDIT' }, _sum: { amount: true } }),
      this.prisma.transactionEntry.count({ where: baseWhere }),
    ]);

    const debitTotal = new Prisma.Decimal(debitAgg._sum.amount ?? 0);
    const creditTotal = new Prisma.Decimal(creditAgg._sum.amount ?? 0);
    const transferDebitTotal = new Prisma.Decimal(transferDebitAgg._sum.amount ?? 0);
    const transferCreditTotal = new Prisma.Decimal(transferCreditAgg._sum.amount ?? 0);
    const debitPositive = isDebitPositive(account.accountType);

    return {
      currentBalance: account.currentBalance,
      totalIn: (debitPositive ? debitTotal : creditTotal).toFixed(2),
      totalOut: (debitPositive ? creditTotal : debitTotal).toFixed(2),
      adjustment: (debitPositive ? transferDebitTotal.minus(transferCreditTotal) : transferCreditTotal.minus(transferDebitTotal)).toFixed(2),
      transactionCount,
    };
  }

  // Balance Overview page (the Wallet group's summary dashboard): every
  // money account with its opening/in/out/savings/adjustment/current
  // figures, plus workspace-wide totals. Money accounts are always ASSET
  // type, so debit=in, credit=out uniformly -- no per-account
  // isDebitPositive check needed the way getAccountSummary() needs one for
  // a general account.
  //
  // "Total In"/"Total Out" are real income/expense-shaped money movement
  // (income, loan receive/give, etc.) -- TRANSFER entries are split out of
  // both, since a transfer just moves money between this business's own
  // accounts, not real income or spending. TRANSFER itself further splits
  // into two columns: "Savings" (this account funding a Savings Goal
  // contribution -- see SavingsGoalsService.addContribution()) vs
  // "Adjustment" (an actual Balance Transfer between two money accounts).
  // A transfer is classified as "Savings" when its other side is a Savings
  // Wallet (accountSubtype "savings") -- savings wallets are deliberately
  // excluded from MONEY_ACCOUNT_SUBTYPES, so they never appear as a
  // pickable "to/from" account in the regular Balance Transfer form, and a
  // goal contribution is the only transfer that reaches one. Savings is
  // shown as money sent out (positive), Adjustment as a signed +/-. Voided
  // transactions and their reversals are left out of every column; the
  // pair nets to zero in the current balance.
  //
  // With `asOf` (a YYYY-MM-DD Dhaka day), each wallet also carries
  // balanceAsOf: its opening balance plus every standing entry dated on or
  // before that day, for all wallets in one groupBy -- Home's trend chip read
  // one ledger per wallet for it. A posting voided after asOf counts on
  // neither side, so it can differ from that ledger's figure, which keeps
  // both halves of a void.
  async getWalletsOverview(businessId: string, filters: { asOf?: string } = {}) {
    const accounts = await this.prisma.account.findMany({
      where: { businessId, accountType: 'ASSET', accountSubtype: { in: MONEY_ACCOUNT_SUBTYPES } },
      orderBy: { displayOrder: 'asc' },
    });
    const accountIds = accounts.map((a) => a.id);

    const [nonTransferGrouped, transferEntries, asOfGrouped, activity] =
      accountIds.length === 0
        ? [[], [], [], []]
        : await Promise.all([
            this.prisma.transactionEntry.groupBy({
              by: ['accountId', 'entryType'],
              where: { accountId: { in: accountIds }, transaction: { ...LIVE_TRANSACTION, transactionType: { not: 'TRANSFER' } } },
              _sum: { amount: true },
            }),
            this.prisma.transactionEntry.findMany({
              where: { accountId: { in: accountIds }, transaction: { ...LIVE_TRANSACTION, transactionType: 'TRANSFER' } },
              include: { transaction: { include: { entries: { include: { account: { select: { accountSubtype: true } } } } } } },
            }),
            filters.asOf
              ? this.prisma.transactionEntry.groupBy({
                  by: ['accountId', 'entryType'],
                  where: { accountId: { in: accountIds }, transaction: { businessId, ...LIVE_TRANSACTION, transactionDate: { lte: dayDate(filters.asOf) } } },
                  _sum: { amount: true },
                })
              : [],
            // How many entries each account has (any status: only an account
            // with none can be deleted, as removeOrArchive() decides) and the
            // day it last moved money (standing transactions only).
            this.prisma.$queryRaw<{ accountId: string; entries: number; lastActivity: Date | null }[]>`
              SELECT e."accountId" AS "accountId", COUNT(*)::int AS "entries",
                     MAX(t."transactionDate") FILTER (WHERE t."status" = 'POSTED' AND t."reversalOfId" IS NULL) AS "lastActivity"
              FROM "TransactionEntry" e JOIN "Transaction" t ON t."id" = e."transactionId"
              WHERE e."accountId" IN (${Prisma.join(accountIds)})
              GROUP BY e."accountId"`,
          ]);
    const asOfTotals = filters.asOf ? entryTotals(asOfGrouped) : null;
    const activityByAccount = new Map(activity.map((row) => [row.accountId, row]));

    const inByAccount = new Map<string, Prisma.Decimal>();
    const outByAccount = new Map<string, Prisma.Decimal>();
    for (const row of nonTransferGrouped) {
      const amount = new Prisma.Decimal(row._sum.amount ?? 0);
      const target = row.entryType === 'DEBIT' ? inByAccount : outByAccount;
      target.set(row.accountId, amount);
    }

    const adjustmentByAccount = new Map<string, Prisma.Decimal>();
    const savingsByAccount = new Map<string, Prisma.Decimal>();
    for (const entry of transferEntries) {
      const amount = new Prisma.Decimal(entry.amount);
      const isSavingsContribution = entry.transaction.entries.some((e) => e.accountId !== entry.accountId && e.account.accountSubtype === 'savings');
      if (isSavingsContribution) {
        const sentOut = entry.entryType === 'CREDIT' ? amount : amount.negated();
        savingsByAccount.set(entry.accountId, (savingsByAccount.get(entry.accountId) ?? new Prisma.Decimal(0)).plus(sentOut));
      } else {
        const signed = entry.entryType === 'DEBIT' ? amount : amount.negated();
        adjustmentByAccount.set(entry.accountId, (adjustmentByAccount.get(entry.accountId) ?? new Prisma.Decimal(0)).plus(signed));
      }
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
        accountSubtype: account.accountSubtype,
        color: account.color,
        status: account.status,
        // A YYYY-MM-DD day, or null before the first standing entry.
        lastActivity: activityByAccount.get(account.id)?.lastActivity?.toISOString().slice(0, 10) ?? null,
        entryCount: activityByAccount.get(account.id)?.entries ?? 0,
        openingBalance: account.openingBalance.toFixed(2),
        totalIn: (inByAccount.get(account.id) ?? new Prisma.Decimal(0)).toFixed(2),
        totalOut: (outByAccount.get(account.id) ?? new Prisma.Decimal(0)).toFixed(2),
        savings: (savingsByAccount.get(account.id) ?? new Prisma.Decimal(0)).toFixed(2),
        adjustment: (adjustmentByAccount.get(account.id) ?? new Prisma.Decimal(0)).toFixed(2),
        currentBalance: balance.toFixed(2),
        ...(asOfTotals && { balanceAsOf: new Prisma.Decimal(account.openingBalance).plus(signedNet(account.accountType, asOfTotals.get(account.id))).toFixed(2) }),
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
      // Read and rewritten under the row lock every posting takes, so a
      // posting that commits mid-way can't be overwritten by a stale sum.
      const { cached, recalculated } = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${account.id} FOR UPDATE`;
        const current = await tx.account.findUniqueOrThrow({ where: { id: account.id }, select: { currentBalance: true } });
        return { cached: new Prisma.Decimal(current.currentBalance), recalculated: await this.recalculateBalance(account.id, tx) };
      });
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
