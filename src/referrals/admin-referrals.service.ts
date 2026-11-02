import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type CommissionStatus, type PayoutRequest, type PayoutStatus } from '@prisma/client';
import { displayPaymentId } from '../billing/billing-text.js';
import { fromPaisa, toPaisa } from '../billing/pricing.js';
import { dhakaDateKey, dhakaMonthStart, dhakaToday } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { TransactionsService } from '../transactions/transactions.service.js';
import type { ApprovePayoutDto, ListCommissionsQueryDto, ListPayoutsQueryDto, MarkPayoutPaidDto } from './dto/admin-referrals.dto.js';
import { payoutChecks } from './payout-checks.js';
import { METHOD_NAMES, readSnapshot } from './payout-methods.js';
import { findIncomeTarget, releaseLines, requireOrCreateReferralBonusAccount } from './referral-ledger.js';
import { addWorkingDays, displayPayoutId, OPEN_PAYOUT_STATUSES, samePhone } from './referral-money.js';
import { money, ReferralNotices } from './referral-notices.js';

type Client = PrismaService | Prisma.TransactionClient;

interface Actor {
  adminId: string;
  ipAddress?: string;
}

const PAYOUT_STATUSES: PayoutStatus[] = ['REQUESTED', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED'];
const COMMISSION_STATUSES: CommissionStatus[] = ['ON_HOLD', 'AVAILABLE', 'IN_WITHDRAWAL', 'UNDER_CHECK', 'PAID_OUT', 'REVERSED', 'CANCELLED'];
const EXPORT_LIMIT = 5000;
const paisaMoney = (value: { toString(): string } | null | undefined) => (value == null ? null : fromPaisa(toPaisa(value)));

const USER_SELECT = { id: true, name: true, email: true, phone: true } as const;

// A request's lines with what the desk checks on each: did the friend's
// payment reach us (and through which gateway), and was it refunded.
const LINE_SELECT = {
  id: true,
  payoutId: true,
  kind: true,
  status: true,
  paidAmount: true,
  rate: true,
  amount: true,
  availableAt: true,
  createdAt: true,
  payment: { select: { id: true, status: true, paidAt: true, gateway: true, gatewayReferenceId: true, payerAccount: true, plan: { select: { name: true } } } },
  referral: { select: { referredUser: { select: { id: true, name: true, email: true, phone: true } } } },
} as const satisfies Prisma.ReferralCommissionSelect;

type DeskLine = Prisma.ReferralCommissionGetPayload<{ select: typeof LINE_SELECT }>;

// When the request reached its current status.
const statusAt = (row: PayoutRequest): Date =>
  ({ REQUESTED: row.createdAt, APPROVED: row.approvedAt, PAID: row.paidAt, REJECTED: row.rejectedAt, CANCELLED: row.cancelledAt })[row.status] ?? row.createdAt;

// A spreadsheet cell: quoted when needed, and a leading = + - @ neutralised
// so a name can't run as a formula.
const csvCell = (value: unknown): string => {
  let text = value == null ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const sumPaisa = (lines: { amount: { toString(): string } }[]) => lines.reduce((total, line) => total + toPaisa(line.amount), 0);

// Admin > Referrals & Payouts: the payout desk (review each request's
// commission lines, approve -- holding back any that need a second look --,
// reject, mark paid), every commission, and releasing or cancelling one.
// Money moves under the member's lock (withLocks(['referrals:<userId>'])),
// like the member's own requests.
@Injectable()
export class AdminReferralsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly transactions: TransactionsService,
    private readonly notices: ReferralNotices,
  ) {}

  // --- The payout desk ---

  async listPayouts(query: ListPayoutsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const base = this.payoutWhere(query);
    const where: Prisma.PayoutRequestWhereInput = { ...base, ...(query.status && { status: query.status }) };
    const [rows, total, groups] = await Promise.all([
      this.prisma.payoutRequest.findMany({
        where,
        include: { user: { select: USER_SELECT } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payoutRequest.count({ where }),
      this.prisma.payoutRequest.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    ]);
    const counts = new Map(groups.map((g) => [g.status, g._count._all]));
    const contexts = await this.contexts(rows);
    return {
      data: rows.map((row) => this.rowView(row, contexts.get(row.id)!)),
      meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
      statusCounts: { ALL: [...counts.values()].reduce((a, b) => a + b, 0), ...Object.fromEntries(PAYOUT_STATUSES.map((s) => [s, counts.get(s) ?? 0])) },
    };
  }

  async payoutStats() {
    const { year, month } = dhakaToday();
    const [waiting, approved, paid, onHold] = await Promise.all([
      this.prisma.payoutRequest.aggregate({ where: { status: 'REQUESTED' }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.payoutRequest.aggregate({ where: { status: 'APPROVED' }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.payoutRequest.aggregate({
        where: { status: 'PAID', paidAt: { gte: dhakaMonthStart(year, month) } },
        _sum: { paidAmount: true },
        _count: { _all: true },
      }),
      this.prisma.referralCommission.aggregate({ where: { status: 'ON_HOLD' }, _sum: { amount: true }, _count: { _all: true } }),
    ]);
    return {
      waiting: { amount: paisaMoney(waiting._sum.amount ?? 0), count: waiting._count._all },
      approved: { amount: paisaMoney(approved._sum.amount ?? 0), count: approved._count._all },
      paidThisMonth: { amount: paisaMoney(paid._sum.paidAmount ?? 0), count: paid._count._all, month: `${year}-${String(month).padStart(2, '0')}` },
      // Commissions still inside the refund window.
      onHold: { amount: paisaMoney(onHold._sum.amount ?? 0), count: onHold._count._all },
    };
  }

  async getPayout(id: string) {
    const row = await this.prisma.payoutRequest.findUnique({ where: { id }, include: { user: { select: USER_SELECT } } });
    if (!row) throw new NotFoundException('Payout request not found');
    const context = (await this.contexts([row])).get(row.id)!;
    const [admins, account, settings, firstReferral, referred, paidBefore] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: [row.approvedBy, row.processedBy].filter((x): x is string => Boolean(x)) } },
        select: { id: true, name: true },
      }),
      row.incomeAccountId
        ? this.prisma.account.findUnique({ where: { id: row.incomeAccountId }, select: { name: true, business: { select: { name: true } } } })
        : null,
      this.settingsService.getReferralSettings(),
      this.prisma.referral.findFirst({ where: { referrerId: row.userId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      this.prisma.referral.count({ where: { referrerId: row.userId } }),
      this.prisma.payoutRequest.aggregate({ where: { userId: row.userId, status: 'PAID', id: { not: row.id } }, _sum: { paidAmount: true } }),
    ]);
    const adminName = new Map(admins.map((a) => [a.id, a.name]));
    return {
      ...this.rowView(row, context),
      user: row.user,
      approvedByName: row.approvedBy ? (adminName.get(row.approvedBy) ?? null) : null,
      processedByName: row.processedBy ? (adminName.get(row.processedBy) ?? null) : null,
      income: row.incomeAccountId
        ? {
            businessId: row.incomeBusinessId,
            businessName: account?.business.name ?? null,
            accountId: row.incomeAccountId,
            accountName: account?.name ?? null,
            transactionId: row.incomeTransactionId,
          }
        : null,
      // About the member: referring since, how many people, paid before.
      member: {
        since: firstReferral?.createdAt ?? null,
        referred,
        paidBefore: paisaMoney(paidBefore._sum.paidAmount ?? 0),
      },
      // Every friend payment in the request, each to check with the gateway.
      lines: context.lines.map((line) => this.lineView(line, row.user.phone)),
      // Due by this Dhaka date (working days, Sunday to Thursday).
      expectedBy: addWorkingDays(row.createdAt, settings.payWithinDays),
    };
  }

  async exportPayouts(query: ListPayoutsQueryDto): Promise<string> {
    const where: Prisma.PayoutRequestWhereInput = { ...this.payoutWhere(query), ...(query.status && { status: query.status }) };
    const rows = await this.prisma.payoutRequest.findMany({
      where,
      include: { user: { select: USER_SELECT } },
      orderBy: { createdAt: 'desc' },
      take: EXPORT_LIMIT,
    });
    const header = [
      'Request',
      'Requested at',
      'Member',
      'Email',
      'Asked for',
      'Amount',
      'Fee',
      'To send',
      'Method',
      'Number or account',
      'Account name',
      'Bank',
      'Branch',
      'Routing',
      'Status',
      'Paid at',
      'Paid amount',
      'Transaction ID',
      'Reject reason',
    ];
    const lines = rows.map((row) => {
      const method = readSnapshot(row.methodSnapshot);
      const amount = toPaisa(row.amount);
      const fee = toPaisa(row.fee);
      return [
        displayPayoutId(row.number),
        row.createdAt,
        row.user.name,
        row.user.email,
        fromPaisa(toPaisa(row.requestedAmount ?? row.amount)),
        fromPaisa(amount),
        fromPaisa(fee),
        fromPaisa(amount - fee),
        METHOD_NAMES[method.type],
        method.walletNumber ?? method.accountNumber,
        method.accountName,
        method.bankName,
        method.branch,
        method.routingNumber,
        row.status,
        row.paidAt,
        paisaMoney(row.paidAmount),
        row.trxId,
        row.rejectReason,
      ]
        .map(csvCell)
        .join(',');
    });
    return [header.join(','), ...lines].join('\r\n') + '\r\n';
  }

  // REQUESTED -> APPROVED. Lines the admin unticked are held back
  // (UNDER_CHECK, still pointing at this request) and the request becomes
  // the total of the rest.
  async approve(id: string, dto: ApprovePayoutDto, actor: Actor) {
    const userId = await this.ownerOf(id);
    const excluded = [...new Set(dto.excludedIds ?? [])];
    const { row, held } = await this.transactions.withLocks([`referrals:${userId}`], async (tx) => {
      const current = await tx.payoutRequest.findUniqueOrThrow({ where: { id } });
      if (current.status !== 'REQUESTED') await this.refuse(tx, id, 'approved', 'REQUESTED');
      const lines = await tx.referralCommission.findMany({ where: { payoutId: id, status: 'IN_WITHDRAWAL' }, select: { id: true, amount: true } });
      const lineIds = new Set(lines.map((line) => line.id));
      if (excluded.some((lineId) => !lineIds.has(lineId))) throw new BadRequestException('Only lines of this request can be held back');
      const kept = lines.filter((line) => !excluded.includes(line.id));
      // A request from before lines (none) keeps its amount.
      const amountPaisa = lines.length ? sumPaisa(kept) : toPaisa(current.amount);
      if (lines.length && kept.length === 0) throw new BadRequestException('Every line is held back. Reject the request instead.');
      if (amountPaisa <= toPaisa(current.fee)) throw new BadRequestException('What is left must be more than the transfer fee. Reject the request instead.');

      const { count } = await tx.payoutRequest.updateMany({
        where: { id, status: 'REQUESTED' },
        data: { status: 'APPROVED', approvedAt: new Date(), approvedBy: actor.adminId, amount: new Prisma.Decimal(fromPaisa(amountPaisa)) },
      });
      if (count === 0) await this.refuse(tx, id, 'approved', 'REQUESTED');
      if (excluded.length) {
        await tx.referralCommission.updateMany({ where: { id: { in: excluded }, payoutId: id, status: 'IN_WITHDRAWAL' }, data: { status: 'UNDER_CHECK' } });
      }
      await this.audit(
        tx,
        actor,
        'REFERRAL_PAYOUT_APPROVED',
        id,
        { status: 'REQUESTED', amount: money(current.amount) },
        {
          status: 'APPROVED',
          amount: fromPaisa(amountPaisa),
          heldBack: excluded,
        },
      );
      return { row: await tx.payoutRequest.findUniqueOrThrow({ where: { id } }), held: excluded.length };
    });
    await this.notices.payoutApproved({ ...row, displayId: displayPayoutId(row.number), method: readSnapshot(row.methodSnapshot) });
    if (held > 0) {
      await this.notices.bell(row.userId, 'REFERRAL', `payout:${row.id}:held`, {
        event: 'COMMISSION_UNDER_CHECK',
        payoutId: row.id,
        displayId: displayPayoutId(row.number),
        count: held,
      });
    }
    return this.getPayout(id);
  }

  // The lines still in the request go back to the member's balance.
  async reject(id: string, reason: string, actor: Actor) {
    const userId = await this.ownerOf(id);
    const row = await this.transactions.withLocks([`referrals:${userId}`], async (tx) => {
      const before = await tx.payoutRequest.findUniqueOrThrow({ where: { id }, select: { status: true } });
      const { count } = await tx.payoutRequest.updateMany({
        where: { id, status: { in: [...OPEN_PAYOUT_STATUSES] } },
        data: { status: 'REJECTED', rejectedAt: new Date(), rejectReason: reason, processedBy: actor.adminId },
      });
      if (count === 0) await this.refuse(tx, id, 'rejected', 'REQUESTED or APPROVED');
      await releaseLines(tx, [id]);
      await this.audit(tx, actor, 'REFERRAL_PAYOUT_REJECTED', id, { status: before.status }, { status: 'REJECTED', reason });
      return tx.payoutRequest.findUniqueOrThrow({ where: { id } });
    });
    await this.notices.payoutRejected({ ...row, displayId: displayPayoutId(row.number), method: readSnapshot(row.methodSnapshot), rejectReason: reason });
    return this.getPayout(id);
  }

  // APPROVED -> PAID: its lines are PAID_OUT and, when the member asked
  // for it, the money is booked as Referral income in their wallet -- all
  // in one transaction. The bell and email follow.
  async markPaid(id: string, dto: MarkPayoutPaidDto, actor: Actor) {
    const current = await this.prisma.payoutRequest.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Payout request not found');
    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
    if (paidAt.getTime() > Date.now() + 5 * 60 * 1000) throw new BadRequestException('The payment date cannot be in the future');

    const keys = [`referrals:${current.userId}`, ...(current.incomeBusinessId ? [`referral-bonus:${current.incomeBusinessId}`] : [])];
    const result = await this.transactions.withLocks(keys, async (tx) => {
      // Read again under the lock: approval may have changed the amount.
      const locked = await tx.payoutRequest.findUniqueOrThrow({ where: { id } });
      if (locked.status !== 'APPROVED') await this.refuse(tx, id, 'marked paid', 'APPROVED');
      const amountPaisa = toPaisa(locked.amount);
      const paidPaisa = dto.paidAmount !== undefined ? Math.round(dto.paidAmount * 100) : amountPaisa - toPaisa(locked.fee);
      if (paidPaisa <= 0 || paidPaisa > amountPaisa)
        throw new BadRequestException(`The amount sent must be more than 0 and at most ৳ ${fromPaisa(amountPaisa)}`);

      const { count } = await tx.payoutRequest.updateMany({
        where: { id, status: 'APPROVED' },
        data: { status: 'PAID', paidAt, paidAmount: new Prisma.Decimal(fromPaisa(paidPaisa)), trxId: dto.trxId, processedBy: actor.adminId },
      });
      if (count === 0) await this.refuse(tx, id, 'marked paid', 'APPROVED');
      await tx.referralCommission.updateMany({ where: { payoutId: id, status: 'IN_WITHDRAWAL' }, data: { status: 'PAID_OUT', paidOutAt: paidAt } });

      let incomeWallet: string | null = null;
      if (locked.incomeBusinessId && locked.incomeAccountId) {
        const target = await findIncomeTarget(tx, locked.userId, locked.incomeBusinessId, locked.incomeAccountId);
        // A wallet archived (or a workspace left) since the request: the
        // payout still goes ahead, without the income entry.
        if (!('problem' in target)) {
          const incomeAccount = await requireOrCreateReferralBonusAccount(tx, locked.incomeBusinessId);
          const amount = paidPaisa / 100;
          const posted = await this.transactions.createTransaction(
            locked.incomeBusinessId,
            {
              transactionType: 'INCOME',
              transactionDate: dhakaDateKey(paidAt),
              description: `Referral payout ${displayPayoutId(locked.number)}`,
              entries: [
                { accountId: target.account.id, entryType: 'DEBIT', amount, categoryId: 'Referral Bonus' },
                { accountId: incomeAccount.id, entryType: 'CREDIT', amount },
              ],
            },
            locked.userId,
            tx,
          );
          await tx.payoutRequest.update({ where: { id }, data: { incomeTransactionId: posted.id } });
          incomeWallet = target.account.name;
        }
      }

      await this.audit(
        tx,
        actor,
        'REFERRAL_PAYOUT_PAID',
        id,
        { status: 'APPROVED' },
        {
          status: 'PAID',
          trxId: dto.trxId,
          paidAt: paidAt.toISOString(),
          paidAmount: fromPaisa(paidPaisa),
          incomeAdded: incomeWallet !== null,
          note: dto.note ?? null,
        },
      );
      return { row: await tx.payoutRequest.findUniqueOrThrow({ where: { id } }), incomeWallet };
    });

    if (dto.notifyUser !== false) {
      const { row, incomeWallet } = result;
      await this.notices.payoutPaid(
        {
          ...row,
          displayId: displayPayoutId(row.number),
          method: readSnapshot(row.methodSnapshot),
          paidAmount: row.paidAmount ?? row.amount,
          trxId: dto.trxId,
          paidAt,
        },
        incomeWallet,
      );
    }
    return this.getPayout(id);
  }

  // --- Every commission ---

  async listCommissions(query: ListCommissionsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const base: Prisma.ReferralCommissionWhereInput = query.search
      ? {
          OR: [
            { referrer: { name: { contains: query.search, mode: 'insensitive' } } },
            { referrer: { email: { contains: query.search, mode: 'insensitive' } } },
            { referral: { referredUser: { name: { contains: query.search, mode: 'insensitive' } } } },
            { referral: { referredUser: { email: { contains: query.search, mode: 'insensitive' } } } },
          ],
        }
      : {};
    const where: Prisma.ReferralCommissionWhereInput = { ...base, ...(query.status && { status: query.status }) };
    const [rows, total, groups] = await Promise.all([
      this.prisma.referralCommission.findMany({
        where,
        select: {
          ...LINE_SELECT,
          cancelReason: true,
          paidOutAt: true,
          endedAt: true,
          referrer: { select: { id: true, name: true, email: true } },
          payout: { select: { id: true, number: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.referralCommission.count({ where }),
      this.prisma.referralCommission.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    ]);
    const counts = new Map(groups.map((g) => [g.status, g._count._all]));
    return {
      data: rows.map((row) => ({
        id: row.id,
        referrer: row.referrer,
        friend: { id: row.referral.referredUser.id, name: row.referral.referredUser.name, email: row.referral.referredUser.email },
        kind: row.kind,
        status: row.status,
        payment: row.payment && {
          id: row.payment.id,
          displayId: displayPaymentId(row.payment.id),
          planName: row.payment.plan.name,
          status: row.payment.status,
          paidAt: row.payment.paidAt,
          gateway: row.payment.gateway,
          reference: row.payment.gatewayReferenceId,
        },
        paidAmount: paisaMoney(row.paidAmount),
        rate: Number(row.rate),
        amount: paisaMoney(row.amount),
        availableAt: row.availableAt,
        payout: row.payout && { id: row.payout.id, displayId: displayPayoutId(row.payout.number), status: row.payout.status },
        cancelReason: row.cancelReason,
        paidOutAt: row.paidOutAt,
        endedAt: row.endedAt,
        createdAt: row.createdAt,
      })),
      meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
      statusCounts: { ALL: [...counts.values()].reduce((a, b) => a + b, 0), ...Object.fromEntries(COMMISSION_STATUSES.map((s) => [s, counts.get(s) ?? 0])) },
    };
  }

  // A line held back for a second look turned out fine: back to the
  // member's balance, to ask for again.
  async releaseCommission(id: string, actor: Actor) {
    const line = await this.lineOf(id);
    await this.transactions.withLocks([`referrals:${line.referrerId}`], async (tx) => {
      const { count } = await tx.referralCommission.updateMany({ where: { id, status: 'UNDER_CHECK' }, data: { status: 'AVAILABLE', payoutId: null } });
      if (count === 0) throw new ConflictException('Only a commission under check can be released');
      await this.audit(tx, actor, 'REFERRAL_COMMISSION_RELEASED', id, { status: 'UNDER_CHECK' }, { status: 'AVAILABLE' }, 'ReferralCommission');
    });
    await this.notices.bell(line.referrerId, 'REFERRAL', `commission:${id}:released`, {
      event: 'COMMISSION_RELEASED',
      commissionId: id,
      friendName: line.referral.referredUser.name,
      amount: money(line.amount),
    });
    return { success: true };
  }

  // An admin cancels a commission that is not in a request being paid:
  // on hold, available, or held back for a check.
  async cancelCommission(id: string, reason: string, actor: Actor) {
    const line = await this.lineOf(id);
    await this.transactions.withLocks([`referrals:${line.referrerId}`], async (tx) => {
      const { count } = await tx.referralCommission.updateMany({
        where: { id, status: { in: ['ON_HOLD', 'AVAILABLE', 'UNDER_CHECK'] } },
        data: { status: 'CANCELLED', cancelReason: 'ADMIN', endedAt: new Date(), payoutId: null },
      });
      if (count === 0) {
        const now = await tx.referralCommission.findUniqueOrThrow({ where: { id }, select: { status: true } });
        throw new ConflictException(
          now.status === 'IN_WITHDRAWAL'
            ? 'This commission is in a withdrawal. Hold it back when approving, or reject the request first.'
            : `Only a commission on hold, available or under check can be cancelled; this one is ${now.status.toLowerCase().replace('_', ' ')}`,
        );
      }
      await this.audit(tx, actor, 'REFERRAL_COMMISSION_CANCELLED', id, { status: line.status }, { status: 'CANCELLED', reason }, 'ReferralCommission');
    });
    await this.notices.bell(line.referrerId, 'REFERRAL', `commission:${id}:cancelled`, {
      event: 'COMMISSION_CANCELLED',
      commissionId: id,
      referralId: line.referralId,
      friendName: line.referral.referredUser.name,
      amount: money(line.amount),
      reason: 'ADMIN',
    });
    return { success: true };
  }

  // --- Helpers ---

  private payoutWhere(query: ListPayoutsQueryDto): Prisma.PayoutRequestWhereInput {
    const and: Prisma.PayoutRequestWhereInput[] = [];
    if (query.method) and.push({ methodSnapshot: { path: ['type'], equals: query.method } });
    if (query.search) {
      const search = query.search;
      const number = /^(?:wd-?)?(\d{1,9})$/i.exec(search);
      and.push({
        OR: [
          { user: { name: { contains: search, mode: 'insensitive' } } },
          { user: { email: { contains: search, mode: 'insensitive' } } },
          { trxId: { contains: search, mode: 'insensitive' } },
          ...(number ? [{ number: Number(number[1]) }] : []),
        ],
      });
    }
    return and.length ? { AND: and } : {};
  }

  // What each request's row needs beyond itself: its lines, the checks,
  // and whether it is the member's first request.
  private async contexts(rows: (PayoutRequest & { user: { name: string; phone: string | null } })[]) {
    const ids = rows.map((r) => r.id);
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const [lines, payers, firsts, settings] = await Promise.all([
      ids.length
        ? this.prisma.referralCommission.findMany({ where: { payoutId: { in: ids } }, select: LINE_SELECT, orderBy: [{ availableAt: 'asc' }, { id: 'asc' }] })
        : [],
      // The numbers every friend of these members paid from.
      userIds.length
        ? this.prisma.referralCommission.findMany({
            where: { referrerId: { in: userIds }, payment: { payerAccount: { not: null } } },
            select: { referrerId: true, payment: { select: { payerAccount: true } } },
          })
        : [],
      userIds.length ? this.prisma.payoutRequest.groupBy({ by: ['userId'], where: { userId: { in: userIds } }, _min: { number: true } }) : [],
      this.settingsService.getReferralSettings(),
    ]);
    const firstNumber = new Map(firsts.map((f) => [f.userId, f._min.number]));
    const now = new Date();
    const out = new Map<string, { lines: DeskLine[]; checks: ReturnType<typeof payoutChecks>; friends: number; isFirst: boolean }>();
    for (const row of rows) {
      const mine = lines.filter((line) => line.payoutId === row.id);
      out.set(row.id, {
        lines: mine,
        checks: payoutChecks({
          method: readSnapshot(row.methodSnapshot),
          user: row.user,
          codeConfirmedAt: row.codeConfirmedAt,
          backing: mine.map((line) => ({ refunded: line.payment?.status === 'REFUNDED' })),
          friendPayerAccounts: payers.filter((p) => p.referrerId === row.userId).map((p) => p.payment?.payerAccount ?? null),
          flagSameNumber: settings.flagSameNumber,
          holdsOver: mine.every((line) => line.availableAt <= now),
        }),
        friends: new Set(mine.map((line) => line.referral.referredUser.id)).size,
        isFirst: firstNumber.get(row.userId) === row.number,
      });
    }
    return out;
  }

  private rowView(
    row: PayoutRequest & { user: { id: string; name: string; email: string } },
    context: { lines: DeskLine[]; checks: ReturnType<typeof payoutChecks>; friends: number; isFirst: boolean },
  ) {
    const amount = toPaisa(row.amount);
    const fee = toPaisa(row.fee);
    return {
      id: row.id,
      displayId: displayPayoutId(row.number),
      number: row.number,
      createdAt: row.createdAt,
      user: { id: row.user.id, name: row.user.name, email: row.user.email },
      // The member's first request: worth a closer look.
      isFirst: context.isFirst,
      // "6 payments from 4 friends".
      lineCount: context.lines.length,
      friendCount: context.friends,
      amount: fromPaisa(amount),
      requestedAmount: fromPaisa(toPaisa(row.requestedAmount ?? row.amount)),
      fee: fromPaisa(fee),
      // What the admin sends.
      sendAmount: fromPaisa(amount - fee),
      method: readSnapshot(row.methodSnapshot),
      methodId: row.methodId,
      checks: context.checks,
      status: row.status,
      statusAt: statusAt(row),
      codeConfirmedAt: row.codeConfirmedAt,
      approvedAt: row.approvedAt,
      paidAt: row.paidAt,
      paidAmount: paisaMoney(row.paidAmount),
      trxId: row.trxId,
      rejectedAt: row.rejectedAt,
      rejectReason: row.rejectReason,
      cancelledAt: row.cancelledAt,
      incomeRequested: row.incomeAccountId !== null,
      incomeTransactionId: row.incomeTransactionId,
    };
  }

  // One line on the desk: the friend, their payment and whether it reached
  // us, the share, and a flag when the friend paid from the member's own
  // number.
  private lineView(line: DeskLine, memberPhone: string | null) {
    const friend = line.referral.referredUser;
    const payment = line.payment;
    return {
      id: line.id,
      status: line.status,
      kind: line.kind,
      friend: { id: friend.id, name: friend.name, email: friend.email, phone: friend.phone },
      payment: payment && {
        id: payment.id,
        displayId: displayPaymentId(payment.id),
        planName: payment.plan.name,
        paidAt: payment.paidAt,
        status: payment.status,
        gateway: payment.gateway,
        reference: payment.gatewayReferenceId,
        payerAccount: payment.payerAccount,
      },
      // RECEIVED: the payment stands; REFUNDED: it was refunded since;
      // UNKNOWN: an old bonus or a split-off part with no payment.
      reached: !payment ? 'UNKNOWN' : payment.status === 'REFUNDED' ? 'REFUNDED' : payment.status === 'SUCCESS' ? 'RECEIVED' : 'UNKNOWN',
      paidAmount: paisaMoney(line.paidAmount),
      rate: Number(line.rate),
      amount: paisaMoney(line.amount),
      availableAt: line.availableAt,
      paidFromMemberNumber: samePhone(payment?.payerAccount, memberPhone),
    };
  }

  private async lineOf(id: string) {
    const line = await this.prisma.referralCommission.findUnique({
      where: { id },
      select: { id: true, referrerId: true, referralId: true, status: true, amount: true, referral: { select: { referredUser: { select: { name: true } } } } },
    });
    if (!line) throw new NotFoundException('Commission not found');
    return line;
  }

  private async ownerOf(id: string): Promise<string> {
    const row = await this.prisma.payoutRequest.findUnique({ where: { id }, select: { userId: true } });
    if (!row) throw new NotFoundException('Payout request not found');
    return row.userId;
  }

  private async refuse(client: Client, id: string, what: string, from: string): Promise<never> {
    const current = await client.payoutRequest.findUnique({ where: { id }, select: { status: true } });
    if (!current) throw new NotFoundException('Payout request not found');
    throw new ConflictException(`Only a request that is ${from.toLowerCase()} can be ${what}; this one is ${current.status.toLowerCase()}`);
  }

  private audit(
    tx: Prisma.TransactionClient,
    actor: Actor,
    action: string,
    entityId: string,
    oldValue: Prisma.InputJsonObject,
    newValue: Prisma.InputJsonObject,
    entityType = 'PayoutRequest',
  ) {
    return tx.auditLog.create({ data: { adminUserId: actor.adminId, action, entityType, entityId, oldValue, newValue, ipAddress: actor.ipAddress } });
  }
}
