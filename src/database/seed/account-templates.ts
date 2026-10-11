import { WorkspaceType, type CategoryDirection, type PrismaClient } from '@prisma/client';

export async function seedAccountTemplatesAndCategories(prisma: PrismaClient) {
  if ((await prisma.defaultAccountTemplate.count()) > 0) {
    console.log('Skipping account template seed -- rows already exist.');
    return;
  }

  const BOTH: WorkspaceType[] = [WorkspaceType.PERSONAL, WorkspaceType.BUSINESS];

  await prisma.defaultAccountTemplate.create({
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
