import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { formatTaka, localeOf } from '../billing/billing-text.js';
import { toPaisa } from '../billing/pricing.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { destinationLabel, type MethodSnapshot } from './payout-methods.js';

type Client = PrismaService | Prisma.TransactionClient;

// What a REFERRAL or PAYOUT row in the member's bell is about; the app
// builds the words from `data` in the reader's language.
export type ReferralEvent =
  // A friend's payment earned a commission (still in the refund window).
  | 'COMMISSION_PENDING'
  // A friend paid while the referrer wasn't on a paid plan: nothing earned.
  | 'COMMISSION_MISSED'
  // A commission left the refund window: "৳ X is ready to withdraw".
  | 'COMMISSION_AVAILABLE'
  // The friend was refunded inside the window, or an admin cancelled it.
  | 'COMMISSION_CANCELLED'
  // Sent to an invited friend who hasn't bought yet ("Send a reminder").
  | 'INVITE_REMINDER';

export type PayoutEvent = 'PAYOUT_APPROVED' | 'PAYOUT_PAID' | 'PAYOUT_REJECTED';

export type NoticeData = Record<string, string | number | null>;

// Where the member's emails lead in the customer app.
const WITHDRAWALS_PATH = '/referrals?tab=withdrawals';

export const money = (value: { toString(): string } | number): string => (toPaisa(value) / 100).toFixed(2);

// The member's bell for the Referral Program, and the payout emails. The
// bell row is the record (its key keeps it to one); an email goes only
// with a new row, best-effort, and only when email is set up.
@Injectable()
export class ReferralNotices {
  private readonly logger = new Logger(ReferralNotices.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  // True when the row is new.
  async bell(
    userId: string,
    type: 'REFERRAL' | 'PAYOUT',
    key: string,
    data: { event: ReferralEvent | PayoutEvent } & NoticeData,
    client: Client = this.prisma,
  ): Promise<boolean> {
    const { count } = await client.userNotification.createMany({
      data: [{ userId, key, type, businessId: null, data: data as Prisma.InputJsonObject }],
      skipDuplicates: true,
    });
    return count > 0;
  }

  async payoutApproved(payout: PayoutForNotice) {
    await this.bell(payout.userId, 'PAYOUT', `payout:${payout.id}:approved`, {
      event: 'PAYOUT_APPROVED',
      payoutId: payout.id,
      displayId: payout.displayId,
      amount: money(payout.amount),
      methodType: payout.method.type,
    });
  }

  async payoutPaid(payout: PayoutForNotice & { paidAmount: { toString(): string }; trxId: string; paidAt: Date }, incomeWallet: string | null) {
    const fresh = await this.bell(payout.userId, 'PAYOUT', `payout:${payout.id}:paid`, {
      event: 'PAYOUT_PAID',
      payoutId: payout.id,
      displayId: payout.displayId,
      amount: money(payout.amount),
      paidAmount: money(payout.paidAmount),
      trxId: payout.trxId,
      methodType: payout.method.type,
      paidAt: payout.paidAt.toISOString(),
      incomeWallet,
    });
    if (!fresh) return;
    await this.email(payout.userId, (user, locale) =>
      this.mail.sendPayoutNoticeEmail(user.email, locale, {
        kind: 'PAID',
        name: user.name,
        displayId: payout.displayId,
        amount: formatTaka(toPaisa(payout.paidAmount), locale),
        destination: destinationLabel(payout.method),
        trxId: payout.trxId,
        reason: null,
        incomeWallet,
        link: this.link(),
      }),
    );
  }

  async payoutRejected(payout: PayoutForNotice & { rejectReason: string }) {
    const fresh = await this.bell(payout.userId, 'PAYOUT', `payout:${payout.id}:rejected`, {
      event: 'PAYOUT_REJECTED',
      payoutId: payout.id,
      displayId: payout.displayId,
      amount: money(payout.amount),
      methodType: payout.method.type,
      reason: payout.rejectReason,
    });
    if (!fresh) return;
    await this.email(payout.userId, (user, locale) =>
      this.mail.sendPayoutNoticeEmail(user.email, locale, {
        kind: 'REJECTED',
        name: user.name,
        displayId: payout.displayId,
        amount: formatTaka(toPaisa(payout.amount), locale),
        destination: destinationLabel(payout.method),
        trxId: null,
        reason: payout.rejectReason,
        incomeWallet: null,
        link: this.link(),
      }),
    );
  }

  private link() {
    return `${this.config.get<string>('USER_FRONTEND_URL') ?? 'http://localhost:3000'}${WITHDRAWALS_PATH}`;
  }

  private async email(userId: string, send: (user: { name: string; email: string }, locale: 'en' | 'bn') => Promise<void>) {
    if (!this.mail.configured) return;
    try {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, preferredLanguage: true } });
      if (!user) return;
      await send(user, localeOf(user.preferredLanguage));
    } catch (error) {
      this.logger.warn(`Payout email for user ${userId} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export interface PayoutForNotice {
  id: string;
  userId: string;
  displayId: string;
  amount: { toString(): string };
  method: MethodSnapshot;
}
