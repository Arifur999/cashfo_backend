import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { MailService, type EmailAttachment } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { dateLabel, formatTaka, localeOf } from './billing-text.js';
import { toPaisa } from './pricing.js';

// What a BILLING row in the customer's bell is about. The app builds the
// words from `data` in the reader's language (like every bell row).
export type BillingEvent = 'PAYMENT_PAID' | 'PAYMENT_FAILED' | 'PAYMENT_EXPIRED' | 'PAYMENT_REFUNDED' | 'PLAN_ENDING' | 'PLAN_PAST_DUE' | 'PLAN_ENDED';

export interface BillingNotice {
  // Stable, so a notice is written once however often it is found:
  // "payment:<id>:paid", "plan:<subscriptionId>:ending:<YYYY-MM-DD>", ...
  key: string;
  data: { event: BillingEvent } & Record<string, string | number | null>;
}

// Where an email's button leads in the customer app.
const BILLING_PATH = '/settings/plans';

// The customer's bell and email for billing. The bell row is the record:
// the email goes only with a row that is new, so a notice found twice (the
// timer and a page read) is mailed once. Email is best-effort and skipped
// when sending isn't set up.
@Injectable()
export class BillingNotices {
  private readonly logger = new Logger(BillingNotices.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  // True when the row is new.
  async bell(userId: string, notice: BillingNotice, client: PrismaService | Prisma.TransactionClient = this.prisma): Promise<boolean> {
    const { count } = await client.userNotification.createMany({
      data: [{ userId, key: notice.key, type: 'BILLING', businessId: null, data: notice.data as Prisma.InputJsonObject }],
      skipDuplicates: true,
    });
    return count > 0;
  }

  // A payment was confirmed: the bell, and a receipt by email, with the
  // invoice PDF when `attachment` makes one. True when the receipt went.
  async paid(
    payment: { id: string; userId: string | null; amount: { toString(): string }; periodEnd: Date | null },
    planName: string,
    invoiceNumber: string,
    attachment?: () => Promise<EmailAttachment | null>,
  ): Promise<boolean> {
    if (!payment.userId) return false;
    const fresh = await this.bell(payment.userId, {
      key: `payment:${payment.id}:paid`,
      data: {
        event: 'PAYMENT_PAID',
        paymentId: payment.id,
        planName,
        amount: Number(payment.amount.toString()).toFixed(2),
        periodEnd: payment.periodEnd?.toISOString() ?? null,
        invoiceNumber,
      },
    });
    if (!fresh) return false;
    return this.email(payment.userId, async (user, locale) => {
      const file = attachment ? await attachment() : null;
      await this.mail.sendBillingReceiptEmail(
        user.email,
        locale,
        {
          name: user.name,
          planName,
          amount: formatTaka(toPaisa(payment.amount), locale),
          invoiceNumber,
          paidUntil: payment.periodEnd ? dateLabel(payment.periodEnd, locale) : null,
          link: this.link(),
        },
        file ? [file] : undefined,
      );
    });
  }

  // A plan is ending soon, or has ended: the bell, and an email.
  async plan(userId: string, notice: BillingNotice, email: { kind: 'ENDING' | 'ENDED'; planName: string; trial: boolean; date: Date } | null) {
    const fresh = await this.bell(userId, notice);
    if (!fresh || !email) return;
    await this.email(userId, async (user, locale) =>
      this.mail.sendPlanNoticeEmail(user.email, locale, {
        kind: email.kind,
        name: user.name,
        planName: email.planName,
        trial: email.trial,
        date: dateLabel(email.date, locale),
        link: this.link(),
      }),
    );
  }

  private link() {
    return `${this.config.get<string>('USER_FRONTEND_URL') ?? 'http://localhost:3000'}${BILLING_PATH}`;
  }

  // True when the email went.
  private async email(userId: string, send: (user: { name: string; email: string }, locale: 'en' | 'bn') => Promise<void>): Promise<boolean> {
    if (!this.mail.configured) return false;
    try {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, preferredLanguage: true } });
      if (!user) return false;
      await send(user, localeOf(user.preferredLanguage));
      return true;
    } catch (error) {
      this.logger.warn(`Billing email for user ${userId} failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
