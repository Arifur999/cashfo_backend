// AI Insights without a model: the summary, the to-dos, what happened and
// the ways to save, worked out by plain rules from a workspace's own
// figures. Pure, so the rules are tested; every amount is in paisa and
// every month a 'YYYY-MM' key. The app writes the sentences in the
// reader's language from these facts.

export interface MonthMoney {
  month: string;
  category: string;
  amount: number;
}

export interface BudgetFact {
  name: string;
  limit: number | null;
  spent: number;
}

export interface GoalFact {
  id: string;
  name: string;
  target: number;
  saved: number;
  targetDate: string | null;
  behind: boolean;
  // Put in this month so far.
  inThisMonth: number;
}

export interface OwedFact {
  contactId: string;
  name: string;
  amount: number;
  // The day of their newest entry, or null for none.
  lastDate: string | null;
}

export interface IncomeFact {
  category: string;
  amount: number;
  date: string;
}

export interface InsightInputs {
  // Today on the Dhaka calendar, 'YYYY-MM-DD'.
  today: string;
  // Money by month and category, from six months before the summary month
  // through the current month.
  expense: MonthMoney[];
  income: MonthMoney[];
  // Each expense category's icon (what kind of spending it is).
  icons: Map<string, string | null>;
  // The current month's budgets, and the summary month's.
  budgetsNow: BudgetFact[];
  budgetsThen: BudgetFact[];
  goals: GoalFact[];
  owed: OwedFact[];
  // The summary month's biggest single income.
  biggestIncome: IncomeFact | null;
  reads: { transactions: boolean; savings: boolean; loans: boolean };
}

export const shiftMonth = (key: string, by: number): string => {
  const [year, month] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + by, 1)).toISOString().slice(0, 7);
};

const sumOf = (rows: MonthMoney[], month: string, category?: string) =>
  rows.reduce((sum, row) => (row.month === month && (category === undefined || row.category === category) ? sum + row.amount : sum), 0);

const categoriesOf = (rows: MonthMoney[]) => [...new Set(rows.map((row) => row.category))];

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

// Rounded to the nearest 100 taka, the way the advice says amounts.
const roughly = (paisa: number) => Math.round(paisa / 10_000) * 10_000;

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

// ---- The summary (the last whole month)

export type Mood = 'good' | 'okay' | 'tight' | 'quiet';

