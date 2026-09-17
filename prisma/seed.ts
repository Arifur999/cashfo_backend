import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { AdminRole, BillingCycle, CategoryDirection, DiscountType, LegalDocType, PrismaClient, WorkspaceType } from '@prisma/client';
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

  console.warn(
    '\n⚠️  Seeded admin accounts (admin@/support@/content@/support-admin@/finance-admin@/content-admin@example.com, ' +
      'password ChangeMe123!) share a known password -- rotate or delete every one of these before real production use.\n',
  );

  return { superAdminId: superAdmin.id, supportAdminId: supportAdmin.id };
}

// Prompt 8: additional test accounts distinct from seedAdmins()'s originals --
// mainly here because FINANCE_ADMIN never had a seeded account before this
// (Prompt 4's revenue-visibility check had no way to be tested end-to-end),
// plus more accounts for exercising the Admin Accounts management UI.
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

// Prompt 4: mirrors AccountsService.seedDefaultAccounts() (backend/src/accounts/accounts.service.ts)
// using this script's own plain PrismaClient instead of NestJS DI --
// duplicated rather than imported because seed.ts is a standalone script,
// same reasoning as it already re-implementing bcrypt hashing inline rather
// than reaching into a Nest service for it. Only called for workspaces this
// seed run actually CREATES (guarded by the existing upsert-style checks
// below), so re-running the seed never double-seeds accounts.
async function seedAccountsForBusiness(businessId: string, workspaceType: WorkspaceType) {
  const templates = await prisma.defaultAccountTemplate.findMany({
    where: { appliesTo: { has: workspaceType }, isActive: true },
    orderBy: { displayOrder: 'asc' },
  });

  const templateIdToAccountId = new Map<string, string>();
  for (const template of templates) {
    const account = await prisma.account.create({
      data: {
        businessId,
        name: template.name,
        nameBn: template.nameBn,
        accountType: template.accountType,
        accountSubtype: template.accountSubtype,
        displayOrder: template.displayOrder,
        isSystemAccount: true,
      },
    });
    templateIdToAccountId.set(template.id, account.id);
  }

  for (const template of templates) {
    if (!template.parentId) continue;
    const newParentId = templateIdToAccountId.get(template.parentId);
    const newOwnId = templateIdToAccountId.get(template.id);
    if (newParentId && newOwnId) {
      await prisma.account.update({ where: { id: newOwnId }, data: { parentId: newParentId } });
    }
  }
}

// End-user app (Prompt 1): seeds real User accounts (distinct from
// PlatformUser, which was only ever the admin panel's own separate,
// demo-data read-model -- see AdminOwnersService/AdminWorkspacesService for
// the real replacements built later) plus their Business workspaces, so a
// fresh dev setup has real accounts to log in as. These ARE real,
// functioning logins (not synthetic display data) but are still seed-created
// test fixtures sharing one known password -- rotate or delete them the same
// way as the seeded admin accounts before any real production use.
async function seedEndUserAppAccounts(plans: { id: string; slug: string }[]) {
  const freePlan = plans.find((p) => p.slug === 'free');
  const proPlan = plans.find((p) => p.slug === 'monthly-pro');
  const passwordHash = await bcrypt.hash('ChangeMe123!', 10);

  const testUsers: { name: string; email: string; preferredLanguage: 'EN' | 'BN'; secondBusiness?: boolean }[] = [
    { name: 'Rafiqul Islam', email: 'rafiqul.islam@example.com', preferredLanguage: 'EN' },
    { name: 'নুসরাত জাহান', email: 'nusrat.jahan@example.com', preferredLanguage: 'BN' },
    // Gets a second, BUSINESS-type workspace below to exercise the
    // multi-workspace case -- also the one seeded onto the paid plan.
    { name: 'Tanvir Ahmed', email: 'tanvir.ahmed@example.com', preferredLanguage: 'EN', secondBusiness: true },
    { name: 'শিরিন আক্তার', email: 'shirin.akter@example.com', preferredLanguage: 'BN' },
  ];

  for (const testUser of testUsers) {
    const user = await prisma.user.upsert({
      where: { email: testUser.email },
      update: {},
      create: {
        name: testUser.name,
        email: testUser.email,
        passwordHash,
        preferredLanguage: testUser.preferredLanguage,
      },
    });

    let defaultBusiness = await prisma.business.findFirst({ where: { ownerId: user.id, isDefault: true } });
    if (!defaultBusiness) {
      defaultBusiness = await prisma.business.create({
        data: {
          ownerId: user.id,
          name: 'Personal',
          type: WorkspaceType.PERSONAL,
          isDefault: true,
          planId: testUser.secondBusiness ? proPlan?.id : freePlan?.id,
          members: { create: { userId: user.id, role: 'OWNER' } },
        },
      });
    }
    // Checked by account count, not "was this business just created" --
    // Prompt 4 added account-seeding after these test users already existed
    // from Prompt 1's original seed run, so this also retroactively backfills
    // accounts for a business that predates this function ever seeding them.
    if ((await prisma.account.count({ where: { businessId: defaultBusiness.id } })) === 0) {
      await seedAccountsForBusiness(defaultBusiness.id, WorkspaceType.PERSONAL);
    }

    if (testUser.secondBusiness) {
      let secondBusiness = await prisma.business.findFirst({
        where: { ownerId: user.id, type: WorkspaceType.BUSINESS },
      });
      if (!secondBusiness) {
        secondBusiness = await prisma.business.create({
          data: {
            ownerId: user.id,
            name: `${testUser.name}'s Shop`,
            type: WorkspaceType.BUSINESS,
            isDefault: false,
            planId: proPlan?.id,
            members: { create: { userId: user.id, role: 'OWNER' } },
          },
        });
      }
      if ((await prisma.account.count({ where: { businessId: secondBusiness.id } })) === 0) {
        await seedAccountsForBusiness(secondBusiness.id, WorkspaceType.BUSINESS);
      }
    }
  }

  console.warn('\n⚠️  4 end-user test accounts created (password ChangeMe123! for all) -- rafiqul.islam@, nusrat.jahan@, tanvir.ahmed@, shirin.akter@example.com.\n');
}

async function main() {
  const { superAdminId } = await seedAdmins();
  await seedSubAdmins(superAdminId);
  const plans = await seedSubscriptionPlans();
  await seedCoupons();
  await seedAccountTemplatesAndCategories();
  await seedTranslations();
  await seedLegalDocuments(superAdminId);
  await seedFeatureFlags(superAdminId);
  await seedNotificationTemplates();
  await seedEndUserAppAccounts(plans);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
