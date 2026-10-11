import { BillingCycle, type PrismaClient } from '@prisma/client';

// syncExisting: whether plans that already exist are reset to these values.
// The dev seed does (the file is the source of truth there); production does
// not, or every bootstrap run would undo the prices an admin has set.
export async function seedSubscriptionPlans(prisma: PrismaClient, { syncExisting = true } = {}) {
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
      update: syncExisting ? plan : {},
      create: plan,
    });
  }

  return prisma.subscriptionPlan.findMany();
}
