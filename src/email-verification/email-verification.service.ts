import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { localeOf } from '../billing/billing-text.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { maskEmail } from '../referrals/referral-money.js';
import { hashVerifyToken, newVerifyToken, VERIFY_TTL_MS, verifyLinkUsable } from './email-verification-rules.js';

const linkInvalid = () =>
  new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: 'This verification link is invalid or has expired. Send a new one from Settings > Profile.',
    reason: 'LINK_INVALID',
  });

const emailNotConfigured = () =>
  new ServiceUnavailableException({
    statusCode: 503,
    error: 'Service Unavailable',
    message: 'Email is not set up yet, so a verification email cannot be sent. Please try again later.',
    reason: 'EMAIL_NOT_CONFIGURED',
  });

const emailNotSent = () =>
  new ServiceUnavailableException({
    statusCode: 503,
    error: 'Service Unavailable',
    message: 'We could not send the verification email. Please try again in a minute.',
    reason: 'EMAIL_NOT_SENT',
  });

interface Recipient {
  id: string;
  name: string;
  email: string;
  preferredLanguage: string;
}

// Settings > Profile > "Send a verification email": a one-time link to the
// account's current address that sets emailVerified/emailVerifiedAt. The
// link works signed out, so it can be opened on any device.
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  async send(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, name: true, email: true, preferredLanguage: true, emailVerified: true },
    });
    if (user.emailVerified) return { alreadyVerified: true };
    if (!this.mail.canDeliver) throw emailNotConfigured();
    const expiresAt = await this.issue(user);
    return { sent: true, sentTo: maskEmail(user.email), expiresAt };
  }

  // Right after signup (the account's first sign-in): the same email,
  // unasked, when it can reach the person. Never fails the signup.
  async sendAfterSignup(userId: string): Promise<void> {
    if (!this.mail.canDeliver) return;
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, preferredLanguage: true, emailVerified: true },
      });
      if (!user || user.emailVerified) return;
      await this.issue(user);
    } catch (error) {
      this.logger.warn(`Signup verification email for ${userId} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Whether a link still works, without using it, so the page can say a
  // used or expired link up front.
  async check(rawToken: string): Promise<{ valid: boolean; email?: string }> {
    const row = await this.prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashVerifyToken(rawToken) } });
    const owner = row ? await this.prisma.user.findUnique({ where: { id: row.userId }, select: { email: true, status: true } }) : null;
    if (!verifyLinkUsable(row, owner, new Date())) return { valid: false };
    return { valid: true, email: row!.email };
  }

  // Uses the link up: claimed with a conditional update, so two clicks
  // racing verify once and the second gets LINK_INVALID.
  async verify(rawToken: string): Promise<{ verified: true; email: string }> {
    const row = await this.prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashVerifyToken(rawToken) } });
    if (!row) throw linkInvalid();
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const { count } = await tx.emailVerificationToken.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
      if (count !== 1) throw linkInvalid();
      const owner = await tx.user.findUnique({ where: { id: row.userId }, select: { id: true, email: true, status: true, emailVerifiedAt: true } });
      if (!owner || !verifyLinkUsable({ ...row, usedAt: null }, owner, now)) throw linkInvalid();
      await tx.user.update({ where: { id: owner.id }, data: { emailVerified: true, emailVerifiedAt: owner.emailVerifiedAt ?? now } });
      return { verified: true as const, email: owner.email };
    });
  }

  // A new link for the current address; older unused ones stop working.
  private async issue(user: Recipient): Promise<Date> {
    const rawToken = newVerifyToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + VERIFY_TTL_MS);
    const [, created] = await this.prisma.$transaction([
      this.prisma.emailVerificationToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } }),
      this.prisma.emailVerificationToken.create({ data: { userId: user.id, email: user.email, tokenHash: hashVerifyToken(rawToken), expiresAt } }),
    ]);
    const link = `${this.config.get<string>('USER_FRONTEND_URL') ?? 'http://localhost:3000'}/verify-email?token=${rawToken}`;
    try {
      await this.mail.sendVerifyEmail(user.email, localeOf(user.preferredLanguage), { name: user.name, link, hours: VERIFY_TTL_MS / 3_600_000 });
    } catch {
      await this.prisma.emailVerificationToken.delete({ where: { id: created.id } }).catch(() => undefined);
      throw emailNotSent();
    }
    return expiresAt;
  }

  // Housekeeping: links over and done with for a day go.
  async cleanup(now = new Date()): Promise<void> {
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    await this.prisma.emailVerificationToken.deleteMany({ where: { OR: [{ expiresAt: { lt: dayAgo } }, { usedAt: { lt: dayAgo } }] } });
  }
}
