import { BillingCycle, type Prisma, type PrismaClient } from '@prisma/client';
import { MONEY_ACCOUNT_SUBTYPES } from '../accounts/accounts.service.js';
import { planLimits } from '../billing/usage.js';
import { placeOfIp } from '../common/ip-country.js';
import { referralBalances } from '../referrals/referral-ledger.js';

type Client = PrismaClient | Prisma.TransactionClient;

const DAY_MS = 24 * 60 * 60 * 1000;
const money = (value: { toString(): string } | number | null | undefined) => (value === null || value === undefined ? null : Number(value.toString()).toFixed(2));
const paisa = (value: number) => (value / 100).toFixed(2);
// The wallets the customer keeps money in: cash, bank, mobile banking and
// savings wallets (not the chart-of-accounts rows behind them).
const WALLET_SUBTYPES = [...MONEY_ACCOUNT_SUBTYPES, 'savings'];
const OPEN_TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_USER'] as const;

export interface OwnerWorkspace {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
  createdAt: Date;
}

// Whether each workspace is one the plan includes: the default first, then
// the oldest, up to the plan's maxWorkspaces (-1 = no limit). Pure.
export function workspacesIncluded<T extends OwnerWorkspace>(workspaces: T[], workspaceLimit: number): (T & { includedInPlan: boolean })[] {
  const ordered = [...workspaces].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.createdAt.getTime() - b.createdAt.getTime());
  const included = new Set(workspaceLimit < 0 ? ordered.map((w) => w.id) : ordered.slice(0, workspaceLimit).map((w) => w.id));
  return ordered.map((workspace) => ({ ...workspace, includedInPlan: included.has(workspace.id) }));
}

