import { Injectable, Logger } from '@nestjs/common';
import { Prisma, WorkspaceType } from '@prisma/client';
import { randomBytes } from 'crypto';
import { AccountsService } from '../accounts/accounts.service.js';
import { MailService } from '../mail/mail.service.js';
import { renderWelcomeEmail } from '../mail/templates/welcome-email.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

export interface ProvisionOptions {
  // Someone else's shareable code from a signup link. Only counts the first
  // time an account is provisioned, i.e. at signup.
  referralCode?: string;
}

// Everything an end user needs before the app issues them a token: a default
// Personal workspace with its starter chart of accounts, and their own
// referral code. Idempotent, and called on registration, on every login and
// when a Google sign-in is exchanged for tokens -- so an account created
// anywhere (better-auth, the Infra dashboard) is completed on first use.
@Injectable()
export class UserProvisioningService {
  private readonly logger = new Logger(UserProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountsService: AccountsService,
    private readonly settingsService: SettingsService,
    private readonly mailService: MailService,
  ) {}

  // Returns the user's default workspace id, creating it on first use.
  async ensureDefaultWorkspace(userId: string, options: ProvisionOptions = {}): Promise<string> {
    const existing = await this.findDefaultBusinessId(userId);
    if (existing) return existing;

    const freePlan = await this.prisma.subscriptionPlan.findUnique({ where: { slug: 'free' } });
    // Read outside the transaction below -- SettingsService.get() uses the
    // plain (non-transactional) client, and calling it from inside an open
    // interactive transaction against `prisma dev`'s single-connection pool
    // starves that transaction until it times out (P2028). The reward amount
    // is a snapshot; it needs no transactional consistency with the rest.
    const referralRewardAmount = options.referralCode ? (await this.settingsService.get()).referralRewardAmount : undefined;

    const createdId = await this.prisma.$transaction(async (tx) => {
      // Two first requests racing (two tabs, a double submit) would each
      // see no workspace above; this lock lets exactly one create it.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      if (await tx.business.findFirst({ where: { ownerId: userId, isDefault: true }, select: { id: true } })) return null;

      await this.assignReferralCode(tx, userId);
      if (options.referralCode && referralRewardAmount !== undefined) {
        await this.recordReferral(tx, userId, options.referralCode, referralRewardAmount);
      }

      const business = await tx.business.create({
        data: {
          ownerId: userId,
          name: 'Personal',
          type: WorkspaceType.PERSONAL,
          isDefault: true,
          planId: freePlan?.id,
          members: { create: { userId, role: 'OWNER' } },
        },
      });
      // The default workspace never exists without its starter Chart of
      // Accounts -- seeded in this same transaction, all-or-nothing.
      await this.accountsService.seedDefaultAccounts(business.id, WorkspaceType.PERSONAL, tx);
      return business.id;
    });

    if (!createdId) return (await this.findDefaultBusinessId(userId)) as string;
    await this.sendWelcomeEmail(userId);
    return createdId;
  }

  private async findDefaultBusinessId(userId: string): Promise<string | null> {
    const business = await this.prisma.business.findFirst({ where: { ownerId: userId, isDefault: true }, select: { id: true } });
    return business?.id ?? null;
  }

  // The user's own shareable code -- same short-code algorithm as
  // ReferralsService.generateUniqueReferralCode(), duplicated rather than
  // imported to avoid a UserAuthModule <-> ReferralsModule cycle (see that
  // method's comment).
  private async assignReferralCode(tx: Prisma.TransactionClient, userId: string) {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true } });
    if (user.referralCode) return;

    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = randomBytes(5).toString('hex').toUpperCase().slice(0, 8);
      if (!(await tx.user.findUnique({ where: { referralCode: candidate } }))) {
        await tx.user.update({ where: { id: userId }, data: { referralCode: candidate } });
        return;
      }
    }
  }

  // An unknown or stale code is silently ignored -- a bad referral link must
  // never block a signup.
  private async recordReferral(tx: Prisma.TransactionClient, userId: string, referralCode: string, rewardAmount: number) {
    const referrer = await tx.user.findUnique({ where: { referralCode } });
    if (!referrer || referrer.id === userId) return;
    await tx.referral.create({ data: { referrerId: referrer.id, referredUserId: userId, rewardAmount, status: 'PENDING' } });
  }

  // Best-effort: a flaky or unconfigured email provider must never fail a
  // signup -- log and move on.
  private async sendWelcomeEmail(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    if (!user) return;
    this.mailService.sendEmail({ to: user.email, ...renderWelcomeEmail(user.name) }).catch((err: unknown) => {
      this.logger.error(`Failed to send welcome email to ${user.email}: ${err instanceof Error ? err.message : String(err)}`);
    });
  }
}
