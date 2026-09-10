import { Injectable, NotFoundException } from '@nestjs/common';
import { AccountType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

// Accounting rule (product blueprint): for ASSET/EXPENSE accounts, DEBIT
// increases the balance and CREDIT decreases it; for LIABILITY/EQUITY/
// INCOME accounts, it's the reverse.
function isDebitPositive(accountType: AccountType): boolean {
  return accountType === 'ASSET' || accountType === 'EXPENSE';
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
  // one -- proves the two numbers agree, and gives future reports (Prompt
  // 12+) a ready-made data source.
  async getLedger(businessId: string, accountId: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.businessId !== businessId) {
      throw new NotFoundException('Account not found');
    }

    // Same "never filter by status" reasoning as recalculateBalance() --
    // includes VOIDED transactions' original entries AND their reversals,
    // so the running balance ends up matching currentBalance exactly.
    const entries = await this.prisma.transactionEntry.findMany({
      where: { accountId },
      include: { transaction: true },
      orderBy: [{ transaction: { transactionDate: 'asc' } }, { transaction: { createdAt: 'asc' } }],
    });

    const debitPositive = isDebitPositive(account.accountType);
    let running = new Prisma.Decimal(account.openingBalance);

    const rows = entries.map((entry) => {
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

    return {
      accountId,
      accountName: account.name,
      openingBalance: account.openingBalance,
      entries: rows,
      closingBalance: running,
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
