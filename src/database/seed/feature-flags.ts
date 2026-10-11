import type { PrismaClient } from '@prisma/client';

export async function seedFeatureFlags(prisma: PrismaClient, superAdminId: string) {
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
