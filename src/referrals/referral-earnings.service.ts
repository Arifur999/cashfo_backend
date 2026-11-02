import { Injectable } from '@nestjs/common';
import type { CommissionStatus, Prisma } from '@prisma/client';
import { displayPaymentId } from '../billing/billing-text.js';
import { fromPaisa, toPaisa } from '../billing/pricing.js';
import { dhakaMonthStart } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { EarningsQueryDto } from './dto/referral-pages.dto.js';
import { displayPayoutId } from './referral-money.js';

const STATUSES: CommissionStatus[] = ['ON_HOLD', 'AVAILABLE', 'IN_WITHDRAWAL', 'UNDER_CHECK', 'PAID_OUT', 'REVERSED', 'CANCELLED'];
const EXPORT_LIMIT = 5000;

export const EARNING_SELECT = {
  id: true,
  referralId: true,
  kind: true,
  status: true,
  paidAmount: true,
  rate: true,
  amount: true,
  availableAt: true,
  cancelReason: true,
  paidOutAt: true,
  endedAt: true,
  createdAt: true,
  payment: { select: { id: true, paidAt: true, plan: { select: { name: true } } } },
  payout: { select: { id: true, number: true, status: true } },
  referral: { select: { referredUser: { select: { name: true } } } },
} as const satisfies Prisma.ReferralCommissionSelect;

type Line = Prisma.ReferralCommissionGetPayload<{ select: typeof EARNING_SELECT }>;

// A spreadsheet cell: quoted when needed, and a leading = + - @ neutralised
// so a friend's name can't run as a formula.
const csvCell = (value: unknown): string => {
  let text = value == null ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// The month a line belongs to: its payment's (a line with no payment, an
// old bonus, goes by when it was made). "2026-10" on the Dhaka calendar.
function monthWhere(month: string): Prisma.ReferralCommissionWhereInput {
  const [year, m] = month.split('-').map(Number);
  const range = { gte: dhakaMonthStart(year, m), lt: dhakaMonthStart(year, m + 1) };
  return { OR: [{ payment: { paidAt: range } }, { paymentId: null, createdAt: range }] };
}

// "PAY-4QK2T8AB" (or part of it) finds the payment; anything else finds a
// friend by name.
function searchWhere(search: string): Prisma.ReferralCommissionWhereInput {
  const payment = /^pay-?([0-9a-f]{1,8})$/i.exec(search);
  if (payment) return { paymentId: { startsWith: payment[1].toLowerCase() } };
  return { referral: { referredUser: { name: { contains: search, mode: 'insensitive' } } } };
}

export const earningView = (line: Line) => ({
  id: line.id,
  referralId: line.referralId,
  friendName: line.referral.referredUser.name,
  kind: line.kind,
  planName: line.payment?.plan.name ?? null,
  paidAt: line.payment?.paidAt ?? line.createdAt,
  paymentDisplayId: line.payment ? displayPaymentId(line.payment.id) : null,
  paidAmount: fromPaisa(toPaisa(line.paidAmount)),
  rate: Number(line.rate),
  amount: fromPaisa(toPaisa(line.amount)),
  status: line.status,
  availableAt: line.availableAt,
  cancelReason: line.cancelReason,
  paidOutAt: line.paidOutAt,
  endedAt: line.endedAt,
  payout: line.payout && { id: line.payout.id, displayId: displayPayoutId(line.payout.number), status: line.payout.status },
});

// Referrals > Earnings: every commission line, newest first, with the
// totals by status for the filter cards (the month and search apply to
// those too; the status filter does not), and the statement download.
@Injectable()
export class ReferralEarningsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: EarningsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const base = this.where(userId, query);
    const where: Prisma.ReferralCommissionWhereInput = { AND: [base, ...(query.status ? [{ status: query.status }] : [])] };
    const [rows, total, groups] = await Promise.all([
      this.prisma.referralCommission.findMany({
        where,
        select: EARNING_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.referralCommission.count({ where }),
      this.prisma.referralCommission.groupBy({ by: ['status'], where: base, _sum: { amount: true }, _count: { _all: true } }),
    ]);
    const byStatus = new Map(groups.map((g) => [g.status, g]));
    return {
      data: rows.map(earningView),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      totals: Object.fromEntries(
        STATUSES.map((status) => {
          const g = byStatus.get(status);
          return [status, { count: g?._count._all ?? 0, amount: fromPaisa(toPaisa(g?._sum.amount ?? 0)) }];
        }),
      ),
    };
  }

  // Every line that is ready to withdraw, oldest first (Referrals > Withdraw).
  async available(userId: string) {
    const rows = await this.prisma.referralCommission.findMany({
      where: { referrerId: userId, status: 'AVAILABLE' },
      select: EARNING_SELECT,
      orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    return { data: rows.map(earningView) };
  }

  async exportCsv(userId: string, query: EarningsQueryDto): Promise<string> {
    const base = this.where(userId, query);
    const rows = await this.prisma.referralCommission.findMany({
      where: { AND: [base, ...(query.status ? [{ status: query.status }] : [])] },
      select: EARNING_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: EXPORT_LIMIT,
    });
    const header = ['Date', 'Friend', 'Plan', 'Kind', 'They paid', 'Rate %', 'Your share', 'Status', 'Ready on', 'Payment ID', 'Withdrawal'];
    const lines = rows.map((row) => {
      const view = earningView(row);
      return [
        view.paidAt,
        view.friendName,
        view.planName,
        view.kind,
        view.paidAmount,
        view.rate,
        view.amount,
        view.status,
        view.availableAt,
        view.paymentDisplayId,
        view.payout?.displayId,
      ]
        .map(csvCell)
        .join(',');
    });
    return [header.join(','), ...lines].join('\r\n') + '\r\n';
  }

  private where(userId: string, query: EarningsQueryDto): Prisma.ReferralCommissionWhereInput {
    return {
      AND: [{ referrerId: userId }, ...(query.month ? [monthWhere(query.month)] : []), ...(query.search ? [searchWhere(query.search)] : [])],
    };
  }
}
