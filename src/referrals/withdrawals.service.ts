import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type PayoutRequest } from '@prisma/client';
import { formatTaka } from '../billing/billing-text.js';
import { fromPaisa, toPaisa } from '../billing/pricing.js';
import { OneTimeCodesService, type CodeRecipient } from '../one-time-codes/one-time-codes.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ReferralSettings } from '../settings/referral-settings.js';
import { SettingsService } from '../settings/settings.service.js';
import { TransactionsService } from '../transactions/transactions.service.js';
import type { ConfirmWithdrawalDto, StartWithdrawalDto } from './dto/withdrawal.dto.js';
import { destinationLabel, METHOD_NAMES, readSnapshot, snapshotOf, type MethodSnapshot } from './payout-methods.js';
import { findIncomeTarget, memberLedger } from './referral-ledger.js';
import { addWorkingDays, displayPayoutId, OPEN_PAYOUT_STATUSES } from './referral-money.js';

type Client = PrismaService | Prisma.TransactionClient;

// What the one-time code confirms; checked again when it is used.
interface WithdrawalPayload {
  amount: string;
  methodId: string;
  income: { businessId: string; accountId: string } | null;
}

const BN_METHOD: Record<string, string> = { BKASH: 'বিকাশ', NAGAD: 'নগদ', ROCKET: 'রকেট', BANK: 'ব্যাংক' };

export const refuse = (reason: string, message: string, extra: Record<string, unknown> = {}) =>
  new BadRequestException({ statusCode: 400, error: 'Bad Request', message, reason, ...extra });

// A member's withdrawals of referral money: start (checks the request and
// sends a one-time code), confirm with the code (creates the REQUESTED
// request, which sets the money aside), the history, and cancelling a
// request nobody has approved yet.
@Injectable()
export class WithdrawalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly transactions: TransactionsService,
    private readonly codes: OneTimeCodesService,
  ) {}

  async start(userId: string, dto: StartWithdrawalDto) {
    const person = await this.recipient(userId);
    const settings = await this.settingsService.getReferralSettings();
    const checked = await this.check(this.prisma, userId, { amount: dto.amount.toFixed(2), methodId: dto.methodId, income: dto.income ?? null }, settings);
    return this.codes.issue(
      person,
      'PAYOUT_REQUEST',
      checked.payload as unknown as Prisma.InputJsonObject,
      this.actionText(checked.amountPaisa, checked.method),
    );
  }

  async resend(userId: string, challengeId: string) {
    const person = await this.recipient(userId);
    const row = await this.prisma.oneTimeCode.findFirst({ where: { id: challengeId, userId, purpose: 'PAYOUT_REQUEST' } });
    const payload = row?.payload as unknown as WithdrawalPayload | undefined;
    const method = payload ? await this.prisma.payoutMethod.findFirst({ where: { id: payload.methodId, userId } }) : null;
    const action = payload && method ? this.actionText(toPaisa(payload.amount), snapshotOf(method)) : { en: 'confirm your withdrawal', bn: 'টাকা তোলা' };
    return this.codes.resend(person, challengeId, 'PAYOUT_REQUEST', action);
  }

  // The code is checked (the try counts), then everything is checked again
  // under the member's lock -- the balance may have changed -- and the
  // request is made. The code is used up with it, so a double submit
  // makes one request.
  async confirm(userId: string, dto: ConfirmWithdrawalDto) {
    const code = await this.codes.verify(userId, dto.challengeId, 'PAYOUT_REQUEST', dto.code);
    const payload = code.payload as unknown as WithdrawalPayload;
    const settings = await this.settingsService.getReferralSettings();
    const request = await this.transactions.withLocks([`referrals:${userId}`], async (tx) => {
      if (!(await this.codes.consume(tx, code.id))) throw refuse('CODE_USED', 'This code was already used. Start again to get a new one.');
      const checked = await this.check(tx, userId, payload, settings);
      return tx.payoutRequest.create({
        data: {
          userId,
          amount: new Prisma.Decimal(fromPaisa(checked.amountPaisa)),
          fee: new Prisma.Decimal(settings.withdrawalFee),
          methodId: payload.methodId,
          methodSnapshot: checked.method as unknown as Prisma.InputJsonObject,
          incomeBusinessId: payload.income?.businessId ?? null,
          incomeAccountId: payload.income?.accountId ?? null,
          codeConfirmedAt: new Date(),
        },
      });
    });
    const [view] = await this.present(this.prisma, [request], settings);
    return view;
  }

  async list(userId: string, page: number, limit: number) {
    const settings = await this.settingsService.getReferralSettings();
    const [rows, total, open, paid] = await Promise.all([
      this.prisma.payoutRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.payoutRequest.count({ where: { userId } }),
      this.prisma.payoutRequest.aggregate({ where: { userId, status: { in: [...OPEN_PAYOUT_STATUSES] } }, _sum: { amount: true } }),
      this.prisma.payoutRequest.aggregate({ where: { userId, status: 'PAID' }, _sum: { amount: true, paidAmount: true } }),
    ]);
    return {
      data: await this.present(this.prisma, rows, settings),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      totals: {
        // Waiting to be paid (requested or approved).
        askedFor: fromPaisa(toPaisa(open._sum.amount ?? 0)),
        // Taken from the balance by paid requests, and what was sent.
        paidOut: fromPaisa(toPaisa(paid._sum.amount ?? 0)),
        received: fromPaisa(toPaisa(paid._sum.paidAmount ?? 0)),
      },
    };
  }

  // Only before an admin has approved it; the money goes back to the
  // balance.
  async cancel(userId: string, id: string) {
    const settings = await this.settingsService.getReferralSettings();
    const row = await this.transactions.withLocks([`referrals:${userId}`], async (tx) => {
      const { count } = await tx.payoutRequest.updateMany({
        where: { id, userId, status: 'REQUESTED' },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      if (count === 0) {
        const current = await tx.payoutRequest.findFirst({ where: { id, userId }, select: { status: true } });
        if (!current) throw new NotFoundException('Withdrawal not found');
        throw new ConflictException(`Only a request that is not approved yet can be cancelled; this one is ${current.status.toLowerCase()}`);
      }
      return tx.payoutRequest.findUniqueOrThrow({ where: { id } });
    });
    const [view] = await this.present(this.prisma, [row], settings);
    return view;
  }

  // The rules a request must meet, against the balance as it is now.
  private async check(client: Client, userId: string, payload: WithdrawalPayload, settings: ReferralSettings) {
    // A paused programme stops new earning only: what members already earned stays theirs to withdraw.
    const amountPaisa = toPaisa(payload.amount);
    if (amountPaisa < settings.minWithdrawal * 100) {
      throw refuse('BELOW_MINIMUM', `The smallest withdrawal is ৳ ${formatTaka(settings.minWithdrawal * 100)}`, {
        minWithdrawal: fromPaisa(settings.minWithdrawal * 100),
      });
    }
    if (amountPaisa <= settings.withdrawalFee * 100) throw refuse('FEE_EXCEEDS_AMOUNT', 'The amount must be more than the transfer fee');
    const { balances } = await memberLedger(client, userId);
    if (amountPaisa > balances.availablePaisa) {
      throw refuse('ABOVE_AVAILABLE', `You can withdraw up to ৳ ${formatTaka(balances.availablePaisa)}`, { available: fromPaisa(balances.availablePaisa) });
    }
    const method = await client.payoutMethod.findFirst({ where: { id: payload.methodId, userId, deletedAt: null } });
    if (!method) throw refuse('METHOD_NOT_FOUND', 'Choose where the money should go');
    if (!settings.payoutMethods.includes(method.type))
      throw refuse('METHOD_NOT_ALLOWED', `Withdrawals to ${METHOD_NAMES[method.type]} are not available right now`);
    if (payload.income) {
      const target = await findIncomeTarget(client, userId, payload.income.businessId, payload.income.accountId);
      if ('problem' in target) throw refuse('INCOME_NOT_ALLOWED', target.problem);
    }
    return {
      amountPaisa,
      method: snapshotOf(method),
      payload: { amount: fromPaisa(amountPaisa), methodId: method.id, income: payload.income } satisfies WithdrawalPayload,
    };
  }

  private async recipient(userId: string): Promise<CodeRecipient> {
    return this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true, email: true, phone: true, phoneVerifiedAt: true, preferredLanguage: true } });
  }

  private actionText(amountPaisa: number, method: MethodSnapshot) {
    const where = destinationLabel(method);
    return {
      en: `withdraw ৳ ${formatTaka(amountPaisa, 'en')} to ${where}`,
      bn: `${where.replace(METHOD_NAMES[method.type], BN_METHOD[method.type])}-এ ৳ ${formatTaka(amountPaisa, 'bn')} তোলা`,
    };
  }

  // Requests as the member sees them, with the wallet the income goes to.
  async present(client: Client, rows: PayoutRequest[], settings: ReferralSettings) {
    const accountIds = [...new Set(rows.map((r) => r.incomeAccountId).filter((id): id is string => Boolean(id)))];
    const accounts = accountIds.length
      ? await client.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true, business: { select: { name: true } } } })
      : [];
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    return rows.map((row) => customerPayoutView(row, settings, row.incomeAccountId ? (accountById.get(row.incomeAccountId) ?? null) : null));
  }
}

