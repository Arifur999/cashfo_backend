import 'dotenv/config';
import { faker } from '@faker-js/faker';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  AdminRole,
  BillingCycle,
  CategoryDirection,
  DiscountType,
  ErrorSource,
  FeatureRequestStatus,
  LegalDocType,
  PlatformUserStatus,
  Prisma,
  PrismaClient,
  Severity,
  SuspiciousActivityType,
  TicketCategory,
  TicketPriority,
  TicketStatus,
  WorkspaceType,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function seedAdmins() {
  const superAdminEmail = 'admin@example.com';
  const superAdminPasswordHash = await bcrypt.hash('ChangeMe123!', 10);

  const superAdmin = await prisma.adminUser.upsert({
    where: { email: superAdminEmail },
    update: {},
    create: {
      name: 'Super Admin',
      email: superAdminEmail,
      passwordHash: superAdminPasswordHash,
      role: AdminRole.SUPER_ADMIN,
    },
  });

  // A second seeded account so the "Impersonate is SUPER_ADMIN only" behavior
  // (Prompt 2 completion criteria) can be verified without manually editing
  // the database.
  const supportAdminEmail = 'support@example.com';
  const supportAdminPasswordHash = await bcrypt.hash('ChangeMe123!', 10);

  const supportAdmin = await prisma.adminUser.upsert({
    where: { email: supportAdminEmail },
    update: {},
    create: {
      name: 'Support Admin',
      email: supportAdminEmail,
      passwordHash: supportAdminPasswordHash,
      role: AdminRole.SUPPORT_ADMIN,
    },
  });

  // For Prompt 5's "CONTENT_ADMIN can edit, SUPPORT_ADMIN cannot" completion
  // criterion -- seeded rather than requiring a manual temporary account.
  const contentAdminEmail = 'content@example.com';
  const contentAdminPasswordHash = await bcrypt.hash('ChangeMe123!', 10);

  await prisma.adminUser.upsert({
    where: { email: contentAdminEmail },
    update: {},
    create: {
      name: 'Content Admin',
      email: contentAdminEmail,
      passwordHash: contentAdminPasswordHash,
      role: AdminRole.CONTENT_ADMIN,
    },
  });

  console.warn('\n⚠️  Default admin created — change this password immediately after first login.\n');

  return { superAdminId: superAdmin.id, supportAdminId: supportAdmin.id };
}

// Prompt 8: additional test accounts distinct from seedAdmins()'s originals --
// mainly here because FINANCE_ADMIN never had a seeded account before this
// (Prompt 4's revenue-visibility check had no way to be tested end-to-end),
// plus more accounts for exercising the new Admin Accounts management UI.
async function seedSubAdmins(superAdminId: string) {
  const accounts: { name: string; email: string; role: AdminRole }[] = [
    { name: 'Support Admin 2', email: 'support-admin@example.com', role: AdminRole.SUPPORT_ADMIN },
    { name: 'Finance Admin', email: 'finance-admin@example.com', role: AdminRole.FINANCE_ADMIN },
    { name: 'Content Admin 2', email: 'content-admin@example.com', role: AdminRole.CONTENT_ADMIN },
  ];

  for (const account of accounts) {
    const passwordHash = await bcrypt.hash('ChangeMe123!', 10);
    await prisma.adminUser.upsert({
      where: { email: account.email },
      update: {},
      create: { ...account, passwordHash, createdBy: superAdminId },
    });
  }

  console.warn('\n⚠️  3 sub-admin test accounts created (support-admin@, finance-admin@, content-admin@example.com — password ChangeMe123!) — change immediately after first login.\n');
}