export function summary(inputs: InsightInputs, month: string) {
  const previous = shiftMonth(month, -1);
  const income = sumOf(inputs.income, month);
  const expenses = sumOf(inputs.expense, month);
  const kept = income - expenses;
  const previousExpenses = sumOf(inputs.expense, previous);
  const biggest = categoriesOf(inputs.expense)
    .map((category) => ({ name: category, amount: sumOf(inputs.expense, month, category) }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount)[0];
  const keptPercent = percent(kept, income);
  const mood: Mood = income === 0 && expenses === 0 ? 'quiet' : kept < 0 ? 'tight' : (keptPercent ?? 0) >= 20 ? 'good' : 'okay';
  return {
    month,
    previous,
    income,
    expenses,
    kept,
    keptPercent,
    // How much more (+) or less (−) was spent than the month before, in %.
    spentChange: previousExpenses > 0 ? Math.round(((expenses - previousExpenses) / previousExpenses) * 100) : null,
    biggest: biggest ?? null,
    mood,
  };
}

// ---- What to do next (now)

export type Todo =
  | { kind: 'budget'; key: string; name: string; spent: number; limit: number; left: number; over: boolean }
  | { kind: 'bill'; key: string; name: string; now: number; usual: number }
  | { kind: 'goal'; key: string; id: string; name: string; perMonth: number; nothingIn: boolean }
  | { kind: 'owed'; key: string; contactId: string; name: string; amount: number; months: number | null };

const ALMOST_USED = 0.9;
const HIGHER_BY = 1.25;
const USUAL_AT_LEAST = 50_000;
const HIGHER_AT_LEAST = 30_000;
const QUIET_MONTHS = 2;

function monthsLeft(today: string, targetDate: string): number {
  const [ty, tm] = today.split('-').map(Number);
  const [gy, gm] = targetDate.split('-').map(Number);
  return Math.max(1, (gy - ty) * 12 + (gm - tm));
}

// One of each, the most pressing, in the board's order: a budget nearly
// (or over) used, a bill higher than usual, a goal falling behind, money
// owed with nothing paid for months.
export function todos(inputs: InsightInputs): Todo[] {
  const list: Todo[] = [];
  const thisMonth = inputs.today.slice(0, 7);
  if (inputs.reads.transactions) {
    const tight = inputs.budgetsNow
      .filter((row): row is BudgetFact & { limit: number } => row.limit !== null && row.limit > 0 && row.spent >= row.limit * ALMOST_USED)
      .sort((a, b) => b.spent / b.limit - a.spent / a.limit)[0];
    if (tight) list.push({ kind: 'budget', key: `budget:${tight.name}:${thisMonth}`, name: tight.name, spent: tight.spent, limit: tight.limit, left: Math.max(0, tight.limit - tight.spent), over: tight.spent > tight.limit });

    const usualMonths = [1, 2, 3].map((back) => shiftMonth(thisMonth, -back));
    const bill = categoriesOf(inputs.expense)
      .filter((name) => name !== tight?.name)
      .map((name) => ({ name, now: sumOf(inputs.expense, thisMonth, name), usual: Math.round(usualMonths.reduce((sum, month) => sum + sumOf(inputs.expense, month, name), 0) / usualMonths.length) }))
      .filter((row) => row.usual >= USUAL_AT_LEAST && row.now >= row.usual * HIGHER_BY && row.now - row.usual >= HIGHER_AT_LEAST)
      .sort((a, b) => b.now - b.usual - (a.now - a.usual))[0];
    if (bill) list.push({ kind: 'bill', key: `bill:${bill.name}:${thisMonth}`, name: bill.name, now: bill.now, usual: bill.usual });
  }
  if (inputs.reads.savings) {
    const goal = inputs.goals
      .filter((row) => row.behind && row.targetDate !== null && row.target > row.saved)
      .map((row) => ({ ...row, perMonth: roughly((row.target - row.saved) / monthsLeft(inputs.today, row.targetDate!)) }))
      .sort((a, b) => b.perMonth - a.perMonth)[0];
    if (goal) list.push({ kind: 'goal', key: `goal:${goal.id}:${thisMonth}`, id: goal.id, name: goal.name, perMonth: goal.perMonth, nothingIn: goal.inThisMonth === 0 });
  }
  if (inputs.reads.loans) {
    const owed = inputs.owed
      .filter((row) => row.amount > 0)
      .map((row) => ({ ...row, months: row.lastDate ? Math.floor(daysBetween(row.lastDate, inputs.today) / 30) : null }))
      .filter((row) => row.months === null || row.months >= QUIET_MONTHS)
      .sort((a, b) => b.amount - a.amount)[0];
    if (owed) list.push({ kind: 'owed', key: `owed:${owed.contactId}:${thisMonth}`, contactId: owed.contactId, name: owed.name, amount: owed.amount, months: owed.months });
  }
  return list;
}

// ---- What happened (the summary month against the one before)

export type Happening =
  | { tone: 'good' | 'watch'; kind: 'kept'; percent: number; before: number | null; previous: string }
  | { tone: 'watch'; kind: 'overspent'; amount: number }
  | { tone: 'watch'; kind: 'rose'; name: string; by: number; previous: string }
  | { tone: 'good'; kind: 'inside'; name: string; left: number }
  | { tone: 'info'; kind: 'income'; name: string; amount: number; date: string };

const ROSE_AT_LEAST = 50_000;
const INSIDE_SHARE = 0.6;

export function happenings(inputs: InsightInputs, month: string): Happening[] {
  if (!inputs.reads.transactions) return [];
  const list: Happening[] = [];
  const now = summary(inputs, month);
  const before = summary(inputs, now.previous);
  if (now.kept < 0) list.push({ tone: 'watch', kind: 'overspent', amount: -now.kept });
  else if (now.keptPercent !== null) {
    const tone = before.keptPercent !== null && now.keptPercent < before.keptPercent ? 'watch' : 'good';
    list.push({ tone, kind: 'kept', percent: now.keptPercent, before: before.keptPercent, previous: now.previous });
  }
  const rose = categoriesOf(inputs.expense)
    .map((name) => ({ name, now: sumOf(inputs.expense, month, name), earlier: sumOf(inputs.expense, now.previous, name) }))
    .map((row) => ({ ...row, by: row.now - row.earlier }))
    .filter((row) => row.earlier > 0 && row.by >= ROSE_AT_LEAST && row.by >= row.earlier * 0.1)
    .sort((a, b) => b.by - a.by)[0];
  if (rose) list.push({ tone: 'watch', kind: 'rose', name: rose.name, by: rose.by, previous: now.previous });
  const inside = inputs.budgetsThen
    .filter((row): row is BudgetFact & { limit: number } => row.limit !== null && row.limit > 0 && row.spent > 0 && row.spent <= row.limit * INSIDE_SHARE)
    .sort((a, b) => b.limit - b.spent - (a.limit - a.spent))[0];
  if (inside) list.push({ tone: 'good', kind: 'inside', name: inside.name, left: inside.limit - inside.spent });
  if (inputs.biggestIncome) list.push({ tone: 'info', kind: 'income', name: inputs.biggestIncome.category, amount: inputs.biggestIncome.amount, date: inputs.biggestIncome.date });
  return list;
}

// ---- Easy ways to save (from the last three whole months)

export type WayTip = 'eatOut' | 'ride' | 'bulk' | 'list' | 'power' | 'less';

const TIP_OF: [WayTip, string[], number][] = [
  ['eatOut', ['food', 'coffee', 'utensils', 'pizza', 'cookie', 'cake', 'beer', 'restaurant'], 0.2],
  ['ride', ['car', 'bus', 'bike', 'fuel', 'train', 'taxi'], 0.15],
  ['bulk', ['shopping-cart', 'basket', 'grocery', 'apple', 'carrot'], 0.08],
  ['list', ['shopping', 'shopping-bag', 'shirt', 'gift'], 0.15],
  ['power', ['service', 'bolt', 'zap', 'lightbulb', 'plug', 'droplet', 'wifi'], 0.1],
];
const LESS_SHARE = 0.1;
const WAY_AT_LEAST = 10_000;

export interface Way {
  key: string;
  tip: WayTip;
  name: string;
  perMonth: number;
}

export function ways(inputs: InsightInputs, month: string): Way[] {
  if (!inputs.reads.transactions) return [];
  const months = [0, -1, -2].map((back) => shiftMonth(month, back));
  const biggestFirst = categoriesOf(inputs.expense)
    .map((name) => ({ name, average: months.reduce((sum, key) => sum + sumOf(inputs.expense, key, name), 0) / months.length }))
    .filter((row) => row.average > 0)
    .sort((a, b) => b.average - a.average);
  // The biggest categories, each with its own tip (one of a kind, except
  // the plain "spend a little less").
  const picked: Way[] = [];
  const used = new Set<WayTip>();
  for (const row of biggestFirst) {
    const icon = inputs.icons.get(row.name) ?? '';
    const match = TIP_OF.find(([, icons]) => icons.includes(icon));
    const tip: WayTip = match ? match[0] : 'less';
    const perMonth = roughly(row.average * (match ? match[2] : LESS_SHARE));
    if (perMonth < WAY_AT_LEAST || (tip !== 'less' && used.has(tip))) continue;
    used.add(tip);
    picked.push({ key: `${tip}:${row.name}`, tip, name: row.name, perMonth });
    if (picked.length === 3) break;
  }
  return picked;
}

// ---- Answers to the suggested questions

export function spendAnswer(inputs: InsightInputs, month: string) {
  if (!inputs.reads.transactions) return null;
  const months = [-2, -1, 0].map((back) => shiftMonth(month, back));
  const top = categoriesOf(inputs.expense)
    .map((name) => ({ name, total: months.reduce((sum, key) => sum + sumOf(inputs.expense, key, name), 0) }))
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total)[0];
  if (!top) return null;
  const bars = months.map((key) => ({ month: key, amount: sumOf(inputs.expense, key, top.name) }));
  const highest = [...bars].sort((a, b) => b.amount - a.amount)[0];
  return { name: top.name, total: top.total, perMonth: Math.round(top.total / months.length), months: bars, highest: highest.month };
}

