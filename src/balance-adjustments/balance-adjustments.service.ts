import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { BALANCE_ADJUSTMENT_ACCOUNT_SUBTYPE, MONEY_ACCOUNT_SUBTYPES } from '../accounts/accounts.service.js';
import { fromPaisa, toPaisa } from '../billing/pricing.js';
import { dhakaDateKey } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TransactionsService } from '../transactions/transactions.service.js';
import type { AdjustBalanceDto } from './dto/adjust-balance.dto.js';

// What an adjustment says when the member wrote no note.
export const DEFAULT_ADJUSTMENT_NOTE = 'Balance check';

// The entries that bring a wallet from what Smartly shows to its real
// balance: the difference on the wallet, against the adjustments account.
// Positive: the real balance is higher, so money comes in.
export function adjustmentEntries(
  walletId: string,
  equityId: string,
  differencePaisa: number,
): { accountId: string; entryType: 'DEBIT' | 'CREDIT'; amount: number }[] {
  const amount = Math.abs(differencePaisa) / 100;
  const walletSide = differencePaisa > 0 ? ('DEBIT' as const) : ('CREDIT' as const);
  const equitySide = differencePaisa > 0 ? ('CREDIT' as const) : ('DEBIT' as const);
  return [
    { accountId: walletId, entryType: walletSide, amount },
    { accountId: equityId, entryType: equitySide, amount },
  ];
}

// "Match real balance" (Balance > Accounts): one adjustment that brings a
// wallet to the balance its bank or wallet app shows. It is a journal entry
// against an equity account, so it changes no income or expense; it shows in
// the wallet's ledger, and voiding it takes it back.
@Injectable()
export class BalanceAdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
  ) {}

  async adjust(businessId: string, accountId: string, dto: AdjustBalanceDto, userId: string) {
    const today = dhakaDateKey(new Date());
    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.account.findFirst({
        where: { id: accountId, businessId, accountType: 'ASSET', accountSubtype: { in: MONEY_ACCOUNT_SUBTYPES } },
        select: { id: true, status: true },
      });
      if (!wallet) throw new NotFoundException('Account not found');
      if (wallet.status === 'ARCHIVED') throw new BadRequestException('Make this account active again to match its balance.');
      // The balance is read under the lock every posting takes, so the
      // difference is against the balance as it stands, not as the page saw it.
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${wallet.id} FOR UPDATE`;
      const { currentBalance } = await tx.account.findUniqueOrThrow({ where: { id: wallet.id }, select: { currentBalance: true } });
      const differencePaisa = toPaisa(dto.realBalance) - toPaisa(currentBalance);
      if (differencePaisa === 0) return { adjusted: false, difference: fromPaisa(0), transactionId: null };

      const equityId = await this.adjustmentAccountId(tx, businessId);
      const posted = await this.transactions.createTransaction(
        businessId,
        {
          transactionType: 'JOURNAL',
          transactionDate: today,
          description: dto.note || DEFAULT_ADJUSTMENT_NOTE,
          entries: adjustmentEntries(wallet.id, equityId, differencePaisa),
        },
        userId,
        tx,
      );
      return { adjusted: true, difference: fromPaisa(differencePaisa), transactionId: posted.id };
    });
  }

  // The workspace's adjustments account, made the first time. A transaction
  // lock keyed to the workspace keeps two first adjustments from making two.
  private async adjustmentAccountId(tx: Prisma.TransactionClient, businessId: string): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`balance-adjustment:${businessId}`}))`;
    const existing = await tx.account.findFirst({
      where: { businessId, accountSubtype: BALANCE_ADJUSTMENT_ACCOUNT_SUBTYPE, isSystemAccount: true },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await tx.account.create({
      data: {
        businessId,
        name: 'Balance adjustments',
        nameBn: 'ব্যালেন্স সমন্বয়',
        accountType: 'EQUITY',
        accountSubtype: BALANCE_ADJUSTMENT_ACCOUNT_SUBTYPE,
        isSystemAccount: true,
        openingBalance: 0,
        currentBalance: 0,
      },
      select: { id: true },
    });
    return created.id;
  }
}
