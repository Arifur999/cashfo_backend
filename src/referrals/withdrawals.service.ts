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
import { findIncomeTarget, releaseLines } from './referral-ledger.js';
import { addWorkingDays, displayPayoutId, MAX_WITHDRAWAL_LINES, OPEN_PAYOUT_STATUSES } from './referral-money.js';

type Client = PrismaService | Prisma.TransactionClient;

// What the one-time code confirms; checked again when it is used.
interface WithdrawalPayload {
  commissionIds: string[];
  methodId: string;
  income: { businessId: string; accountId: string } | null;
}

const BN_METHOD: Record<string, string> = { BKASH: 'বিকাশ', NAGAD: 'নগদ', ROCKET: 'রকেট', BANK: 'ব্যাংক' };

export const refuse = (reason: string, message: string, extra: Record<string, unknown> = {}) =>
  new BadRequestException({ statusCode: 400, error: 'Bad Request', message, reason, ...extra });

// A member's withdrawals of referral money, made of whole commission
// lines: start (checks the ticked lines and sends a one-time code),
// confirm with the code (creates the REQUESTED request and moves its lines
// IN_WITHDRAWAL), the history, and cancelling a request nobody has
// approved yet.
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
    const commissionIds = dto.commissionIds ?? (await this.oldestCovering(userId, dto.amount ?? 0));
    const checked = await this.check(this.prisma, userId, { commissionIds, methodId: dto.methodId, income: dto.income ?? null }, settings);
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
    const payload = row?.payload as unknown as Partial<WithdrawalPayload> | undefined;
    const [method, lines] = payload?.methodId
      ? await Promise.all([
          this.prisma.payoutMethod.findFirst({ where: { id: payload.methodId, userId } }),
          this.prisma.referralCommission.aggregate({ where: { id: { in: payload.commissionIds ?? [] }, referrerId: userId }, _sum: { amount: true } }),
        ])
      : [null, null];
    const action = method && lines ? this.actionText(toPaisa(lines._sum.amount ?? 0), snapshotOf(method)) : { en: 'confirm your withdrawal', bn: 'টাকা তোলা' };
    return this.codes.resend(person, challengeId, 'PAYOUT_REQUEST', action);
  }

  // The code is checked (the try counts), then everything is checked again
  // under the member's lock -- a line may have moved since -- and the
  // request is made with its lines. The code is used up with it, so a
  // double submit makes one request.
  async confirm(userId: string, dto: ConfirmWithdrawalDto) {
    const code = await this.codes.verify(userId, dto.challengeId, 'PAYOUT_REQUEST', dto.code);
    const payload = code.payload as unknown as WithdrawalPayload;
    if (!Array.isArray(payload.commissionIds)) throw refuse('CODE_USED', 'This code was made for an older version of the app. Start again to get a new one.');
    const settings = await this.settingsService.getReferralSettings();
    const request = await this.transactions.withLocks([`referrals:${userId}`], async (tx) => {
      if (!(await this.codes.consume(tx, code.id))) throw refuse('CODE_USED', 'This code was already used. Start again to get a new one.');
      const checked = await this.check(tx, userId, payload, settings);
      const amount = new Prisma.Decimal(fromPaisa(checked.amountPaisa));
      const created = await tx.payoutRequest.create({
        data: {
          userId,
          amount,
          requestedAmount: amount,
          lineIds: payload.commissionIds,
          fee: new Prisma.Decimal(settings.withdrawalFee),
          methodId: payload.methodId,
          methodSnapshot: checked.method as unknown as Prisma.InputJsonObject,
          incomeBusinessId: payload.income?.businessId ?? null,
          incomeAccountId: payload.income?.accountId ?? null,
          codeConfirmedAt: new Date(),
        },
      });
      const { count } = await tx.referralCommission.updateMany({
        where: { id: { in: payload.commissionIds }, referrerId: userId, status: 'AVAILABLE' },
        data: { status: 'IN_WITHDRAWAL', payoutId: created.id },
      });
      // check() just saw them all AVAILABLE under this same lock.
      if (count !== payload.commissionIds.length) throw new ConflictException('Some of these lines changed. Start again.');
      return created;
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
        // Waiting to be paid (requested or approved): "Being checked".
        askedFor: fromPaisa(toPaisa(open._sum.amount ?? 0)),
        // Taken from the balance by paid requests, and what was sent.
        paidOut: fromPaisa(toPaisa(paid._sum.amount ?? 0)),
        received: fromPaisa(toPaisa(paid._sum.paidAmount ?? 0)),
      },
    };
  }

  // Only before an admin has approved it; its lines go back to AVAILABLE.
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
      await releaseLines(tx, [id]);
      return tx.payoutRequest.findUniqueOrThrow({ where: { id } });
    });
    const [view] = await this.present(this.prisma, [row], settings);
    return view;
  }

  // An older app asks for an amount: the oldest available lines that
  // cover it (the request is their total).
  private async oldestCovering(userId: string, amount: number): Promise<string[]> {
    const lines = await this.prisma.referralCommission.findMany({
      where: { referrerId: userId, status: 'AVAILABLE' },
      orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, amount: true },
      take: MAX_WITHDRAWAL_LINES,
    });
    const want = Math.round(amount * 100);
    const ids: string[] = [];
    let got = 0;
    for (const line of lines) {
      if (got >= want) break;
      ids.push(line.id);
      got += toPaisa(line.amount);
    }
    return ids;
  }

  // The rules a request must meet, against the lines as they are now.
  private async check(client: Client, userId: string, payload: WithdrawalPayload, settings: ReferralSettings) {
    // A paused programme stops new earning only: what members already earned stays theirs to withdraw.
    const ids = [...new Set(payload.commissionIds)];
    if (ids.length === 0) throw refuse('NO_LINES', 'Tick the commissions you want to withdraw');
    if (ids.length > MAX_WITHDRAWAL_LINES) throw refuse('TOO_MANY_LINES', `Tick at most ${MAX_WITHDRAWAL_LINES} commissions in one withdrawal`);
    const lines = await client.referralCommission.findMany({ where: { id: { in: ids }, referrerId: userId }, select: { status: true, amount: true } });
    if (lines.length !== ids.length || lines.some((line) => line.status !== 'AVAILABLE')) {
      throw refuse('LINES_CHANGED', 'Some of these commissions are no longer available. Reload and tick them again.');
    }
    const amountPaisa = lines.reduce((sum, line) => sum + toPaisa(line.amount), 0);
    if (amountPaisa < settings.minWithdrawal * 100) {
      throw refuse('BELOW_MINIMUM', `The smallest withdrawal is ৳ ${formatTaka(settings.minWithdrawal * 100)}`, {
        minWithdrawal: fromPaisa(settings.minWithdrawal * 100),
      });
    }
    if (amountPaisa <= settings.withdrawalFee * 100) throw refuse('FEE_EXCEEDS_AMOUNT', 'The amount must be more than the transfer fee');
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
      payload: { commissionIds: ids.sort(), methodId: method.id, income: payload.income } satisfies WithdrawalPayload,
    };
  }

  private async recipient(userId: string): Promise<CodeRecipient> {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, name: true, email: true, phone: true, phoneVerifiedAt: true, preferredLanguage: true },
    });
  }

  private actionText(amountPaisa: number, method: MethodSnapshot) {
    const where = destinationLabel(method);
    return {
      en: `withdraw ৳ ${formatTaka(amountPaisa, 'en')} to ${where}`,
      bn: `${where.replace(METHOD_NAMES[method.type], BN_METHOD[method.type])}-এ ৳ ${formatTaka(amountPaisa, 'bn')} তোলা`,
    };
  }

  // Requests as the member sees them, with the lines each was made of (as
  // they stand now) and the wallet the income goes to.
  async present(client: Client, rows: PayoutRequest[], settings: ReferralSettings) {
    const ids = [...new Set(rows.flatMap((r) => r.lineIds))];
    const accountIds = [...new Set(rows.map((r) => r.incomeAccountId).filter((id): id is string => Boolean(id)))];
    const [accounts, lines] = await Promise.all([
      accountIds.length
        ? client.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true, business: { select: { name: true } } } })
        : [],
      ids.length
        ? client.referralCommission.findMany({
            where: { id: { in: ids } },
            orderBy: [{ availableAt: 'asc' }, { id: 'asc' }],
            select: COMMISSION_LINE_SELECT,
          })
        : [],
    ]);
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    return rows.map((row) =>
      customerPayoutView(
        row,
        settings,
        row.incomeAccountId ? (accountById.get(row.incomeAccountId) ?? null) : null,
        lines.filter((line) => row.lineIds.includes(line.id)),
      ),
    );
  }
}

