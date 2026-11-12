import { BudgetCategoryType, WorkspaceType } from '@prisma/client';

// The categories the app files money under by itself. A customer can't make
// or rename a category to one of these names, so their own money never mixes
// with what the app filed.

// Zakat paid on the Zakat page (ZakatService keeps the category itself).
export const ZAKAT_CATEGORY = 'Zakat';

// A cash gift given at an event, when it is added to Transactions
// (EventsService makes the category on first use). Not reserved: a
// customer's own "Gifts" is the same money.
export const GIFTS_CATEGORY = 'Gifts';

// A charge (a bank or service fee) paid with a transfer or a loan entry:
// CHARGE_CATEGORY unless another built-in one or an expense category of the
// workspace was picked.
export const CHARGE_CATEGORY = 'Bank charge';
export const BUILT_IN_CHARGE_CATEGORIES = [CHARGE_CATEGORY, 'Mobile banking fee', 'Service charge'];

// The transfer popup's last charge choice. Not reserved, like GIFTS_CATEGORY:
// a customer's own "Other" expense category is the same money.
export const OTHER_CHARGE_CATEGORY = 'Other';

// Every name a charge can be filed under without a category row of its own.
export const CHARGE_CATEGORIES = [...BUILT_IN_CHARGE_CATEGORIES, OTHER_CHARGE_CATEGORY];

// Money with no category at all is read under this name (ReportsService).
export const UNCATEGORISED = 'Uncategorised';

const RESERVED = new Set([ZAKAT_CATEGORY, ...BUILT_IN_CHARGE_CATEGORIES, UNCATEGORISED].map((name) => name.toLowerCase()));

export const isReservedCategoryName = (name: string): boolean => RESERVED.has(name.trim().toLowerCase());

// What a new workspace starts with, so its first income or expense has
// somewhere to go; they are the customer's own from then on (renamed,
// deleted). English names: the app shows them in the reader's language.
type Starter = { type: BudgetCategoryType; name: string; color: string; icon: string };

export const STARTER_CATEGORIES: Partial<Record<WorkspaceType, Starter[]>> = {
  PERSONAL: [
    { type: 'INCOME', name: 'Salary', color: 'teal', icon: 'salary' },
    { type: 'INCOME', name: 'Freelance', color: 'cyan', icon: 'service' },
    { type: 'INCOME', name: 'Business', color: 'indigo', icon: 'commission' },
    { type: 'INCOME', name: 'Gift', color: 'pink', icon: 'gift' },
    { type: 'EXPENSE', name: 'Food & Dining', color: 'orange', icon: 'food' },
    { type: 'EXPENSE', name: 'House Rent', color: 'purple', icon: 'home' },
    { type: 'EXPENSE', name: 'Transport', color: 'blue', icon: 'car' },
    { type: 'EXPENSE', name: 'Bills & Utilities', color: 'yellow', icon: 'service' },
    { type: 'EXPENSE', name: 'Health', color: 'red', icon: 'health' },
    { type: 'EXPENSE', name: 'Shopping', color: 'pink', icon: 'shopping' },
    { type: 'EXPENSE', name: 'Education', color: 'teal', icon: 'education' },
  ],
  BUSINESS: [
    { type: 'INCOME', name: 'Sales', color: 'green', icon: 'shopping-cart' },
    { type: 'INCOME', name: 'Services', color: 'teal', icon: 'service' },
    { type: 'INCOME', name: 'Other income', color: 'cyan', icon: 'commission' },
    { type: 'EXPENSE', name: 'Purchases', color: 'orange', icon: 'shopping-bag' },
    { type: 'EXPENSE', name: 'Shop rent', color: 'purple', icon: 'home' },
    { type: 'EXPENSE', name: 'Salaries', color: 'blue', icon: 'salary' },
    { type: 'EXPENSE', name: 'Bills & Utilities', color: 'yellow', icon: 'service' },
    { type: 'EXPENSE', name: 'Transport', color: 'indigo', icon: 'car' },
    { type: 'EXPENSE', name: 'Marketing', color: 'pink', icon: 'sparkles' },
  ],
};

// Adds the starter categories the workspace doesn't have yet (by type and
// name), after its own; how many were added. Safe to run again.
export async function seedStarterCategories(
  client: {
    budgetCategory: {
      findMany(args: { where: { businessId: string }; select: { type: true; name: true } }): Promise<{ type: BudgetCategoryType; name: string }[]>;
      createMany(args: {
        data: { businessId: string; type: BudgetCategoryType; name: string; color: string; icon: string; displayOrder: number }[];
        skipDuplicates: boolean;
      }): Promise<{ count: number }>;
    };
  },
  businessId: string,
  workspaceType: WorkspaceType,
): Promise<number> {
  const starters = STARTER_CATEGORIES[workspaceType] ?? [];
  if (!starters.length) return 0;
  const existing = await client.budgetCategory.findMany({ where: { businessId }, select: { type: true, name: true } });
  const have = new Set(existing.map((category) => `${category.type}:${category.name.toLowerCase()}`));
  const order = { INCOME: existing.filter((c) => c.type === 'INCOME').length, EXPENSE: existing.filter((c) => c.type === 'EXPENSE').length };
  const data = starters
    .filter((starter) => !have.has(`${starter.type}:${starter.name.toLowerCase()}`))
    .map((starter) => ({ businessId, type: starter.type, name: starter.name, color: starter.color, icon: starter.icon, displayOrder: order[starter.type]++ }));
  if (!data.length) return 0;
  // skipDuplicates: two first reads at once never fail on the unique name.
  const created = await client.budgetCategory.createMany({ data, skipDuplicates: true });
  return created.count;
}
