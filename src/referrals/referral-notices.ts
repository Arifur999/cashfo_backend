import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { dateLabel, formatTaka, localeOf } from '../billing/billing-text.js';
import { toPaisa } from '../billing/pricing.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SmsService } from '../sms/sms.service.js';
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
  // An admin held a line back from a withdrawal for a second look, or let
  // it go back to the balance.
  | 'COMMISSION_UNDER_CHECK'
  | 'COMMISSION_RELEASED'
  // Sent to an invited friend who hasn't bought yet ("Send a reminder").
  | 'INVITE_REMINDER';

export type PayoutEvent = 'PAYOUT_APPROVED' | 'PAYOUT_PAID' | 'PAYOUT_REJECTED';

export type NoticeData = Record<string, string | number | null>;

// Where the member's emails lead in the customer app.
const EARNINGS_PATH = '/referrals/earnings';
const WITHDRAWALS_PATH = '/referrals/withdrawals';

export const money = (value: { toString(): string } | number): string => (toPaisa(value) / 100).toFixed(2);

// The member's bell for the Referral Program, and the referral emails. The
// bell row is the record (its key keeps it to one); an email goes only
// with a new row, best-effort, when email is set up and the member hasn't
// turned that email off (Referrals > Profile & payouts).
@Injectable()
export class ReferralNotices {
  private readonly logger = new Logger(ReferralNotices.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly sms: SmsService,
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

  // A friend's payment earned a commission: the bell row (in the payment's
  // transaction), then the email once it has committed.
  async commissionEarned(
    referrerId: string,
    commission: { id: string; amount: { toString(): string }; availableAt: Date; renewal: boolean },
    friendName: string,
    data: NoticeData,
    tx: Prisma.TransactionClient,
  ): Promise<() => Promise<void>> {
    const fresh = await this.bell(referrerId, 'REFERRAL', `commission:${commission.id}:pending`, { event: 'COMMISSION_PENDING', ...data }, tx);
    if (!fresh) return async () => {};
    return () =>
      this.email(referrerId, 'earned', (user, locale) =>
        this.mail.sendCommissionEarnedEmail(user.email, locale, {
          name: user.name,
          friendName,
          amount: formatTaka(toPaisa(commission.amount), locale),
          readyOn: dateLabel(commission.availableAt, locale),
          renewal: commission.renewal,
          link: this.link(EARNINGS_PATH),
        }),
      );
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
    // "We send your money": an SMS with the transaction ID to a verified
    // phone, else the email.
    if (await this.paidSms(payout)) return;
    await this.email(payout.userId, 'payouts', (user, locale) =>
      this.mail.sendPayoutNoticeEmail(user.email, locale, {
        kind: 'PAID',
        name: user.name,
        displayId: payout.displayId,
        amount: formatTaka(toPaisa(payout.paidAmount), locale),
        destination: destinationLabel(payout.method),
        trxId: payout.trxId,
        reason: null,
        incomeWallet,
        link: this.link(WITHDRAWALS_PATH),
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
    await this.email(payout.userId, 'payouts', (user, locale) =>
      this.mail.sendPayoutNoticeEmail(user.email, locale, {
        kind: 'REJECTED',
        name: user.name,
        displayId: payout.displayId,
        amount: formatTaka(toPaisa(payout.amount), locale),
        destination: destinationLabel(payout.method),
        trxId: null,
        reason: payout.rejectReason,
        incomeWallet: null,
        link: this.link(WITHDRAWALS_PATH),
      }),
    );
  }

  // True when the SMS went.
  private async paidSms(payout: PayoutForNotice & { paidAmount: { toString(): string }; trxId: string }): Promise<boolean> {
    if (!this.sms.configured) return false;
    try {
      const user = await this.prisma.user.findUnique({ where: { id: payout.userId }, select: { phone: true, phoneVerifiedAt: true, referralEmailPayouts: true, preferredLanguage: true } });
      if (!user?.phone || !user.phoneVerifiedAt || !user.referralEmailPayouts) return false;
      await this.sms.send(user.phone, payoutPaidSmsText(localeOf(user.preferredLanguage), formatTaka(toPaisa(payout.paidAmount), localeOf(user.preferredLanguage)), destinationLabel(payout.method), payout.trxId));
      return true;
    } catch (error) {
      this.logger.warn(`Payout SMS for user ${payout.userId} failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private link(path: string) {
    return `${this.config.get<string>('USER_FRONTEND_URL') ?? 'http://localhost:3000'}${path}`;
  }

  private async email(userId: string, kind: 'earned' | 'payouts', send: (user: { name: string; email: string }, locale: 'en' | 'bn') => Promise<void>) {
    if (!this.mail.configured) return;
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true, preferredLanguage: true, referralEmailEarned: true, referralEmailPayouts: true },
      });
      if (!user || !(kind === 'earned' ? user.referralEmailEarned : user.referralEmailPayouts)) return;
      await send(user, localeOf(user.preferredLanguage));
    } catch (error) {
      this.logger.warn(`Referral email for user ${userId} failed: ${error instanceof Error ? error.message : String(error)}`);
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

// The text of the "money sent" SMS (amount already formatted).
export function payoutPaidSmsText(locale: 'en' | 'bn', amount: string, destination: string, trxId: string): string {
  return locale === 'en' ? `Smartly: Tk ${amount} sent to your ${destination}. TrxID ${trxId}.` : `Smartly: আপনার ${destination}-এ ৳ ${amount} পাঠানো হয়েছে। TrxID ${trxId}।`;
}
