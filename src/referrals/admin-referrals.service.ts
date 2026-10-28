import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type PayoutRequest, type PayoutStatus } from '@prisma/client';
import { displayPaymentId } from '../billing/billing-text.js';
import { fromPaisa, toPaisa } from '../billing/pricing.js';
import { dhakaDateKey, dhakaMonthStart, dhakaToday } from '../common/dhaka.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { TransactionsService } from '../transactions/transactions.service.js';
import type { ListPayoutsQueryDto, ListReferralsQueryDto, MarkPayoutPaidDto } from './dto/admin-referrals.dto.js';
import { payoutChecks } from './payout-checks.js';
import { METHOD_NAMES, readSnapshot } from './payout-methods.js';
import { findIncomeTarget, LEDGER_SELECT, memberLedger, requireOrCreateReferralBonusAccount, toEntry } from './referral-ledger.js';
import { addWorkingDays, allocateFifo, displayPayoutId, OPEN_PAYOUT_STATUSES, projectBacking, type Allocation } from './referral-money.js';
import { money, ReferralNotices } from './referral-notices.js';

type Client = PrismaService | Prisma.TransactionClient;

interface Actor {
  adminId: string;
  ipAddress?: string;
}

const PAYOUT_STATUSES: PayoutStatus[] = ['REQUESTED', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED'];
const EXPORT_LIMIT = 5000;
const paisaMoney = (value: { toString(): string } | null | undefined) => (value == null ? null : fromPaisa(toPaisa(value)));

const USER_SELECT = { id: true, name: true, email: true, phone: true } as const;

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

// Admin > Referrals & Payouts: the payout desk (approve, reject, mark
// paid, with the checks and "why this member is owed this"), every
// referral, and cancelling a commission. Money moves under the member's
// lock (withLocks(['referrals:<userId>'])), like the member's own requests.
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
      this.prisma.referral.aggregate({ where: { status: 'PENDING' }, _sum: { commissionAmount: true }, _count: { _all: true } }),
    ]);
    return {
      waiting: { amount: paisaMoney(waiting._sum.amount ?? 0), count: waiting._count._all },
      approved: { amount: paisaMoney(approved._sum.amount ?? 0), count: approved._count._all },
      paidThisMonth: { amount: paisaMoney(paid._sum.paidAmount ?? 0), count: paid._count._all, month: `${year}-${String(month).padStart(2, '0')}` },
      // Commissions still inside the refund window.
      onHold: { amount: paisaMoney(onHold._sum.commissionAmount ?? 0), count: onHold._count._all },
    };
  }

  async getPayout(id: string) {
    const row = await this.prisma.payoutRequest.findUnique({ where: { id }, include: { user: { select: USER_SELECT } } });
    if (!row) throw new NotFoundException('Payout request not found');
    const context = (await this.contexts([row])).get(row.id)!;
    const now = new Date();
    const referralIds = context.backing.map((b) => b.referralId);
    const [referrals, admins, account, settings] = await Promise.all([
      this.prisma.referral.findMany({
        where: { id: { in: referralIds } },
        include: { referredUser: { select: { id: true, name: true } }, payment: { select: { status: true, plan: { select: { name: true } } } } },
      }),
      this.prisma.user.findMany({
        where: { id: { in: [row.approvedBy, row.processedBy].filter((x): x is string => Boolean(x)) } },
        select: { id: true, name: true },
      }),
      row.incomeAccountId
        ? this.prisma.account.findUnique({ where: { id: row.incomeAccountId }, select: { name: true, business: { select: { name: true } } } })
        : null,
      this.settingsService.getReferralSettings(),
    ]);
    const referralById = new Map(referrals.map((r) => [r.id, r]));
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
      // The commissions behind it: allocated at Mark paid, expected (oldest
      // first) before that.
      owedBecause: context.backing.map((part) => {
        const referral = referralById.get(part.referralId);
        return {
          referralId: part.referralId,
          friend: referral ? { id: referral.referredUser.id, name: referral.referredUser.name } : null,
          kind: referral?.kind ?? null,
          planName: referral?.payment?.plan.name ?? null,
          paidAmount: paisaMoney(referral?.paidAmount),
          commissionAmount: paisaMoney(referral?.commissionAmount ?? referral?.rewardAmount),
          amount: fromPaisa(part.paisa),
          availableAt: referral?.availableAt ?? null,
          pastWindow: Boolean(referral?.availableAt && referral.availableAt <= now),
          refunded: referral?.payment?.status === 'REFUNDED',
        };
      }),
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

  async approve(id: string, actor: Actor) {
    const userId = await this.ownerOf(id);
    const row = await this.transactions.withLocks([`referrals:${userId}`], async (tx) => {
      const { count } = await tx.payoutRequest.updateMany({
        where: { id, status: 'REQUESTED' },
        data: { status: 'APPROVED', approvedAt: new Date(), approvedBy: actor.adminId },
      });
      if (count === 0) await this.refuse(tx, id, 'approved', 'REQUESTED');
      await this.audit(tx, actor, 'REFERRAL_PAYOUT_APPROVED', id, { status: 'REQUESTED' }, { status: 'APPROVED' });
      return tx.payoutRequest.findUniqueOrThrow({ where: { id } });
    });
    await this.notices.payoutApproved({ ...row, displayId: displayPayoutId(row.number), method: readSnapshot(row.methodSnapshot) });
    return this.getPayout(id);
  }

  // The money goes back to the member's balance (it is no longer set aside).
  async reject(id: string, reason: string, actor: Actor) {
    const userId = await this.ownerOf(id);
    const row = await this.transactions.withLocks([`referrals:${userId}`], async (tx) => {
      const before = await tx.payoutRequest.findUniqueOrThrow({ where: { id }, select: { status: true } });
      const { count } = await tx.payoutRequest.updateMany({
        where: { id, status: { in: [...OPEN_PAYOUT_STATUSES] } },
        data: { status: 'REJECTED', rejectedAt: new Date(), rejectReason: reason, processedBy: actor.adminId },
      });
      if (count === 0) await this.refuse(tx, id, 'rejected', 'REQUESTED or APPROVED');
      await this.audit(tx, actor, 'REFERRAL_PAYOUT_REJECTED', id, { status: before.status }, { status: 'REJECTED', reason });
      return tx.payoutRequest.findUniqueOrThrow({ where: { id } });
    });
    await this.notices.payoutRejected({ ...row, displayId: displayPayoutId(row.number), method: readSnapshot(row.methodSnapshot), rejectReason: reason });
    return this.getPayout(id);
  }

  // APPROVED -> PAID: the request's amount comes off the member's
  // commissions, oldest first (PayoutAllocation), and, when the member
  // asked for it, the money is booked as Referral income in their wallet --
  // all in one transaction. The bell and email follow.
  async markPaid(id: string, dto: MarkPayoutPaidDto, actor: Actor) {
    const current = await this.prisma.payoutRequest.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Payout request not found');
    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
    if (paidAt.getTime() > Date.now() + 5 * 60 * 1000) throw new BadRequestException('The payment date cannot be in the future');
    const amountPaisa = toPaisa(current.amount);
    const paidPaisa = dto.paidAmount !== undefined ? Math.round(dto.paidAmount * 100) : amountPaisa - toPaisa(current.fee);
    if (paidPaisa <= 0 || paidPaisa > amountPaisa) throw new BadRequestException(`The amount sent must be more than 0 and at most ৳ ${fromPaisa(amountPaisa)}`);

    const keys = [`referrals:${current.userId}`, ...(current.incomeBusinessId ? [`referral-bonus:${current.incomeBusinessId}`] : [])];
    const result = await this.transactions.withLocks(keys, async (tx) => {
      const { count } = await tx.payoutRequest.updateMany({
        where: { id, status: 'APPROVED' },
        data: { status: 'PAID', paidAt, paidAmount: new Prisma.Decimal(fromPaisa(paidPaisa)), trxId: dto.trxId, processedBy: actor.adminId },
      });
      if (count === 0) await this.refuse(tx, id, 'marked paid', 'APPROVED');

      // The open requests were counted as set aside; this one now takes its
      // amount from the commissions themselves.
      const rows = await tx.referral.findMany({ where: { referrerId: current.userId, status: 'AVAILABLE' }, select: LEDGER_SELECT });
      const allocation = allocateFifo(rows.map(toEntry), amountPaisa);
      if (!allocation) throw new ConflictException("The member's available commissions no longer cover this request");
      await this.applyAllocation(tx, id, allocation, paidAt);

      let incomeWallet: string | null = null;
      if (current.incomeBusinessId && current.incomeAccountId) {
        const target = await findIncomeTarget(tx, current.userId, current.incomeBusinessId, current.incomeAccountId);
        // A wallet archived (or a workspace left) since the request: the
        // payout still goes ahead, without the income entry.
        if (!('problem' in target)) {
          const incomeAccount = await requireOrCreateReferralBonusAccount(tx, current.incomeBusinessId);
          const amount = paidPaisa / 100;
          const posted = await this.transactions.createTransaction(
            current.incomeBusinessId,
            {
              transactionType: 'INCOME',
              transactionDate: dhakaDateKey(paidAt),
              description: `Referral payout ${displayPayoutId(current.number)}`,
              entries: [
                { accountId: target.account.id, entryType: 'DEBIT', amount, categoryId: 'Referral Bonus' },
                { accountId: incomeAccount.id, entryType: 'CREDIT', amount },
              ],
            },
            current.userId,
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

  // --- Every referral ---

  async listReferrals(query: ListReferralsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const base: Prisma.ReferralWhereInput = query.search
      ? {
          OR: [
            { referrer: { name: { contains: query.search, mode: 'insensitive' } } },
            { referrer: { email: { contains: query.search, mode: 'insensitive' } } },
            { referredUser: { name: { contains: query.search, mode: 'insensitive' } } },
            { referredUser: { email: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {};
    const where: Prisma.ReferralWhereInput = { ...base, ...(query.status && { status: query.status }) };
    const [rows, total, groups] = await Promise.all([
      this.prisma.referral.findMany({
        where,
        include: {
          referrer: { select: { id: true, name: true, email: true } },
          referredUser: { select: { id: true, name: true, email: true } },
          payment: { select: { id: true, status: true, paidAt: true, payerAccount: true, amount: true, plan: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.referral.count({ where }),
      this.prisma.referral.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    ]);
    const counts = new Map(groups.map((g) => [g.status, g._count._all]));
    return {
      data: rows.map((r) => ({
        id: r.id,
        referrer: r.referrer,
        friend: r.referredUser,
        joinedAt: r.createdAt,
        kind: r.kind,
        status: r.status,
        payment: r.payment && {
          id: r.payment.id,
          displayId: displayPaymentId(r.payment.id),
          planName: r.payment.plan.name,
          amount: paisaMoney(r.payment.amount),
          status: r.payment.status,
          paidAt: r.payment.paidAt,
          payerAccount: r.payment.payerAccount,
        },
        paidAmount: paisaMoney(r.paidAmount),
        commissionRate: r.commissionRate ? Number(r.commissionRate) : null,
        commissionAmount: fromPaisa(toEntry(r).commissionPaisa),
        availableAt: r.availableAt,
        paidOutAmount: paisaMoney(r.paidOutAmount),
        paidOutAt: r.paidOutAt,
        cancelReason: r.cancelReason,
        cancelledAt: r.cancelledAt,
      })),
      meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
      statusCounts: {
        ALL: [...counts.values()].reduce((a, b) => a + b, 0),
        ...Object.fromEntries((['JOINED', 'PENDING', 'AVAILABLE', 'PAID_OUT', 'CANCELLED'] as const).map((s) => [s, counts.get(s) ?? 0])),
      },
    };
  }

  // An admin cancels a commission that is pending or available and not
  // paid out at all. Refused when the member's open requests rely on it.
  async cancelReferral(id: string, reason: string, actor: Actor) {
    const found = await this.prisma.referral.findUnique({ where: { id }, select: { referrerId: true } });
    if (!found) throw new NotFoundException('Referral not found');
    const cancelled = await this.transactions.withLocks([`referrals:${found.referrerId}`], async (tx) => {
      const referral = await tx.referral.findUniqueOrThrow({ where: { id }, include: { referredUser: { select: { name: true } } } });
      if (referral.status !== 'PENDING' && referral.status !== 'AVAILABLE') {
        throw new ConflictException(`Only a pending or available commission can be cancelled; this one is ${referral.status.toLowerCase()}`);
      }
      if (toPaisa(referral.paidOutAmount) > 0) throw new ConflictException('Part of this commission is already paid out');
      if (referral.status === 'AVAILABLE') {
        const { entries, balances } = await memberLedger(tx, referral.referrerId);
        const left = entries.filter((e) => e.status === 'AVAILABLE' && e.id !== id).reduce((sum, e) => sum + e.commissionPaisa - e.paidOutPaisa, 0);
        if (left < balances.reservedPaisa) {
          throw new ConflictException("The member's open withdrawal requests rely on this commission. Reject them first.");
        }
      }
      await tx.referral.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'ADMIN' } });
      await this.audit(tx, actor, 'REFERRAL_COMMISSION_CANCELLED', id, { status: referral.status }, { status: 'CANCELLED', reason }, 'Referral');
      return referral;
    });
    await this.notices.bell(cancelled.referrerId, 'REFERRAL', `referral:${id}:cancelled`, {
      event: 'COMMISSION_CANCELLED',
      referralId: id,
      friendName: cancelled.referredUser.name,
      amount: money(cancelled.commissionAmount ?? cancelled.rewardAmount),
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

  // What each request's row needs beyond itself: the commissions behind it,
  // the checks, and how many friends of the member have paid.
  private async contexts(rows: (PayoutRequest & { user: { name: string; phone: string | null } })[]) {
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const paidIds = rows.filter((r) => r.status === 'PAID').map((r) => r.id);
    const [referrals, openPayouts, allocations, settings] = await Promise.all([
      this.prisma.referral.findMany({
        where: { referrerId: { in: userIds } },
        select: { ...LEDGER_SELECT, referrerId: true, paymentId: true, payment: { select: { status: true, payerAccount: true } } },
      }),
      this.prisma.payoutRequest.findMany({
        where: { userId: { in: userIds }, status: { in: [...OPEN_PAYOUT_STATUSES] } },
        select: { id: true, number: true, userId: true, amount: true },
      }),
      paidIds.length ? this.prisma.payoutAllocation.findMany({ where: { payoutId: { in: paidIds } } }) : [],
      this.settingsService.getReferralSettings(),
    ]);
    const referralById = new Map(referrals.map((r) => [r.id, r]));
    const out = new Map<string, { backing: Allocation[]; checks: ReturnType<typeof payoutChecks>; payingFriends: number }>();
    for (const row of rows) {
      const mine = referrals.filter((r) => r.referrerId === row.userId);
      let backing: Allocation[] = [];
      if (row.status === 'PAID') {
        backing = allocations.filter((a) => a.payoutId === row.id).map((a) => ({ referralId: a.referralId, paisa: toPaisa(a.amount), closes: false }));
      } else if (OPEN_PAYOUT_STATUSES.includes(row.status)) {
        const open = openPayouts.filter((p) => p.userId === row.userId).map((p) => ({ id: p.id, number: p.number, amountPaisa: toPaisa(p.amount) }));
        backing = projectBacking(mine.map(toEntry), open, row.id);
      }
      out.set(row.id, {
        backing,
        checks: payoutChecks({
          method: readSnapshot(row.methodSnapshot),
          user: row.user,
          codeConfirmedAt: row.codeConfirmedAt,
          backing: backing.map((b) => ({ refunded: referralById.get(b.referralId)?.payment?.status === 'REFUNDED' })),
          friendPayerAccounts: mine.map((r) => r.payment?.payerAccount ?? null),
          flagSameNumber: settings.flagSameNumber,
        }),
        payingFriends: mine.filter((r) => r.paymentId && (r.status === 'PENDING' || r.status === 'AVAILABLE' || r.status === 'PAID_OUT')).length,
      });
    }
    return out;
  }

  private rowView(
    row: PayoutRequest & { user: { id: string; name: string; email: string } },
    context: { checks: ReturnType<typeof payoutChecks>; payingFriends: number },
  ) {
    const amount = toPaisa(row.amount);
    const fee = toPaisa(row.fee);
    return {
      id: row.id,
      displayId: displayPayoutId(row.number),
      number: row.number,
      createdAt: row.createdAt,
      user: { id: row.user.id, name: row.user.name, email: row.user.email },
      payingFriends: context.payingFriends,
      amount: fromPaisa(amount),
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

  private async applyAllocation(tx: Prisma.TransactionClient, payoutId: string, allocation: Allocation[], paidAt: Date) {
    for (const part of allocation) {
      await tx.referral.update({
        where: { id: part.referralId },
        data: {
          paidOutAmount: { increment: new Prisma.Decimal(fromPaisa(part.paisa)) },
          ...(part.closes && { status: 'PAID_OUT', paidOutAt: paidAt }),
        },
      });
    }
    await tx.payoutAllocation.createMany({
      data: allocation.map((part) => ({ payoutId, referralId: part.referralId, amount: new Prisma.Decimal(fromPaisa(part.paisa)) })),
    });
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
