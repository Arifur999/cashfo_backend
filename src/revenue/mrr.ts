import { BillingCycle, PaymentStatus, Prisma, PrismaClient, SubscriptionStatus, UserStatus } from '@prisma/client';
import { END_USER_WHERE } from '../common/roles.js';

// Payments that brought money in: refunds are subtracted separately.
export const REVENUE_STATUSES: PaymentStatus[] = [PaymentStatus.SUCCESS, PaymentStatus.REFUNDED];

// Customers who pay, one row each: a paid plan that is running or in its
// grace days, on a live customer account. A trial is not paid. The
// dashboard's paid users, MRR and churn all count this one set, so they
// can never disagree.
export const PAID_SUBSCRIPTION_WHERE = {
  status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] },
  plan: { billingCycle: { not: BillingCycle.FREE } },
  user: { ...END_USER_WHERE, status: UserStatus.ACTIVE },
} satisfies Prisma.UserSubscriptionWhereInput;

// Monthly recurring revenue: what each paying customer pays for their
// period (the price locked at their last payment, else the plan's list
// price), monthly-normalized (a yearly price / 12). Shared by the Revenue
// page and the admin dashboard.
export async function computeMrr(prisma: Pick<PrismaClient, 'userSubscription'>): Promise<number> {
  const paying = await prisma.userSubscription.findMany({
    where: PAID_SUBSCRIPTION_WHERE,
    select: { lockedPrice: true, plan: { select: { price: true, billingCycle: true } } },
  });
  const mrr = paying.reduce((sum, subscription) => {
    const price = Number(subscription.lockedPrice ?? subscription.plan.price);
    return sum + (subscription.plan.billingCycle === BillingCycle.YEARLY ? price / 12 : price);
  }, 0);
  return Math.round(mrr * 100) / 100;
}
