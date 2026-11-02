import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, type User } from '@prisma/client';
import { MONEY_ACCOUNT_SUBTYPES } from '../accounts/accounts.service.js';
import { AuthSessionsService } from '../auth/auth-sessions.service.js';
import { dateLabel, localeOf } from '../billing/billing-text.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { referralBalances, releaseLines } from '../referrals/referral-ledger.js';
import { TwoStepService } from '../two-step/two-step.service.js';
import { purgeUser } from './account-purge.js';
import { DELETION_GRACE_DAYS, deletionDate, isPurgeDue, isRestorable, type DeletionPreviewCounts } from './deletion-rules.js';
import type { DeleteAccountDto } from './dto/delete-account.dto.js';

// Purging one account can touch thousands of rows; the default 5 s
// interactive-transaction timeout is far too short for that.
const PURGE_TX = { maxWait: 10_000, timeout: 120_000 };
// How many accounts one housekeeping run purges, so a backlog can't hold
// the timer's lock for long.
const PURGE_BATCH = 20;

export interface RestoreResult {
  restored: boolean;
}

// Settings > Resources > Delete my account. Asking locks the account at
// once and schedules its purge 30 days on; signing in (password, Google,
// the second step of two-step, a password reset) before then restores it.
// The purge runs on the housekeeping timer and lazily whenever a sign-in
// finds an account whose day has passed.
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AuthSessionsService,
    private readonly twoStep: TwoStepService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  // What the dialog lists as going away, from the person's own data.
  async preview(userId: string): Promise<DeletionPreviewCounts & { deletionDate: Date; graceDays: number }> {
    const owned = await this.prisma.business.findMany({ where: { ownerId: userId, deletedAt: null }, select: { id: true, type: true } });
    const ids = owned.map((business) => business.id);
    const [wallets, transactions, savingsGoals, assets, loanContacts, vaultEntries, ledger] = await Promise.all([
      this.prisma.account.count({
        where: { businessId: { in: ids }, status: 'ACTIVE', accountType: 'ASSET', accountSubtype: { in: [...MONEY_ACCOUNT_SUBTYPES, 'savings'] } },
      }),
      this.prisma.transaction.count({ where: { businessId: { in: ids } } }),
      this.prisma.savingsGoal.count({ where: { businessId: { in: ids } } }),
      this.prisma.asset.count({ where: { businessId: { in: ids } } }),
      this.prisma.contact.count({ where: { businessId: { in: ids }, category: 'LOAN' } }),
      this.prisma.vaultEntry.count({ where: { userId } }),
      referralBalances(this.prisma, userId),
    ]);
    const available = ledger.availablePaisa;
    return {
      wallets,
      transactions,
      savingsGoals,
      assets,
      loanContacts,
      groups: owned.filter((business) => business.type === 'GROUP').length,
      vaultEntries,
      referralAvailable: available > 0 ? (available / 100).toFixed(2) : null,
      deletionDate: deletionDate(new Date()),
      graceDays: DELETION_GRACE_DAYS,
    };
  }

  // The owner asks: password (or a fresh Google sign-in) and, with two-step
  // on, a code. Everything that could still move money for them stops now.
  async request(userId: string, sessionId: string, impersonatedBy: string | undefined, dto: DeleteAccountDto): Promise<{ scheduledFor: Date }> {
    if (impersonatedBy) {
      throw new ForbiddenException('This is a read-only support view of the account. Nothing can be changed from it.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== Role.USER) throw new NotFoundException('Account not found');
    if (user.status !== 'ACTIVE') throw new ConflictException('This account is not active');

    await this.twoStep.confirmSensitiveAction(userId, { password: dto.password, sessionId }, { code: dto.code, backupCode: dto.backupCode });

    const now = new Date();
    const scheduledFor = deletionDate(now);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id: userId, status: 'ACTIVE' },
        data: { status: 'PENDING_DELETION', deletionRequestedAt: now, deletionScheduledFor: scheduledFor },
      });
      if (count !== 1) throw new ConflictException('This account is not active');
      // An open checkout could still be marked paid; a withdrawal still
      // waiting for review hands its money back to the balance.
      await tx.payment.updateMany({ where: { userId, status: 'PENDING' }, data: { status: 'FAILED', failureReason: 'account_deleted' } });
      // Only the requests this cancels give their lines back (one an admin
      // approves meanwhile keeps them).
      const cancelled = await tx.payoutRequest.updateManyAndReturn({
        where: { userId, status: 'REQUESTED' },
        data: { status: 'CANCELLED', cancelledAt: now },
        select: { id: true },
      });
      await releaseLines(tx, cancelled.map((p) => p.id));
      await tx.userSubscription.updateMany({ where: { userId }, data: { cancelAtPeriodEnd: true } });
      await tx.pushSubscription.deleteMany({ where: { userId } });
    });

    // Signed out everywhere at once; the device history stays until purge.
    await this.sessions.revokeAllForUser(userId);
    await this.prisma.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });

    await this.sendNotice(user, scheduledFor);
    return { scheduledFor };
  }

  // Called by every completed customer sign-in before the tokens are
  // issued. A pending account inside its 30 days comes back; one whose day
  // has passed is purged and the sign-in refused as if it never existed.
  async restoreOnSignIn(user: Pick<User, 'id' | 'status' | 'deletionScheduledFor'>, now = new Date()): Promise<RestoreResult> {
    if (user.status !== 'PENDING_DELETION') return { restored: false };
    if (!isRestorable(user, now)) {
      await this.purge(user.id, now);
      throw new UnauthorizedException('Invalid email or password');
    }
    const { count } = await this.prisma.user.updateMany({
      where: { id: user.id, status: 'PENDING_DELETION' },
      data: { status: 'ACTIVE', deletionRequestedAt: null, deletionScheduledFor: null },
    });
    return { restored: count === 1 };
  }

  // A support admin's "Cancel the deletion" (AdminOwnersService.restore).
  async restoreByAdmin(userId: string, now = new Date()): Promise<boolean> {
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId, role: Role.USER, status: 'PENDING_DELETION', deletionScheduledFor: { gt: now } },
      data: { status: 'ACTIVE', deletionRequestedAt: null, deletionScheduledFor: null },
    });
    return count === 1;
  }

  // Purges one account if (and only if) it is still pending and due. One
  // account per transaction, under a per-user advisory lock, so the timer
  // and a lazy sign-in can't purge the same person twice at once.
  async purge(userId: string, now = new Date()): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true, status: true, deletionScheduledFor: true } });
      if (!user || user.role !== Role.USER || !isPurgeDue(user, now)) return false;
      await purgeUser(tx, user.id, user.email);
      this.logger.log(`Purged account ${user.id} (deletion was due ${user.deletionScheduledFor?.toISOString()})`);
      return true;
    }, PURGE_TX);
  }

  // The housekeeping job: every account whose 30 days are up, a batch at a
  // time. A failure costs only that account; the next run tries again.
  async purgeDue(now = new Date()): Promise<number> {
    const due = await this.prisma.user.findMany({
      where: { role: Role.USER, status: 'PENDING_DELETION', deletionScheduledFor: { lte: now } },
      orderBy: { deletionScheduledFor: 'asc' },
      take: PURGE_BATCH,
      select: { id: true },
    });
    let purged = 0;
    for (const { id } of due) {
      try {
        if (await this.purge(id, now)) purged++;
      } catch (error) {
        this.logger.warn(`Could not purge account ${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return purged;
  }

  private async sendNotice(user: User, scheduledFor: Date): Promise<void> {
    try {
      const locale = localeOf(user.preferredLanguage);
      const link = `${this.config.get<string>('USER_FRONTEND_URL') ?? 'http://localhost:3000'}/login`;
      await this.mail.sendAccountDeletionEmail(user.email, locale, { name: user.name, deletionDate: dateLabel(scheduledFor, locale), link });
    } catch (error) {
      // Best-effort: Resend may not be set up, and the deletion has happened.
      this.logger.warn(`Could not send the deletion email for ${user.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