export const COMMISSION_LINE_SELECT = {
  id: true,
  payoutId: true,
  kind: true,
  status: true,
  paidAmount: true,
  amount: true,
  availableAt: true,
  createdAt: true,
  payment: { select: { paidAt: true, plan: { select: { name: true } } } },
  referral: { select: { referredUser: { select: { name: true } } } },
} as const satisfies Prisma.ReferralCommissionSelect;

export type CommissionLine = Prisma.ReferralCommissionGetPayload<{ select: typeof COMMISSION_LINE_SELECT }>;

// One commission line as a member sees it inside a request.
export const lineView = (line: CommissionLine) => ({
  id: line.id,
  friendName: line.referral.referredUser.name,
  kind: line.kind,
  planName: line.payment?.plan.name ?? null,
  paidAt: line.payment?.paidAt ?? line.createdAt,
  paidAmount: fromPaisa(toPaisa(line.paidAmount)),
  amount: fromPaisa(toPaisa(line.amount)),
  status: line.status,
});

export function customerPayoutView(
  row: PayoutRequest,
  settings: Pick<ReferralSettings, 'payWithinDays'>,
  incomeAccount: { name: string; business: { name: string } } | null,
  lines: CommissionLine[] = [],
) {
  const amountPaisa = toPaisa(row.amount);
  const feePaisa = toPaisa(row.fee);
  return {
    id: row.id,
    displayId: displayPayoutId(row.number),
    number: row.number,
    amount: fromPaisa(amountPaisa),
    // What was asked for, before an admin held any line back.
    requestedAmount: fromPaisa(toPaisa(row.requestedAmount ?? row.amount)),
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
    // The commissions in it; UNDER_CHECK ones were held back at approval.
    lines: lines.map(lineView),
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
