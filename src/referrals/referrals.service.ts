import { BadRequestException, Injectable } from '@nestjs/common';
import { Account, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { MONEY_ACCOUNT_SUBTYPES } from '../accounts/accounts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { TransactionsService } from '../transactions/transactions.service.js';

const REFERRAL_BONUS_INCOME_SUBTYPE = 'referral-bonus';

@Injectable()
export class ReferralsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly transactionsService: TransactionsService,
  ) {}

  // Called from UserAuthService.register() too (to backfill a brand-new
  // user's code inside its own registration transaction) -- kept here as
  // the single source of truth for the generation algorithm. Short,
  // URL-friendly, uppercase alphanumeric; retries on the astronomically
  // rare collision.
  async generateUniqueReferralCode(client: Prisma.TransactionClient | PrismaService = this.prisma): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomBytes(5).toString('hex').toUpperCase().slice(0, 8);
      const existing = await client.user.findUnique({ where: { referralCode: code } });
      if (!existing) return code;
    }
    throw new Error('Could not generate a unique referral code');
  }

  async getReferralInfo(userId: string) {
    let user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.referralCode) {
      const referralCode = await this.generateUniqueReferralCode();
      user = await this.prisma.user.update({ where: { id: userId }, data: { referralCode } });
    }

    // Self-healing: any PENDING referral whose referredUser has been
    // registered 30+ days confirms automatically on every read, same
    // pattern as SavingsGoalsService.maybeMarkCompleted().
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const pending = await this.prisma.referral.findMany({
      where: { referrerId: userId, status: 'PENDING' },
      include: { referredUser: true },
    });
    for (const referral of pending) {
      if (referral.referredUser.createdAt <= thirtyDaysAgo) {
        await this.prisma.referral.update({ where: { id: referral.id }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
      }
    }

    const referrals = await this.prisma.referral.findMany({
      where: { referrerId: userId },
      include: { referredUser: true },
      orderBy: { createdAt: 'desc' },
    });

    let totalEarned = new Prisma.Decimal(0);
    let pendingEarnings = new Prisma.Decimal(0);
    let availableBalance = new Prisma.Decimal(0);
    for (const r of referrals) {
      const amount = new Prisma.Decimal(r.rewardAmount);
      if (r.status === 'PENDING') pendingEarnings = pendingEarnings.plus(amount);
      else {
        totalEarned = totalEarned.plus(amount);
        if (r.status === 'CONFIRMED') availableBalance = availableBalance.plus(amount);
      }
    }
    // totalEarned reads as "everything ever credited, withdrawn or not" --
    // CONFIRMED + WITHDRAWN both count (added inside the loop above),
    // PENDING doesn't (not credited yet).

    const settings = await this.settingsService.get();

    return {
      referralCode: user.referralCode,
      totalEarned: totalEarned.toFixed(2),
      pendingEarnings: pendingEarnings.toFixed(2),
      availableBalance: availableBalance.toFixed(2),
      referralCount: referrals.length,
      rewardAmountPerReferral: new Prisma.Decimal(settings.referralRewardAmount).toFixed(2),
      recentReferrals: referrals.slice(0, 10).map((r) => ({
        id: r.id,
        name: r.referredUser.name,
        status: r.status,
        rewardAmount: new Prisma.Decimal(r.rewardAmount).toFixed(2),
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async withdraw(userId: string, businessId: string, accountId: string, actorUserId: string) {
    const confirmed = await this.prisma.referral.findMany({ where: { referrerId: userId, status: 'CONFIRMED' } });
    const total = confirmed.reduce((sum, r) => sum.plus(new Prisma.Decimal(r.rewardAmount)), new Prisma.Decimal(0));
    if (total.lessThanOrEqualTo(0)) {
      throw new BadRequestException('No available balance to withdraw.');
    }

    const depositAccount = await this.requirePaymentAccount(businessId, accountId);
    const incomeAccount = await this.requireOrCreateReferralBonusAccount(businessId);

    await this.transactionsService.createTransaction(
      businessId,
      {
        transactionType: 'INCOME',
        transactionDate: new Date().toISOString().slice(0, 10),
        description: 'Referral Program withdrawal',
        entries: [
          { accountId: depositAccount.id, entryType: 'DEBIT', amount: total.toNumber(), categoryId: 'Referral Bonus' },
          { accountId: incomeAccount.id, entryType: 'CREDIT', amount: total.toNumber() },
        ],
      },
      actorUserId,
    );

    await this.prisma.referral.updateMany({
      where: { id: { in: confirmed.map((r) => r.id) } },
      data: { status: 'WITHDRAWN', withdrawnAt: new Date() },
    });

    return { withdrawnAmount: total.toFixed(2) };
  }

  // Same "accepts EITHER a regular money account OR a Savings Wallet"
  // convention as AssetsService.requirePaymentAccount() -- copied rather
  // than shared, matching this codebase's existing per-module private
  // helper style (see that method's own comment).
  private async requirePaymentAccount(businessId: string, accountId: string): Promise<Account> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.businessId !== businessId) {
      throw new BadRequestException('Account not found in this workspace');
    }
    const isMoneyAccount = account.accountType === 'ASSET' && !!account.accountSubtype && MONEY_ACCOUNT_SUBTYPES.includes(account.accountSubtype);
    const isSavingsWallet = account.accountType === 'ASSET' && account.accountSubtype === 'savings' && !account.isSystemAccount;
    if (!isMoneyAccount && !isSavingsWallet) {
      throw new BadRequestException('Must be a General (cash/bank/mobile money) or Savings account');
    }
    return account;
  }

  // A REAL, visible Income-type account (like the seeded "Salary Income"/
  // "Freelance Income") -- NOT a hidden pool like AssetsService's Fixed
  // Assets account, since a referral bonus is genuinely new money entering
  // the system (same shape as any other Income transaction), not an
  // asset-to-asset conversion. isSystemAccount: true only to protect it
  // from accidental archiving -- every originally-seeded default account
  // already carries that same flag (see AccountsService's seeding), it
  // does not hide an account from listings/reports.
  private async requireOrCreateReferralBonusAccount(businessId: string): Promise<Account> {
    const existing = await this.prisma.account.findFirst({
      where: { businessId, accountType: 'INCOME', accountSubtype: REFERRAL_BONUS_INCOME_SUBTYPE },
    });
    if (existing) return existing;
    return this.prisma.account.create({
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
}