async function seedSubscriptionPlans() {
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

async function seedCoupons() {
  const now = new Date();
  const in90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const coupons = [
    {
      code: 'WELCOME20',
      discountType: DiscountType.PERCENTAGE,
      discountValue: 20,
      maxRedemptions: 500,
      validFrom: now,
      validUntil: in90Days,
      applicablePlans: [] as string[],
    },
    {
      code: 'EID50',
      discountType: DiscountType.FIXED_AMOUNT,
      discountValue: 50,
      maxRedemptions: 200,
      validFrom: now,
      validUntil: in90Days,
      applicablePlans: [] as string[],
    },
  ];

  for (const coupon of coupons) {
    await prisma.coupon.upsert({
      where: { code: coupon.code },
      update: {},
      create: coupon,
    });
  }
}

async function seedPlatformUsers(plans: { id: string }[]) {
  faker.seed(42); // deterministic across reseeds, pairs with upsert-by-email below

  const PLATFORM_USER_COUNT = 18;
  const statusForIndex = (i: number): PlatformUserStatus => {
    if (i < 12) return PlatformUserStatus.ACTIVE;
    if (i < 15) return PlatformUserStatus.SUSPENDED;
    if (i < 17) return PlatformUserStatus.BANNED;
    return PlatformUserStatus.PENDING_DELETION;
  };

  for (let i = 0; i < PLATFORM_USER_COUNT; i++) {
    const status = statusForIndex(i);
    const email = faker.internet.email().toLowerCase();
    const isSuspended = status === PlatformUserStatus.SUSPENDED;
    const plan = faker.helpers.arrayElement([...plans, null]);

    await prisma.platformUser.upsert({
      where: { email },
      update: {},
      create: {
        name: faker.person.fullName(),
        email,
        phone: faker.helpers.maybe(() => faker.phone.number(), { probability: 0.7 }),
        status,
        planId: plan?.id,
        workspaceCount: faker.number.int({ min: 1, max: 6 }),
        signupSource: faker.helpers.arrayElement(['web', 'referral', 'app_store', 'play_store']),
        lastLoginAt: faker.date.recent({ days: 30 }),
        suspendedAt: isSuspended ? faker.date.recent({ days: 10 }) : null,
        suspendedReason: isSuspended ? faker.helpers.arrayElement(['Payment dispute', 'Suspicious activity', 'ToS violation under review']) : null,
        createdAt: faker.date.past({ years: 1 }),
      },
    });
  }
}

async function seedPayments(plans: { id: string; name: string; price: unknown; currency: string; billingCycle: BillingCycle }[], adminId: string) {
  // No natural business key to upsert payments on -- skip entirely on
  // reseed rather than growing the table indefinitely.
  const existingCount = await prisma.payment.count();
  if (existingCount > 0) {
    console.log(`Skipping payment seed -- ${existingCount} payments already exist.`);
    return;
  }

  const users = await prisma.platformUser.findMany();
  const paidPlans = plans.filter((p) => p.billingCycle !== BillingCycle.FREE);
  if (users.length === 0 || paidPlans.length === 0) return;

  faker.seed(43);
  const GATEWAYS = ['BKASH', 'NAGAD', 'SSLCOMMERZ', 'CARD', 'MANUAL'] as const;
  const PAYMENT_COUNT = 35;
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const year = new Date().getFullYear();
  let invoiceSeq = 1;
  const refundCandidateIds: string[] = [];

  for (let i = 0; i < PAYMENT_COUNT; i++) {
    const user = faker.helpers.arrayElement(users);
    const plan = faker.helpers.arrayElement(paidPlans);
    const createdAt = faker.date.between({ from: sixMonthsAgo, to: new Date() });
    const roll = faker.number.int({ min: 1, max: 100 });

    // First 3 are forced REFUNDED so the "2-3 Refund rows" seed requirement
    // is guaranteed rather than left to chance; the rest follow a realistic
    // mostly-success distribution.
    const status = i < 3 ? 'REFUNDED' : roll <= 75 ? 'SUCCESS' : roll <= 92 ? 'FAILED' : 'REFUNDED';

    const payment = await prisma.payment.create({
      data: {
        platformUserId: user.id,
        planId: plan.id,
        amount: plan.price as never,
        currency: plan.currency,
        gateway: faker.helpers.arrayElement(GATEWAYS),
        gatewayReferenceId: status === 'FAILED' ? null : `TXN-${faker.string.alphanumeric(10).toUpperCase()}`,
        status,
        failureReason:
          status === 'FAILED'
            ? faker.helpers.arrayElement(['Insufficient balance', 'Card declined', 'Gateway timeout', 'User cancelled'])
            : null,
        paidAt: status !== 'FAILED' ? createdAt : null,
        createdAt,
      },
    });

    if (status === 'SUCCESS' || status === 'REFUNDED') {
      await prisma.invoice.create({
        data: {
          paymentId: payment.id,
          invoiceNumber: `INV-${year}-${String(invoiceSeq++).padStart(6, '0')}`,
          issuedTo: `${user.name} <${user.email}>`,
          lineItems: [{ description: `${plan.name} subscription`, amount: Number(plan.price) }],
          totalAmount: plan.price as never,
          createdAt,
        },
      });
    }

    if (status === 'REFUNDED') {
      refundCandidateIds.push(payment.id);
    }
  }

  for (const paymentId of refundCandidateIds.slice(0, 3)) {
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    await prisma.refund.create({
      data: {
        paymentId,
        amount: payment.amount,
        reason: faker.helpers.arrayElement(['Customer requested cancellation', 'Duplicate charge', 'Service issue']),
        processedBy: adminId,
        status: 'COMPLETED',
        createdAt: new Date(payment.createdAt.getTime() + 2 * 24 * 60 * 60 * 1000),
      },
    });
  }
}

async function seedAccountTemplatesAndCategories() {
  if ((await prisma.defaultAccountTemplate.count()) > 0) {
    console.log('Skipping account template seed -- rows already exist.');
    return;
  }

  const BOTH: WorkspaceType[] = [WorkspaceType.PERSONAL, WorkspaceType.BUSINESS];

  const cash = await prisma.defaultAccountTemplate.create({
    data: { name: 'Cash', nameBn: 'নগদ', accountType: 'ASSET', accountSubtype: 'cash', appliesTo: BOTH, displayOrder: 0 },
  });
  const bank = await prisma.defaultAccountTemplate.create({
    data: { name: 'Bank', nameBn: 'ব্যাংক', accountType: 'ASSET', accountSubtype: 'bank', appliesTo: BOTH, displayOrder: 1 },
  });
  // Nested under Bank -- demonstrates real parent/child nesting, not just a
  // flat list grouped by accountType.
  await prisma.defaultAccountTemplate.create({
    data: {
      name: 'bKash',
      nameBn: 'বিকাশ',
      accountType: 'ASSET',
      accountSubtype: 'mfs',
      parentId: bank.id,
      appliesTo: BOTH,
      displayOrder: 0,
    },
  });
  const receivable = await prisma.defaultAccountTemplate.create({
    data: {
      name: 'Accounts Receivable',
      nameBn: 'প্রাপ্য হিসাব',
      accountType: 'ASSET',
      accountSubtype: 'receivable',
      appliesTo: BOTH,
      displayOrder: 2,
    },
  });

  await prisma.defaultAccountTemplate.create({
    data: { name: 'Accounts Payable', nameBn: 'দেয় হিসাব', accountType: 'LIABILITY', accountSubtype: 'payable', appliesTo: BOTH, displayOrder: 0 },
  });
  await prisma.defaultAccountTemplate.create({
    data: { name: 'Loan Payable', nameBn: 'ঋণ দেনা', accountType: 'LIABILITY', appliesTo: BOTH, displayOrder: 1 },
  });

  await prisma.defaultAccountTemplate.create({
    data: { name: "Owner's Capital", nameBn: 'মালিকের মূলধন', accountType: 'EQUITY', appliesTo: [WorkspaceType.BUSINESS], displayOrder: 0 },
  });
  await prisma.defaultAccountTemplate.create({
    data: { name: "Owner's Drawing", nameBn: 'মালিকের উত্তোলন', accountType: 'EQUITY', appliesTo: [WorkspaceType.BUSINESS], displayOrder: 1 },
  });

  const salesIncome = await prisma.defaultAccountTemplate.create({
    data: { name: 'Sales Income', nameBn: 'বিক্রয় আয়', accountType: 'INCOME', appliesTo: [WorkspaceType.BUSINESS], displayOrder: 0 },
  });
  const salaryIncome = await prisma.defaultAccountTemplate.create({
    data: { name: 'Salary Income', nameBn: 'বেতন আয়', accountType: 'INCOME', appliesTo: [WorkspaceType.PERSONAL], displayOrder: 1 },
  });
  const freelanceIncome = await prisma.defaultAccountTemplate.create({
    data: { name: 'Freelance Income', nameBn: 'ফ্রিল্যান্স আয়', accountType: 'INCOME', appliesTo: [WorkspaceType.PERSONAL], displayOrder: 2 },
  });

  const rentExpense = await prisma.defaultAccountTemplate.create({
    data: { name: 'Rent Expense', nameBn: 'ভাড়া খরচ', accountType: 'EXPENSE', appliesTo: BOTH, displayOrder: 0 },
  });
  const utilityExpense = await prisma.defaultAccountTemplate.create({
    data: { name: 'Utility Expense', nameBn: 'ইউটিলিটি খরচ', accountType: 'EXPENSE', appliesTo: BOTH, displayOrder: 1 },
  });
  await prisma.defaultAccountTemplate.create({
    data: { name: 'Salary Expense', nameBn: 'বেতন খরচ', accountType: 'EXPENSE', appliesTo: [WorkspaceType.BUSINESS], displayOrder: 2 },
  });
  await prisma.defaultAccountTemplate.create({
    data: { name: 'Interest Expense', nameBn: 'সুদ খরচ', accountType: 'EXPENSE', appliesTo: BOTH, displayOrder: 3 },
  });
  const foodExpense = await prisma.defaultAccountTemplate.create({
    data: { name: 'Food & Dining Expense', nameBn: 'খাদ্য ও খাওয়া খরচ', accountType: 'EXPENSE', appliesTo: [WorkspaceType.PERSONAL], displayOrder: 4 },
  });
  const transportExpense = await prisma.defaultAccountTemplate.create({
    data: { name: 'Transportation Expense', nameBn: 'যাতায়াত খরচ', accountType: 'EXPENSE', appliesTo: [WorkspaceType.PERSONAL], displayOrder: 5 },
  });

  const categories: {
    name: string;
    nameBn: string;
    type: CategoryDirection;
    icon: string;
    linkedAccountTemplateId?: string;
  }[] = [
    { name: 'Food', nameBn: 'খাবার', type: 'EXPENSE', icon: 'utensils', linkedAccountTemplateId: foodExpense.id },
    { name: 'Transport', nameBn: 'যাতায়াত', type: 'EXPENSE', icon: 'car', linkedAccountTemplateId: transportExpense.id },
    { name: 'Rent', nameBn: 'ভাড়া', type: 'EXPENSE', icon: 'home', linkedAccountTemplateId: rentExpense.id },
    { name: 'Utility Bill', nameBn: 'ইউটিলিটি বিল', type: 'EXPENSE', icon: 'zap', linkedAccountTemplateId: utilityExpense.id },
    { name: 'Loan Repayment', nameBn: 'ঋণ পরিশোধ', type: 'EXPENSE', icon: 'credit-card' },
    { name: 'Shopping', nameBn: 'কেনাকাটা', type: 'EXPENSE', icon: 'shopping-cart' },
    { name: 'Entertainment', nameBn: 'বিনোদন', type: 'EXPENSE', icon: 'film' },
    { name: 'Salary', nameBn: 'বেতন', type: 'INCOME', icon: 'briefcase', linkedAccountTemplateId: salaryIncome.id },
    { name: 'Freelance Income', nameBn: 'ফ্রিল্যান্স আয়', type: 'INCOME', icon: 'laptop', linkedAccountTemplateId: freelanceIncome.id },
    { name: 'Sales', nameBn: 'বিক্রয়', type: 'INCOME', icon: 'shopping-bag', linkedAccountTemplateId: salesIncome.id },
  ];

  for (let i = 0; i < categories.length; i++) {
    await prisma.defaultCategory.create({ data: { ...categories[i], displayOrder: i } });
  }

  // Referenced above so TS doesn't flag them as unused if the list changes later.
  void receivable;
}

async function seedTranslations() {
  const rows: { key: string; en: string; bn: string; context: string }[] = [
    { key: 'dashboard.total_income', en: 'Total Income', bn: 'মোট আয়', context: 'dashboard' },
    { key: 'dashboard.total_expense', en: 'Total Expense', bn: 'মোট খরচ', context: 'dashboard' },
    { key: 'dashboard.net_balance', en: 'Net Balance', bn: 'নিট ব্যালেন্স', context: 'dashboard' },
    { key: 'dashboard.recent_transactions', en: 'Recent Transactions', bn: 'সাম্প্রতিক লেনদেন', context: 'dashboard' },
    { key: 'dashboard.welcome_message', en: 'Welcome back!', bn: 'আবার স্বাগতম!', context: 'dashboard' },
    { key: 'auth.login_title', en: 'Sign In', bn: 'সাইন ইন', context: 'auth' },
    { key: 'auth.login_button', en: 'Log In', bn: 'লগ ইন', context: 'auth' },
    { key: 'auth.logout', en: 'Log Out', bn: 'লগ আউট', context: 'auth' },
    { key: 'auth.forgot_password', en: 'Forgot Password?', bn: 'পাসওয়ার্ড ভুলে গেছেন?', context: 'auth' },
    { key: 'auth.email_label', en: 'Email', bn: 'ইমেইল', context: 'auth' },
    { key: 'auth.password_label', en: 'Password', bn: 'পাসওয়ার্ড', context: 'auth' },
    { key: 'common.save', en: 'Save', bn: 'সংরক্ষণ করুন', context: 'common' },
    { key: 'common.cancel', en: 'Cancel', bn: 'বাতিল করুন', context: 'common' },
    { key: 'common.delete', en: 'Delete', bn: 'মুছুন', context: 'common' },
    { key: 'common.edit', en: 'Edit', bn: 'সম্পাদনা করুন', context: 'common' },
    { key: 'common.search', en: 'Search', bn: 'খুঁজুন', context: 'common' },
    { key: 'common.loading', en: 'Loading...', bn: 'লোড হচ্ছে...', context: 'common' },
    { key: 'common.success', en: 'Success', bn: 'সফল হয়েছে', context: 'common' },
    { key: 'common.error', en: 'Something went wrong', bn: 'কিছু ভুল হয়েছে', context: 'common' },
    { key: 'reports.title', en: 'Reports', bn: 'প্রতিবেদন', context: 'reports' },
    { key: 'reports.export', en: 'Export', bn: 'এক্সপোর্ট', context: 'reports' },
  ];

  for (const row of rows) {
    await prisma.translationString.upsert({ where: { key: row.key }, update: {}, create: row });
  }
}

async function seedAnnouncements(adminId: string) {
  if ((await prisma.announcement.count()) > 0) {
    console.log('Skipping announcement seed -- rows already exist.');
    return;
  }

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  await prisma.announcement.create({
    data: {
      title: 'Welcome to our platform!',
      titleBn: 'আমাদের প্ল্যাটফর্মে স্বাগতম!',
      body: "We're glad to have you here. Explore your dashboard to get started.",
      bodyBn: 'আপনাকে পেয়ে আমরা আনন্দিত। শুরু করতে আপনার ড্যাশবোর্ড দেখুন।',
      type: 'INFO',
      startAt: new Date(now - 5 * DAY),
      createdBy: adminId,
    },
  });

  // Deliberately in the future -- seeded so the ACTIVE vs SCHEDULED date
  // logic (Prompt 5 completion criteria) is visible immediately without
  // needing to create test data by hand.
  await prisma.announcement.create({
    data: {
      title: 'Upcoming Eid Sale!',
      titleBn: 'আসন্ন ঈদ সেল!',
      body: 'Get ready for exclusive discounts on all Pro plans.',
      bodyBn: 'সব প্রো প্ল্যানে বিশেষ ছাড়ের জন্য প্রস্তুত থাকুন।',
      type: 'PROMOTION',
      startAt: new Date(now + 10 * DAY),
      endAt: new Date(now + 20 * DAY),
      createdBy: adminId,
    },
  });

  // Deliberately already ended -- same reasoning, covers the EXPIRED case.
  await prisma.announcement.create({
    data: {
      title: 'Completed scheduled maintenance',
      titleBn: 'নির্ধারিত রক্ষণাবেক্ষণ সম্পন্ন হয়েছে',
      body: 'Maintenance finished ahead of schedule with no downtime.',
      bodyBn: 'নির্ধারিত সময়ের আগেই কোনো ডাউনটাইম ছাড়াই রক্ষণাবেক্ষণ সম্পন্ন হয়েছে।',
      type: 'MAINTENANCE',
      startAt: new Date(now - 30 * DAY),
      endAt: new Date(now - 5 * DAY),
      createdBy: adminId,
    },
  });
}

async function seedLegalDocuments(adminId: string) {
  const placeholder =
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit. This is placeholder content -- replace with real legal text before launch.';

  const docs: { type: LegalDocType; contentEn: string }[] = [
    { type: 'TERMS_OF_SERVICE', contentEn: `Terms of Service\n\n${placeholder}` },
    { type: 'PRIVACY_POLICY', contentEn: `Privacy Policy\n\n${placeholder}` },
    { type: 'REFUND_POLICY', contentEn: `Refund Policy\n\n${placeholder}` },
    { type: 'FAQ', contentEn: `Frequently Asked Questions\n\n${placeholder}` },
  ];

  for (const doc of docs) {
    await prisma.legalDocument.upsert({
      where: { type: doc.type },
      update: {},
      create: { type: doc.type, contentEn: doc.contentEn, updatedBy: adminId },
    });
  }
}

async function seedTickets(superAdminId: string, supportAdminId: string) {
  if ((await prisma.supportTicket.count()) > 0) {
    console.log('Skipping ticket seed -- rows already exist.');
    return;
  }

  const users = await prisma.platformUser.findMany();
  if (users.length === 0) return;

  faker.seed(44);
  const CATEGORIES: TicketCategory[] = ['BILLING', 'TECHNICAL', 'ACCOUNT', 'FEATURE_REQUEST', 'BUG_REPORT', 'OTHER'];
  const PRIORITIES: TicketPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
  // Weighted so most tickets land in a realistic mid-lifecycle spread rather
  // than uniformly across all 5 statuses.
  const STATUS_POOL: TicketStatus[] = ['OPEN', 'OPEN', 'IN_PROGRESS', 'IN_PROGRESS', 'WAITING_ON_USER', 'RESOLVED', 'RESOLVED', 'CLOSED'];
  const SAMPLE_SUBJECTS = [
    'Cannot log in to my account',
    'Payment failed but I was charged',
    'How do I export my transactions?',
    'App crashes when adding an expense',
    'Requesting refund for accidental upgrade',
    'Bangla text not displaying correctly',
    'Feature request: recurring transactions',
    'My workspace data disappeared',
    'Unable to change my email address',
    'Business plan features not unlocked',
    'Duplicate transactions showing up',
    'Dark mode request',
    'Report export is missing categories',
    'Invoice PDF not downloading',
    'Suspicious login attempt notification',
    'Coupon code not applying at checkout',
    'App is very slow on my phone',
    'How to add a team member?',
  ];

  const TICKET_COUNT = 18;

  for (let i = 0; i < TICKET_COUNT; i++) {
    const user = faker.helpers.arrayElement(users);
    const status = STATUS_POOL[i % STATUS_POOL.length];
    const createdAt = faker.date.recent({ days: 60 });
    const isAssigned = status !== 'OPEN' || faker.datatype.boolean();
    const isResolved = status === 'RESOLVED' || status === 'CLOSED';

    const ticket = await prisma.supportTicket.create({
      data: {
        platformUserId: user.id,
        subject: SAMPLE_SUBJECTS[i % SAMPLE_SUBJECTS.length],
        category: faker.helpers.arrayElement(CATEGORIES),
        priority: faker.helpers.arrayElement(PRIORITIES),
        status,
        assignedToAdminId: isAssigned ? faker.helpers.arrayElement([superAdminId, supportAdminId]) : null,
        createdAt,
        resolvedAt: isResolved ? faker.date.soon({ days: 3, refDate: createdAt }) : null,
      },
    });

    // 2-4 alternating messages, starting with the user's own report.
    const messageCount = faker.number.int({ min: 2, max: 4 });
    let messageTime = createdAt;
    for (let m = 0; m < messageCount; m++) {
      const isUserTurn = m % 2 === 0;
      messageTime = new Date(messageTime.getTime() + faker.number.int({ min: 10, max: 600 }) * 60 * 1000);
      await prisma.ticketMessage.create({
        data: {
          ticketId: ticket.id,
          senderType: isUserTurn ? 'USER' : 'ADMIN',
          senderId: isUserTurn ? user.id : (ticket.assignedToAdminId ?? supportAdminId),
          message: isUserTurn
            ? faker.helpers.arrayElement([
                "Here's some more detail on the issue I'm facing.",
                'This is still happening, any update?',
                'Thanks for looking into this.',
                ticket.subject,
              ])
            : faker.helpers.arrayElement([
                "Thanks for reaching out -- we're looking into this now.",
                'Could you share a screenshot or more details?',
                'This should be fixed now, please let us know if it persists.',
                "We've escalated this to our team.",
              ]),
          createdAt: messageTime,
        },
      });
    }
  }
}

async function seedFeatureRequests() {
  if ((await prisma.featureRequest.count()) > 0) {
    console.log('Skipping feature request seed -- rows already exist.');
    return;
  }

  const users = await prisma.platformUser.findMany();
  if (users.length === 0) return;

  faker.seed(45);
  const REQUESTS: { title: string; description: string; status: FeatureRequestStatus; voteCount: number }[] = [
    { title: 'Recurring transactions', description: 'Let me set up transactions that repeat monthly, like rent or subscriptions.', status: 'PLANNED', voteCount: 142 },
    { title: 'Dark mode', description: 'A dark theme option for the mobile app.', status: 'IN_PROGRESS', voteCount: 98 },
    { title: 'Multi-currency support', description: 'Track expenses in USD alongside BDT for freelance income.', status: 'UNDER_REVIEW', voteCount: 76 },
    { title: 'Bank statement import (CSV)', description: 'Import transactions directly from a bank-exported CSV file.', status: 'UNDER_REVIEW', voteCount: 61 },
    { title: 'Budget alerts', description: 'Push notification when I am close to a category budget limit.', status: 'SUBMITTED', voteCount: 44 },
    { title: 'Widget for home screen', description: 'A quick-add-expense widget for the phone home screen.', status: 'SUBMITTED', voteCount: 33 },
    { title: 'Shared family workspace', description: 'Let multiple family members log expenses into one shared personal workspace.', status: 'SUBMITTED', voteCount: 27 },
    { title: 'Voice-based expense entry', description: 'Add an expense by speaking instead of typing.', status: 'DECLINED', voteCount: 12 },
    { title: 'Yearly comparison reports', description: 'Compare this year vs last year spending by category.', status: 'SHIPPED', voteCount: 88 },
  ];

  for (const request of REQUESTS) {
    const user = faker.helpers.arrayElement(users);
    await prisma.featureRequest.create({
      data: {
        platformUserId: user.id,
        title: request.title,
        description: request.description,
        status: request.status,
        voteCount: request.voteCount,
        createdAt: faker.date.past({ years: 1 }),
      },
    });
  }
}

async function seedUsageEvents(users: { id: string }[]) {
  // No natural business key -- skip entirely on reseed rather than growing
  // the table indefinitely (same reasoning as seedPayments/seedTickets).
  if ((await prisma.usageEvent.count()) > 0) {
    console.log('Skipping usage event seed -- rows already exist.');
    return;
  }
  if (users.length === 0) return;

  faker.seed(46);

  // Weighted so expense/income logging dominates, login is frequent, and
  // reports/budgets are less common -- a realistic feature-usage shape.
  const EVENT_TYPES: { value: string; weight: number }[] = [
    { value: 'expense_added', weight: 30 },
    { value: 'income_added', weight: 25 },
    { value: 'login', weight: 20 },
    { value: 'report_viewed', weight: 10 },
    { value: 'budget_created', weight: 8 },
    { value: 'workspace_created', weight: 4 },
    { value: 'account_created', weight: 3 },
  ];

  // Mobile-first, reflecting a Bangladesh-focused product.
  const DEVICE_TYPES: { value: 'MOBILE' | 'DESKTOP' | 'TABLET'; weight: number }[] = [
    { value: 'MOBILE', weight: 65 },
    { value: 'DESKTOP', weight: 30 },
    { value: 'TABLET', weight: 5 },
  ];

  // Mostly domestic with a small diaspora tail rather than 100% Bangladesh --
  // more realistic without diluting the "Dhaka is the top city" signal.
  const COUNTRIES: { value: string; weight: number }[] = [
    { value: 'Bangladesh', weight: 90 },
    { value: 'United States', weight: 4 },
    { value: 'United Kingdom', weight: 2 },
    { value: 'Malaysia', weight: 2 },
    { value: 'Saudi Arabia', weight: 2 },
  ];

  const CITIES: { value: string; weight: number }[] = [
    { value: 'Dhaka', weight: 40 },
    { value: 'Chattogram', weight: 20 },
    { value: 'Sylhet', weight: 10 },
    { value: 'Khulna', weight: 8 },
    { value: 'Rajshahi', weight: 8 },
    { value: 'Barishal', weight: 6 },
    { value: 'Rangpur', weight: 5 },
    { value: 'Mymensingh', weight: 3 },
  ];

  const REPORT_TYPES = ['profit_loss', 'cash_flow', 'category_breakdown', 'monthly_summary'];

  // Each user gets one fixed "home" location rather than a fresh random
  // country/city per event -- otherwise, with only a couple dozen users each
  // generating hundreds of events, nearly every user would end up touching
  // nearly every city, and "top city by user count" would saturate instead
  // of reflecting the weighting.
  const userLocations = new Map<string, { country: string; city: string | null }>();
  for (const user of users) {
    const country = faker.helpers.weightedArrayElement(COUNTRIES);
    userLocations.set(user.id, {
      country,
      city: country === 'Bangladesh' ? faker.helpers.weightedArrayElement(CITIES) : null,
    });
  }

  const EVENT_COUNT = 2500;
  const events: Prisma.UsageEventCreateManyInput[] = [];

  for (let i = 0; i < EVENT_COUNT; i++) {
    const user = faker.helpers.arrayElement(users);
    const location = userLocations.get(user.id)!;
    const eventType = faker.helpers.weightedArrayElement(EVENT_TYPES);

    events.push({
      platformUserId: user.id,
      eventType,
      metadata: eventType === 'report_viewed' ? { reportType: faker.helpers.arrayElement(REPORT_TYPES) } : undefined,
      deviceType: faker.helpers.weightedArrayElement(DEVICE_TYPES),
      country: location.country,
      city: location.city,
      createdAt: faker.date.recent({ days: 90 }),
    });
  }

  await prisma.usageEvent.createMany({ data: events });
}

async function seedDailyActiveSnapshots() {
  if ((await prisma.dailyActiveSnapshot.count()) > 0) {
    console.log('Skipping daily active snapshot seed -- rows already exist.');
    return;
  }

  faker.seed(47);
  const DAYS = 90;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // A handful of "marketing campaign" days get an outsized signup spike.
  const campaignDays = new Set<number>();
  while (campaignDays.size < 4) {
    campaignDays.add(faker.number.int({ min: 5, max: DAYS - 5 }));
  }

  let totalUsers = 40;
  const snapshots: Prisma.DailyActiveSnapshotCreateManyInput[] = [];

  for (let i = DAYS - 1; i >= 0; i--) {
    const date = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    const dayIndex = DAYS - 1 - i; // 0 = oldest day in the window

    const baseSignups = faker.number.int({ min: 0, max: 3 });
    const newSignups = campaignDays.has(dayIndex) ? baseSignups + faker.number.int({ min: 8, max: 15 }) : baseSignups;
    totalUsers += newSignups;

    // Engagement ratio drifts gently upward (~15% -> ~30% of the user base)
    // plus small day-to-day noise, capped so dailyActive never exceeds totalUsers.
    const growthFactor = 0.15 + (dayIndex / DAYS) * 0.15;
    const noise = faker.number.float({ min: -0.03, max: 0.03 });
    const dailyActive = Math.max(1, Math.min(totalUsers, Math.round(totalUsers * (growthFactor + noise))));

    snapshots.push({ date, dailyActive, newSignups, totalUsers });
  }

  await prisma.dailyActiveSnapshot.createMany({ data: snapshots });
}

async function seedLoginAttempts() {
  if ((await prisma.loginAttempt.count()) > 0) {
    console.log('Skipping login attempt seed -- rows already exist.');
    return;
  }

  faker.seed(48);
  const admins = await prisma.adminUser.findMany({ select: { email: true } });
  const emails = admins.map((a) => a.email);
  if (emails.length === 0) return;

  const attempts: Prisma.LoginAttemptCreateManyInput[] = [];

  // General background traffic: mostly successful, spread over the last 30
  // days, from varied IPs -- the realistic baseline the Login Monitoring
  // table needs to not look empty/artificial.
  for (let i = 0; i < 40; i++) {
    const success = faker.number.int({ min: 1, max: 100 }) <= 90;
    attempts.push({
      email: faker.helpers.arrayElement(emails),
      ipAddress: faker.internet.ipv4(),
      userAgent: faker.internet.userAgent(),
      success,
      failureReason: success ? null : faker.helpers.arrayElement(['invalid_password', 'account_suspended']),
      createdAt: faker.date.recent({ days: 30 }),
    });
  }

  // Older cluster (3 days ago) -- already has a matching, reviewed
  // SuspiciousActivityFlag seeded in seedSuspiciousActivityFlags(), showing
  // what a resolved historical incident looks like.
  const oldClusterIp = '198.51.100.23';
  const oldClusterBase = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  for (let i = 0; i < 6; i++) {
    attempts.push({
      email: 'admin@example.com',
      ipAddress: oldClusterIp,
      userAgent: faker.internet.userAgent(),
      success: false,
      failureReason: 'invalid_password',
      createdAt: new Date(oldClusterBase.getTime() + i * 90 * 1000),
    });
  }

  // Fresh cluster, timestamped relative to "now" rather than a fixed date --
  // deliberately left un-flagged so POST /admin/security/flags/run-detection
  // has a live pattern to catch (5+ failures/IP within 15 min) whenever this
  // seed is run, not just at the moment the seed script happened to execute.
  const freshClusterIp = '203.0.113.77';
  const now = Date.now();
  for (let i = 0; i < 7; i++) {
    attempts.push({
      email: 'admin@example.com',
      ipAddress: freshClusterIp,
      userAgent: faker.internet.userAgent(),
      success: false,
      failureReason: 'invalid_password',
      createdAt: new Date(now - (7 - i) * 60 * 1000),
    });
  }

  await prisma.loginAttempt.createMany({ data: attempts });
}

async function seedSuspiciousActivityFlags(superAdminId: string, supportAdminId: string) {
  if ((await prisma.suspiciousActivityFlag.count()) > 0) {
    console.log('Skipping suspicious activity flag seed -- rows already exist.');
    return;
  }

  faker.seed(49);
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

  await prisma.suspiciousActivityFlag.create({
    data: {
      type: SuspiciousActivityType.MULTIPLE_FAILED_LOGINS,
      description: '6 failed login attempts from 198.51.100.23 within 15 minutes.',
      relatedIp: '198.51.100.23',
      severity: Severity.HIGH,
      status: 'RESOLVED',
      reviewedBy: superAdminId,
      reviewedAt: new Date(threeDaysAgo.getTime() + 60 * 60 * 1000),
      createdAt: threeDaysAgo,
    },
  });

  await prisma.suspiciousActivityFlag.create({
    data: {
      type: SuspiciousActivityType.UNUSUAL_LOGIN_LOCATION,
      description: 'Admin login from an unrecognized country -- possible VPN or new device.',
      relatedAdminId: superAdminId,
      severity: Severity.MEDIUM,
      status: 'OPEN',
      createdAt: faker.date.recent({ days: 10 }),
    },
  });

  await prisma.suspiciousActivityFlag.create({
    data: {
      type: SuspiciousActivityType.IMPERSONATION_SPIKE,
      description: 'Support admin impersonated 4 different users within one hour.',
      relatedAdminId: supportAdminId,
      severity: Severity.LOW,
      status: 'REVIEWING',
      createdAt: faker.date.recent({ days: 5 }),
    },
  });

  await prisma.suspiciousActivityFlag.create({
    data: {
      type: SuspiciousActivityType.OTHER,
      description: 'Unusually high volume of export requests from a single account.',
      severity: Severity.CRITICAL,
      status: 'FALSE_POSITIVE',
      reviewedBy: superAdminId,
      reviewedAt: faker.date.recent({ days: 2 }),
      createdAt: faker.date.recent({ days: 15 }),
    },
  });
}

async function seedBackupRecords(superAdminId: string) {
  if ((await prisma.backupRecord.count()) > 0) {
    console.log('Skipping backup record seed -- rows already exist.');
    return;
  }

  faker.seed(50);
  const DAYS = 30;
  const RECORD_COUNT = 11;
  // Two arbitrary indices (not the very first/last) get a simulated failure.
  const failedIndexes = new Set([3, 7]);
  const manualIndexes = new Set([5, RECORD_COUNT - 1]);

  const records: Prisma.BackupRecordCreateManyInput[] = [];

  for (let i = 0; i < RECORD_COUNT; i++) {
    // Oldest first, roughly evenly spaced across the last 30 days.
    const daysAgo = DAYS - Math.round((i / (RECORD_COUNT - 1)) * DAYS);
    const startedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    const isFailed = failedIndexes.has(i);
    const isManual = manualIndexes.has(i);
    const sizeMb = Math.round((120 + i * 5 + faker.number.float({ min: -3, max: 3 })) * 10) / 10;

    records.push({
      triggeredBy: isManual ? superAdminId : 'SYSTEM',
      type: isManual ? 'MANUAL' : 'SCHEDULED',
      status: isFailed ? 'FAILED' : 'SUCCESS',
      sizeMb: isFailed ? null : sizeMb,
      fileLocation: isFailed ? null : `s3://backups/db-${startedAt.toISOString().slice(0, 10)}.sql.gz`,
      errorMessage: isFailed ? 'Connection timeout to storage bucket' : null,
      startedAt,
      completedAt: new Date(startedAt.getTime() + faker.number.int({ min: 3, max: 12 }) * 60 * 1000),
    });
  }

  await prisma.backupRecord.createMany({ data: records });
}

async function seedFeatureFlags(superAdminId: string) {
  const flags: { key: string; name: string; description: string; isEnabled: boolean; rolloutPercent: number }[] = [
    { key: 'recurring_transactions', name: 'Recurring Transactions', description: 'Let users schedule transactions that repeat automatically.', isEnabled: true, rolloutPercent: 100 },
    { key: 'loan_management', name: 'Loan Management', description: 'Track loans given or taken with repayment schedules.', isEnabled: false, rolloutPercent: 0 },
    { key: 'pdf_export', name: 'PDF Export', description: 'Export reports as a PDF (Pro plans only).', isEnabled: true, rolloutPercent: 100 },
    { key: 'multi_currency_beta', name: 'Multi-Currency (Beta)', description: 'Track balances in multiple currencies alongside BDT.', isEnabled: true, rolloutPercent: 25 },
    { key: 'ai_auto_categorization', name: 'AI Auto-Categorization', description: 'Automatically categorize transactions using AI.', isEnabled: true, rolloutPercent: 50 },
    { key: 'shared_workspaces', name: 'Shared Family Workspace', description: 'Multiple family members logging into one shared personal workspace.', isEnabled: false, rolloutPercent: 0 },
    { key: 'dark_mode', name: 'Dark Mode', description: 'A dark theme option for the mobile app.', isEnabled: true, rolloutPercent: 100 },
    { key: 'bank_statement_import', name: 'Bank Statement Import (CSV)', description: 'Import transactions directly from a bank-exported CSV file.', isEnabled: false, rolloutPercent: 10 },
    { key: 'voice_expense_entry', name: 'Voice-Based Expense Entry', description: 'Add an expense by speaking instead of typing.', isEnabled: false, rolloutPercent: 0 },
  ];

  // upsert (not skip-if-any-exist) so re-running the seed keeps flag
  // metadata in sync with this file, same reasoning as seedSubscriptionPlans.
  for (const flag of flags) {
    await prisma.featureFlag.upsert({
      where: { key: flag.key },
      update: {},
      create: { ...flag, updatedBy: superAdminId },
    });
  }
}

async function seedErrorLogs(superAdminId: string) {
  if ((await prisma.errorLog.count()) > 0) {
    console.log('Skipping error log seed -- rows already exist.');
    return;
  }

  faker.seed(51);
  const SAMPLE_ERRORS: { message: string; source: ErrorSource; severity: Severity }[] = [
    { message: 'Unhandled promise rejection in payment webhook handler', source: 'BACKEND_API', severity: 'HIGH' },
    { message: "TypeError: Cannot read properties of undefined (reading 'id')", source: 'ADMIN_FRONTEND', severity: 'MEDIUM' },
    { message: 'Database connection pool exhausted', source: 'BACKEND_API', severity: 'CRITICAL' },
    { message: 'Scheduled report generation job timed out', source: 'BACKGROUND_JOB', severity: 'MEDIUM' },
    { message: 'Failed to parse coupon validation response', source: 'BACKEND_API', severity: 'LOW' },
    { message: 'React hydration mismatch on /admin/payments', source: 'ADMIN_FRONTEND', severity: 'LOW' },
    { message: 'Email delivery failed: SMTP connection refused', source: 'BACKGROUND_JOB', severity: 'HIGH' },
    { message: 'Rate limiter Redis connection dropped', source: 'BACKEND_API', severity: 'CRITICAL' },
    { message: 'Unexpected null in invoice PDF template', source: 'BACKEND_API', severity: 'MEDIUM' },
    { message: 'Chunk load error on dashboard bundle', source: 'ADMIN_FRONTEND', severity: 'LOW' },
  ];

  const ERROR_COUNT = 18;
  for (let i = 0; i < ERROR_COUNT; i++) {
    const sample = faker.helpers.arrayElement(SAMPLE_ERRORS);
    const createdAt = faker.date.recent({ days: 14 });
    const isResolved = faker.number.int({ min: 1, max: 100 }) <= 75;

    await prisma.errorLog.create({
      data: {
        source: sample.source,
        message: sample.message,
        stackTrace: `Error: ${sample.message}\n    at process (${sample.source.toLowerCase()}.ts:${faker.number.int({ min: 10, max: 400 })}:${faker.number.int({ min: 1, max: 80 })})\n    at handler (index.ts:12:5)`,
        severity: sample.severity,
        resolved: isResolved,
        resolvedBy: isResolved ? superAdminId : null,
        resolvedAt: isResolved ? faker.date.soon({ days: 1, refDate: createdAt }) : null,
        createdAt,
      },
    });
  }
}

async function seedApiRateLimitLogs() {
  if ((await prisma.apiRateLimitLog.count()) > 0) {
    console.log('Skipping API rate limit log seed -- rows already exist.');
    return;
  }

  faker.seed(52);
  const ENDPOINTS = ['/admin/auth/login', '/admin/users', '/admin/tickets', '/admin/analytics/track', '/admin/payments'];
  const IDENTIFIER_TYPES = ['ip', 'admin', 'platform_user'];

  const LOG_COUNT = 30;
  const logs: Prisma.ApiRateLimitLogCreateManyInput[] = [];

  for (let i = 0; i < LOG_COUNT; i++) {
    // First 3 are forced over-limit so the "a couple of rows with
    // limitExceeded: true" seed requirement is guaranteed rather than left
    // to chance, matching the seedPayments pattern for forced REFUNDED rows.
    const limitExceeded = i < 3 || faker.number.int({ min: 1, max: 100 }) <= 8;
    const identifierType = faker.helpers.arrayElement(IDENTIFIER_TYPES);

    logs.push({
      endpoint: faker.helpers.arrayElement(ENDPOINTS),
      windowStart: faker.date.recent({ days: 7 }),
      requestCount: limitExceeded ? faker.number.int({ min: 101, max: 200 }) : faker.number.int({ min: 5, max: 95 }),
      limitExceeded,
      identifierType,
      identifier: identifierType === 'ip' ? faker.internet.ipv4() : faker.string.uuid(),
    });
  }

  await prisma.apiRateLimitLog.createMany({ data: logs });
}

async function seedNotificationTemplates() {
  const templates: {
    key: string;
    channel: 'EMAIL' | 'SMS' | 'IN_APP_PUSH';
    subjectEn?: string;
    subjectBn?: string;
    bodyEn: string;
    bodyBn: string;
    variables: string[];
  }[] = [
    {
      key: 'welcome',
      channel: 'EMAIL',
      subjectEn: 'Welcome to {{appName}}!',
      subjectBn: '{{appName}}-এ স্বাগতম!',
      bodyEn: 'Hi {{userName}}, welcome aboard! Start tracking your income and expenses today.',
      bodyBn: 'হ্যালো {{userName}}, স্বাগতম! আজই আপনার আয়-ব্যয় ট্র্যাক করা শুরু করুন।',
      variables: ['userName', 'appName'],
    },
    {
      key: 'subscription_expiring',
      channel: 'EMAIL',
      subjectEn: 'Your {{planName}} subscription expires in 3 days',
      subjectBn: 'আপনার {{planName}} সাবস্ক্রিপশন ৩ দিনে শেষ হচ্ছে',
      bodyEn: 'Hi {{userName}}, your {{planName}} plan expires on {{expiryDate}}. Renew now to avoid interruption.',
      bodyBn: 'হ্যালো {{userName}}, আপনার {{planName}} প্ল্যান {{expiryDate}} তারিখে শেষ হবে। বিঘ্ন এড়াতে এখনই নবায়ন করুন।',
      variables: ['userName', 'planName', 'expiryDate'],
    },
    {
      key: 'payment_failed',
      channel: 'SMS',
      bodyEn: 'Hi {{userName}}, your payment of {{amount}} {{currency}} failed. Please update your payment method.',
      bodyBn: 'হ্যালো {{userName}}, আপনার {{amount}} {{currency}} পেমেন্ট ব্যর্থ হয়েছে। অনুগ্রহ করে আপনার পেমেন্ট মেথড আপডেট করুন।',
      variables: ['userName', 'amount', 'currency'],
    },
    {
      key: 'payment_successful',
      channel: 'EMAIL',
      subjectEn: 'Payment received -- invoice {{invoiceNumber}}',
      subjectBn: 'পেমেন্ট গৃহীত -- ইনভয়েস {{invoiceNumber}}',
      bodyEn: 'Hi {{userName}}, we received your payment of {{amount}} {{currency}}. Invoice {{invoiceNumber}} is attached.',
      bodyBn: 'হ্যালো {{userName}}, আমরা আপনার {{amount}} {{currency}} পেমেন্ট পেয়েছি। ইনভয়েস {{invoiceNumber}} সংযুক্ত।',
      variables: ['userName', 'amount', 'currency', 'invoiceNumber'],
    },
    {
      key: 'ticket_reply',
      channel: 'IN_APP_PUSH',
      bodyEn: 'Support replied to your ticket "{{ticketSubject}}". Tap to view.',
      bodyBn: 'সাপোর্ট আপনার "{{ticketSubject}}" টিকিটে উত্তর দিয়েছে। দেখতে ট্যাপ করুন।',
      variables: ['ticketSubject'],
    },
    {
      key: 'feature_announcement',
      channel: 'IN_APP_PUSH',
      bodyEn: 'New: {{featureName}} is now available. Check it out!',
      bodyBn: 'নতুন: {{featureName}} এখন উপলব্ধ। দেখে নিন!',
      variables: ['featureName'],
    },
  ];

  for (const template of templates) {
    await prisma.notificationTemplate.upsert({
      where: { key: template.key },
      update: {},
      create: template,
    });
  }
}

async function seedNotificationLogs() {
  if ((await prisma.notificationLog.count()) > 0) {
    console.log('Skipping notification log seed -- rows already exist.');
    return;
  }

  const [users, templates] = await Promise.all([
    prisma.platformUser.findMany({ select: { id: true } }),
    prisma.notificationTemplate.findMany(),
  ]);
  if (users.length === 0 || templates.length === 0) return;

  faker.seed(53);
  const LOG_COUNT = 35;
  const logs: Prisma.NotificationLogCreateManyInput[] = [];

  for (let i = 0; i < LOG_COUNT; i++) {
    const template = faker.helpers.arrayElement(templates);
    const isFailed = faker.number.int({ min: 1, max: 100 }) <= 10;
    const createdAt = faker.date.recent({ days: 20 });

    logs.push({
      platformUserId: faker.helpers.arrayElement(users).id,
      templateKey: template.key,
      channel: template.channel,
      status: isFailed ? 'FAILED' : 'SENT',
      sentAt: isFailed ? null : createdAt,
      errorMessage: isFailed
        ? faker.helpers.arrayElement(['Invalid email address', 'SMS gateway timeout', 'Push token expired'])
        : null,
      createdAt,
    });
  }

  await prisma.notificationLog.createMany({ data: logs });
}

async function seedNotificationCampaigns(superAdminId: string) {
  if ((await prisma.bulkNotificationCampaign.count()) > 0) {
    console.log('Skipping notification campaign seed -- rows already exist.');
    return;
  }

  await prisma.bulkNotificationCampaign.create({
    data: {
      title: 'Eid Sale Announcement',
      templateKey: 'feature_announcement',
      targetFilter: { status: 'ACTIVE' },
      channel: 'IN_APP_PUSH',
      status: 'DRAFT',
      createdBy: superAdminId,
    },
  });

  await prisma.bulkNotificationCampaign.create({
    data: {
      title: 'Welcome Back Reminder',
      templateKey: 'feature_announcement',
      targetFilter: {},
      channel: 'EMAIL',
      status: 'SENT',
      sentCount: 142,
      failedCount: 6,
      createdBy: superAdminId,
    },
  });

  await prisma.bulkNotificationCampaign.create({
    data: {
      title: 'Subscription Renewal Push',
      templateKey: 'subscription_expiring',
      targetFilter: { status: 'ACTIVE' },
      channel: 'SMS',
      status: 'SCHEDULED',
      scheduledFor: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      createdBy: superAdminId,
    },
  });
}

async function main() {
  const { superAdminId, supportAdminId } = await seedAdmins();
  await seedSubAdmins(superAdminId);
  const plans = await seedSubscriptionPlans();
  await seedCoupons();
  await seedPlatformUsers(plans);
  await seedPayments(plans, superAdminId);
  await seedAccountTemplatesAndCategories();
  await seedTranslations();
  await seedAnnouncements(superAdminId);
  await seedLegalDocuments(superAdminId);
  await seedTickets(superAdminId, supportAdminId);
  await seedFeatureRequests();
  const users = await prisma.platformUser.findMany({ select: { id: true } });
  await seedUsageEvents(users);
  await seedDailyActiveSnapshots();
  await seedLoginAttempts();
  await seedSuspiciousActivityFlags(superAdminId, supportAdminId);
  await seedBackupRecords(superAdminId);
  await seedFeatureFlags(superAdminId);
  await seedErrorLogs(superAdminId);
  await seedApiRateLimitLogs();
  await seedNotificationTemplates();
  await seedNotificationLogs();
  await seedNotificationCampaigns(superAdminId);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
