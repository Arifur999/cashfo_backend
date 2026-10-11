import { BillingCycle, type PrismaClient } from '@prisma/client';

export async function seedSubscriptionPlans(prisma: PrismaClient) {
  const proFeatureLimits = {
    maxWorkspaces: 5,
    maxBusinessWorkspaces: 3,
    maxTransactionsPerMonth: -1,
    advancedReports: true,
    pdfExport: true,
    multiUser: false,
    incomeGoalTracking: true,
  };

  const plans = [
    {
      slug: 'free',
      name: 'Free',
      billingCycle: BillingCycle.FREE,
      price: 0,
      trialDays: 0,
      displayOrder: 0,
      featureLimits: {
        maxWorkspaces: 1,
        maxBusinessWorkspaces: 0,
        maxTransactionsPerMonth: 50,
        advancedReports: false,
        pdfExport: false,
        multiUser: false,
        incomeGoalTracking: false,
      },
    },
    {
      slug: 'monthly-pro',
      name: 'Monthly Pro',
      billingCycle: BillingCycle.MONTHLY,
      price: 299,
      trialDays: 7,
      displayOrder: 1,
      featureLimits: proFeatureLimits,
    },
    {
      slug: 'yearly-pro',
      name: 'Yearly Pro',
      billingCycle: BillingCycle.YEARLY,
      price: 2999,
      trialDays: 14,
      displayOrder: 2,
      featureLimits: proFeatureLimits,
    },
    {
      slug: 'business',
      name: 'Business',
      billingCycle: BillingCycle.MONTHLY,
      price: 799,
      trialDays: 7,
      displayOrder: 3,
      featureLimits: { ...proFeatureLimits, multiUser: true, maxBusinessWorkspaces: -1 },
    },
  ];

  for (const plan of plans) {
    await prisma.subscriptionPlan.upsert({
      where: { slug: plan.slug },
      // Re-running the seed keeps existing plans' fields in sync with this
      // file rather than freezing whatever was there on first insert.
      update: plan,
      create: plan,
    });
  }

  return prisma.subscriptionPlan.findMany();
}
