import type { Prisma } from '@prisma/client';
import { LIVE_TRANSACTION } from '../accounts/account-figures.js';
import type { ActiveMonthsQueryDto } from './dto/active-months-query.dto.js';

// The transactions an active-months answer counts, as each page lists
// them: an account's ledger takes everything on that account; Transfers
// leaves out what a savings goal moved; the default is income and expense.
// Voided ones and their reversals never count.
export function activeMonthsWhere(businessId: string, query: ActiveMonthsQueryDto = {}): Prisma.TransactionWhereInput {
  const where: Prisma.TransactionWhereInput = { businessId, ...LIVE_TRANSACTION };
  if (query.accountId) {
    where.entries = { some: { accountId: query.accountId } };
  } else if (query.scope === 'transfers') {
    where.transactionType = 'TRANSFER';
    where.NOT = { entries: { some: { account: { accountSubtype: 'savings' } } } };
  } else {
    where.transactionType = { in: ['INCOME', 'EXPENSE'] };
  }
  return where;
}
