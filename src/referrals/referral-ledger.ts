import { Prisma, type Account, type ReferralKind, type ReferralStatus } from '@prisma/client';
import { MONEY_ACCOUNT_SUBTYPES, REFERRAL_BONUS_INCOME_SUBTYPE } from '../accounts/accounts.service.js';
import { toPaisa } from '../billing/pricing.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { OPEN_PAYOUT_STATUSES, referralBalances, type Balances, type CommissionEntry, type PayoutEntry } from './referral-money.js';

type Client = PrismaService | Prisma.TransactionClient;

export interface LedgerRow {
  id: string;
  kind: ReferralKind;
  status: ReferralStatus;
  rewardAmount: Prisma.Decimal;
  commissionAmount: Prisma.Decimal | null;
  paidOutAmount: Prisma.Decimal;
  availableAt: Date | null;
  createdAt: Date;
}

export const LEDGER_SELECT = {
  id: true,
  kind: true,
  status: true,
  rewardAmount: true,
  commissionAmount: true,
  paidOutAmount: true,
  availableAt: true,
  createdAt: true,
} as const satisfies Prisma.ReferralSelect;

// A referral as money: the commission (or an old row's flat reward) and
// how much of it is paid out.
export const toEntry = (row: LedgerRow): CommissionEntry => ({
  id: row.id,
  status: row.status,
  commissionPaisa: toPaisa(row.commissionAmount ?? (row.kind === 'SIGNUP_BONUS' ? row.rewardAmount : 0)),
  paidOutPaisa: toPaisa(row.paidOutAmount),
  availableAt: row.availableAt,
  createdAt: row.createdAt,
});

// One member's commissions, open requests and balance. Inside a lock
// (withLocks(['referrals:<userId>'])) when the result decides a payment.
export async function memberLedger(
  client: Client,
  userId: string,
): Promise<{ rows: LedgerRow[]; entries: CommissionEntry[]; openPayouts: PayoutEntry[]; balances: Balances }> {
  const [rows, payouts] = await Promise.all([
    client.referral.findMany({ where: { referrerId: userId }, select: LEDGER_SELECT }),
    client.payoutRequest.findMany({
      where: { userId, status: { in: [...OPEN_PAYOUT_STATUSES] } },
      select: { id: true, number: true, status: true, amount: true, createdAt: true },
    }),
  ]);
  const entries = rows.map(toEntry);
  const openPayouts = payouts.map((p) => ({ id: p.id, number: p.number, status: p.status, amountPaisa: toPaisa(p.amount), createdAt: p.createdAt }));
  return { rows, entries, openPayouts, balances: referralBalances(entries, openPayouts) };
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
