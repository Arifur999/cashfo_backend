import type { LegalDocType, PrismaClient } from '@prisma/client';

export async function seedTranslations(prisma: PrismaClient) {
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

export async function seedLegalDocuments(prisma: PrismaClient, adminId: string) {
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

export async function seedNotificationTemplates(prisma: PrismaClient) {
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