export function affordAnswer(inputs: InsightInputs, month: string) {
  if (!inputs.reads.transactions) return null;
  const months = [-2, -1, 0].map((back) => shiftMonth(month, back));
  const keptAverage = Math.round(months.reduce((sum, key) => sum + sumOf(inputs.income, key) - sumOf(inputs.expense, key), 0) / months.length);
  // A round sum near what is usually left, at least ৳5,000.
  const amount = Math.max(500_000, Math.floor((Math.max(keptAverage, 0) * 0.8) / 500_000) * 500_000);
  const goalsMonthly = inputs.reads.savings
    ? inputs.goals.filter((goal) => goal.targetDate !== null && goal.target > goal.saved).reduce((sum, goal) => sum + (goal.target - goal.saved) / monthsLeft(inputs.today, goal.targetDate!), 0)
    : 0;
  const free = keptAverage - Math.round(goalsMonthly);
  const verdict = amount <= free ? 'yes' : amount <= keptAverage ? 'slow' : 'wait';
  const spare = verdict === 'slow' ? free : keptAverage;
  const waitMonths = spare > 0 ? Math.ceil(amount / spare) : null;
  return { amount, keptAverage: Math.max(keptAverage, 0), goals: Math.round(goalsMonthly), verdict, waitUntil: waitMonths && waitMonths <= 12 ? shiftMonth(inputs.today.slice(0, 7), waitMonths) : null } as const;
}

export function owedAnswer(inputs: InsightInputs) {
  if (!inputs.reads.loans) return null;
  const people = inputs.owed.filter((row) => row.amount > 0).sort((a, b) => b.amount - a.amount);
  const quiet = people
    .map((row) => ({ name: row.name, months: row.lastDate ? Math.floor(daysBetween(row.lastDate, inputs.today) / 30) : null }))
    .filter((row) => row.months !== null && row.months >= QUIET_MONTHS)
    .sort((a, b) => (b.months ?? 0) - (a.months ?? 0))[0];
  return { count: people.length, total: people.reduce((sum, row) => sum + row.amount, 0), people: people.slice(0, 5).map(({ contactId, name, amount }) => ({ contactId, name, amount })), quiet: quiet ?? null };
}
