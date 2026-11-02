import { Prisma, type Account, type CommissionStatus } from '@prisma/client';
import { MONEY_ACCOUNT_SUBTYPES, REFERRAL_BONUS_INCOME_SUBTYPE } from '../accounts/accounts.service.js';
import { toPaisa } from '../billing/pricing.js';
import type { PrismaService } from '../prisma/prisma.service.js';

type Client = PrismaService | Prisma.TransactionClient;

// A member's referral money by where it is, in paisa.
export interface Balances {
  // Ready to withdraw.
  availablePaisa: number;
  // Inside the refund window, and when the next of it is ready.
  onHoldPaisa: number;
  onHoldNextAt: Date | null;
  // In requests not paid yet.
  inWithdrawalPaisa: number;
  // Held back by an admin for a second look.
  underCheckPaisa: number;
  paidOutPaisa: number;
  // Taken back because the friend was refunded.
  reversedPaisa: number;
  // Everything earned and not taken back.
  lifetimePaisa: number;
}

export function balancesOf(sums: { status: CommissionStatus; paisa: number }[], onHoldNextAt: Date | null): Balances {
  const of = (status: CommissionStatus) => sums.filter((s) => s.status === status).reduce((total, s) => total + s.paisa, 0);
  const available = of('AVAILABLE');
  const onHold = of('ON_HOLD');
  const inWithdrawal = of('IN_WITHDRAWAL');
  const underCheck = of('UNDER_CHECK');
  const paidOut = of('PAID_OUT');
  return {
    availablePaisa: available,
    onHoldPaisa: onHold,
    onHoldNextAt,
    inWithdrawalPaisa: inWithdrawal,
    underCheckPaisa: underCheck,
    paidOutPaisa: paidOut,
    reversedPaisa: of('REVERSED'),
    lifetimePaisa: available + onHold + inWithdrawal + underCheck + paidOut,
  };
}

export async function referralBalances(client: Client, userId: string): Promise<Balances> {
  const [groups, next] = await Promise.all([
    client.referralCommission.groupBy({ by: ['status'], where: { referrerId: userId }, _sum: { amount: true } }),
    client.referralCommission.findFirst({ where: { referrerId: userId, status: 'ON_HOLD' }, orderBy: { availableAt: 'asc' }, select: { availableAt: true } }),
  ]);
  return balancesOf(
    groups.map((g) => ({ status: g.status, paisa: toPaisa(g._sum.amount ?? 0) })),
    next?.availableAt ?? null,
  );
}

// The lines of the given requests that are still in them go back to
// AVAILABLE: a request cancelled, rejected, or closed with the account.
// Lines an admin held back (UNDER_CHECK) stay held.
export function releaseLines(tx: Prisma.TransactionClient, payoutIds: string[]) {
  return tx.referralCommission.updateMany({
    where: { payoutId: { in: payoutIds }, status: 'IN_WITHDRAWAL' },
    data: { status: 'AVAILABLE', payoutId: null },
  });
}

// "Add it as income when it's paid": a workspace the member owns or keeps
// the books for (not a group), and a money account or savings wallet in it.
export async function findIncomeTarget(
  client: Client,
  userId: string,
  businessId: string,
  accountId: string,
): Promise<{ business: { id: string; name: string }; account: Account } | { problem: string }> {
  const member = await client.businessMember.findFirst({
    where: { businessId, userId, status: 'ACTIVE', role: { in: ['OWNER', 'ACCOUNTANT'] } },
    select: { business: { select: { id: true, name: true, type: true, deletedAt: true } } },
  });
  if (!member || member.business.deletedAt || member.business.type === 'GROUP') {
    return { problem: 'Pick a workspace you own or keep the books for' };
  }
  const account = await client.account.findUnique({ where: { id: accountId } });
  if (!account || account.businessId !== businessId || account.status !== 'ACTIVE') return { problem: 'That wallet was not found in this workspace' };
  const isMoneyAccount = account.accountType === 'ASSET' && !!account.accountSubtype && MONEY_ACCOUNT_SUBTYPES.includes(account.accountSubtype);
  const isSavingsWallet = account.accountType === 'ASSET' && account.accountSubtype === 'savings' && !account.isSystemAccount;
  if (!isMoneyAccount && !isSavingsWallet) return { problem: 'Pick a cash, bank, mobile banking or savings wallet' };
  return { business: { id: member.business.id, name: member.business.name }, account };
}

// The workspace's "Referral Bonus" income account, made on first use. A
// real, visible Income account (like "Salary Income"): referral money is
// new money coming in. isSystemAccount only protects it from archiving.
export async function requireOrCreateReferralBonusAccount(client: Client, businessId: string): Promise<Account> {
  const existing = await client.account.findFirst({
    where: { businessId, accountType: 'INCOME', accountSubtype: REFERRAL_BONUS_INCOME_SUBTYPE, isSystemAccount: true },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) return existing;
  return client.account.create({
    data: {
      businessId,
      name: 'Referral Bonus',
      accountType: 'INCOME',
      accountSubtype: REFERRAL_BONUS_INCOME_SUBTYPE,
      isSystemAccount: true,
      openingBalance: 0,
      currentBalance: 0,
    },
  });
}
