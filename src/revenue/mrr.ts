import { BillingCycle, Prisma, PrismaClient } from '@prisma/client';

// Workspaces that pay: on a paid plan, not deleted, owner not suspended or
// banned. The old PlatformUser table this used to read is a sandbox nothing
// writes to any more -- real plans live on Business.
export const PAYING_WORKSPACE_WHERE = {
  deletedAt: null,
  owner: { status: 'ACTIVE' },
  plan: { billingCycle: { not: BillingCycle.FREE } },
} satisfies Prisma.BusinessWhereInput;

// Monthly recurring revenue: each paying workspace's plan price,
// monthly-normalized (a yearly price / 12). Shared by the Revenue page and
// the admin dashboard so the two never disagree.
export async function computeMrr(prisma: Pick<PrismaClient, 'business'>): Promise<number> {
  const paying = await prisma.business.findMany({
    where: PAYING_WORKSPACE_WHERE,
    select: { plan: { select: { price: true, billingCycle: true } } },
  });
  const mrr = paying.reduce((sum, b) => {
    if (!b.plan) return sum;
    const price = Number(b.plan.price);
    return sum + (b.plan.billingCycle === BillingCycle.YEARLY ? price / 12 : price);
  }, 0);
  return Math.round(mrr * 100) / 100;
}
