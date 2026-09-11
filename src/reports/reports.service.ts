import { Injectable } from '@nestjs/common';
import { AccountType, Prisma } from '@prisma/client';
import { isDebitPositive } from '../accounts/account-balance.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GeneralLedgerQueryDto } from './dto/general-ledger-query.dto.js';

const ACCOUNT_TYPE_ORDER: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];

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
}