export function customerPayoutView(
  row: PayoutRequest,
  settings: Pick<ReferralSettings, 'payWithinDays'>,
  incomeAccount: { name: string; business: { name: string } } | null,
) {
  const amountPaisa = toPaisa(row.amount);
  const feePaisa = toPaisa(row.fee);
  return {
    id: row.id,
    displayId: displayPayoutId(row.number),
    number: row.number,
    amount: fromPaisa(amountPaisa),
    fee: fromPaisa(feePaisa),
    // What reaches the member.
    receiveAmount: fromPaisa(amountPaisa - feePaisa),
    status: row.status,
    method: readSnapshot(row.methodSnapshot),
    methodId: row.methodId,
    createdAt: row.createdAt,
    // Paid by this Dhaka date, counting working days (Sunday to Thursday).
    expectedBy: addWorkingDays(row.createdAt, settings.payWithinDays),
    approvedAt: row.approvedAt,
    paidAt: row.paidAt,
    paidAmount: row.paidAmount ? fromPaisa(toPaisa(row.paidAmount)) : null,
    trxId: row.trxId,
    rejectedAt: row.rejectedAt,
    rejectReason: row.rejectReason,
    cancelledAt: row.cancelledAt,
    canCancel: row.status === 'REQUESTED',
    income: row.incomeAccountId
      ? {
          businessId: row.incomeBusinessId,
          accountId: row.incomeAccountId,
          accountName: incomeAccount?.name ?? null,
          businessName: incomeAccount?.business.name ?? null,
          // Set once it was added at Mark paid.
          transactionId: row.incomeTransactionId,
        }
      : null,
  };
}