// The extra cards on Admin > Users > a user (AdminUserDetail): the numbers
// across their workspaces, the workspaces themselves, where they are
// signed in, what they have paid, their referrals and their tickets.
export async function ownerExtras(
  prisma: Client,
  owner: { id: string; ownedBusinesses: OwnerWorkspace[] },
  subscription: {
    status: string;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    lockedPrice: { toString(): string } | null;
    plan: { name: string; billingCycle: BillingCycle; price: { toString(): string }; featureLimits?: unknown };
  } | null,
  now = new Date(),
) {
  const userId = owner.id;
  const workspaceIds = owner.ownedBusinesses.map((business) => business.id);
  const since = new Date(now.getTime() - 30 * DAY_MS);

  const [wallets, txLast30d, txPerWorkspace, referrals, ledger, payments, firstCoupon, tickets, ticketCounts, sessions, notesCount] = await Promise.all([
    prisma.account.groupBy({
      by: ['accountSubtype'],
      where: { businessId: { in: workspaceIds }, status: 'ACTIVE', accountType: 'ASSET', accountSubtype: { in: WALLET_SUBTYPES } },
      _count: true,
    }),
    prisma.transaction.count({ where: { businessId: { in: workspaceIds }, createdAt: { gte: since }, status: 'POSTED', reversalOfId: null } }),
    prisma.transaction.groupBy({ by: ['businessId'], where: { businessId: { in: workspaceIds }, status: 'POSTED', reversalOfId: null }, _count: true }),
    prisma.referral.findMany({ where: { referrerId: userId }, select: { _count: { select: { commissions: { where: { kind: { not: 'BONUS' } } } } } } }),
    referralBalances(prisma, userId),
    prisma.payment.aggregate({ where: { userId, status: { in: ['SUCCESS', 'REFUNDED'] } }, _sum: { amount: true }, _count: true }),
    prisma.payment.findFirst({
      where: { userId, status: { in: ['SUCCESS', 'REFUNDED'] }, couponId: { not: null } },
      orderBy: { createdAt: 'asc' },
      select: { couponId: true, createdAt: true },
    }),
    prisma.supportTicket.findMany({
      where: { platformUserId: userId },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { id: true, number: true, subject: true, status: true, priority: true, category: true, createdAt: true, updatedAt: true },
    }),
    prisma.supportTicket.groupBy({ by: ['status'], where: { platformUserId: userId }, _count: true }),
    prisma.userSession.findMany({ where: { userId }, orderBy: { lastUsedAt: 'desc' }, take: 10 }),
    prisma.adminNote.count({ where: { subjectUserId: userId, deletedAt: null } }),
  ]);

  const coupon = firstCoupon?.couponId ? await prisma.coupon.findUnique({ where: { id: firstCoupon.couponId }, select: { code: true } }) : null;
  // Which of those devices are still signed in: a live better-auth session
  // that is the customer's own (a support view is never a device).
  const live = await prisma.authSession.findMany({
    where: { id: { in: sessions.map((session) => session.jti) }, expiresAt: { gt: now } },
    select: { id: true, impersonatedBy: true },
  });
  const liveIds = new Set(live.filter((session) => !session.impersonatedBy).map((session) => session.id));
  const viewIds = new Set(live.filter((session) => session.impersonatedBy).map((session) => session.id));
  const devices = sessions
    .filter((session) => !viewIds.has(session.jti))
    .map((session) => ({
      id: session.id,
      deviceLabel: session.deviceLabel,
      ipAddress: session.ipAddress,
      place: placeOfIp(session.ipAddress),
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      signedIn: !session.revokedAt && liveIds.has(session.jti),
    }));

  const limits = planLimits(subscription?.plan.featureLimits);
  const txByWorkspace = new Map(txPerWorkspace.map((row) => [row.businessId, row._count]));
  const walletCount = (subtype: string) => wallets.find((row) => row.accountSubtype === subtype)?._count ?? 0;
  const statusCount = (statuses: readonly string[]) => ticketCounts.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row._count, 0);
  const isPaidPlan = !!subscription && subscription.plan.billingCycle !== BillingCycle.FREE;

  return {
    stats: {
      workspaces: owner.ownedBusinesses.length,
      // The plan's own number of workspaces; null = no limit.
      workspaceLimit: limits.workspaceLimit < 0 ? null : limits.workspaceLimit,
      wallets: wallets.reduce((sum, row) => sum + row._count, 0),
      walletKinds: { cash: walletCount('cash'), bank: walletCount('bank'), mfs: walletCount('mfs'), savings: walletCount('savings') },
      transactionsLast30d: txLast30d,
      referralFriends: referrals.length,
      // Friends who have paid (a commission line, earned or missed).
      referralBought: referrals.filter((referral) => referral._count.commissions > 0).length,
      referralEarned: paisa(ledger.lifetimePaisa),
    },
    // No extra-workspace pricing exists yet, so monthlyFee is null: an
    // extra workspace is shown as "outside the plan" and costs nothing.
    workspaces: workspacesIncluded(owner.ownedBusinesses, limits.workspaceLimit).map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      type: workspace.type,
      isDefault: workspace.isDefault,
      createdAt: workspace.createdAt,
      transactionCount: txByWorkspace.get(workspace.id) ?? 0,
      includedInPlan: workspace.includedInPlan,
      monthlyFee: null as string | null,
    })),
    devices,
    signedInDevices: devices.filter((device) => device.signedIn).length,
    billing: subscription && {
      planName: subscription.plan.name,
      price: money(subscription.lockedPrice ?? subscription.plan.price),
      cycle: subscription.plan.billingCycle,
      status: subscription.status,
      trialEndsAt: subscription.trialEndsAt,
      // The date it renews on, or (cancelling) the date it ends.
      renewsOn: isPaidPlan && !subscription.cancelAtPeriodEnd ? subscription.currentPeriodEnd : null,
      endsOn: isPaidPlan && subscription.cancelAtPeriodEnd ? subscription.currentPeriodEnd : null,
      paidSoFar: money(payments._sum.amount ?? 0),
      paymentCount: payments._count,
      firstCoupon: coupon ? { code: coupon.code, usedAt: firstCoupon!.createdAt } : null,
      extraWorkspaceFee: null as string | null,
    },
    support: {
      open: statusCount(OPEN_TICKET_STATUSES),
      closed: statusCount(['RESOLVED', 'CLOSED']),
      latest: tickets,
    },
    tabCounts: { billing: payments._count, support: statusCount([...OPEN_TICKET_STATUSES, 'RESOLVED', 'CLOSED']), notes: notesCount },
  };
}
