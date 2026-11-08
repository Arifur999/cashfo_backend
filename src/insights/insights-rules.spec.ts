import { affordAnswer, happenings, type InsightInputs, owedAnswer, spendAnswer, summary, todos, ways } from './insights-rules.js';

const TK = (taka: number) => taka * 100;

// October was the summary month; today is 7 November.
const inputs = (over: Partial<InsightInputs> = {}): InsightInputs => ({
  today: '2026-11-07',
  expense: [
    { month: '2026-08', category: 'Food & Dining', amount: TK(15_900) },
    { month: '2026-09', category: 'Food & Dining', amount: TK(14_400) },
    { month: '2026-10', category: 'Food & Dining', amount: TK(16_800) },
    { month: '2026-09', category: 'Transport', amount: TK(5_000) },
    { month: '2026-10', category: 'Transport', amount: TK(5_200) },
    { month: '2026-09', category: 'Bills & Utilities', amount: TK(1_500) },
    { month: '2026-08', category: 'Bills & Utilities', amount: TK(1_600) },
    { month: '2026-10', category: 'Bills & Utilities', amount: TK(1_550) },
    { month: '2026-11', category: 'Bills & Utilities', amount: TK(2_150) },
    { month: '2026-09', category: 'House Rent', amount: TK(34_000) },
    { month: '2026-10', category: 'House Rent', amount: TK(28_750) },
  ],
  income: [
    { month: '2026-09', category: 'Salary', amount: TK(85_000) },
    { month: '2026-10', category: 'Salary', amount: TK(85_000) },
    { month: '2026-08', category: 'Salary', amount: TK(85_000) },
  ],
  icons: new Map([
    ['Food & Dining', 'food'],
    ['Transport', 'car'],
    ['Bills & Utilities', 'service'],
    ['House Rent', 'home'],
  ]),
  budgetsNow: [
    { name: 'Shopping', limit: TK(4_500), spent: TK(4_400) },
    { name: 'Transport', limit: TK(10_000), spent: TK(2_000) },
  ],
  budgetsThen: [{ name: 'Transport', limit: TK(10_000), spent: TK(5_200) }],
  goals: [{ id: 'g1', name: 'iPhone', target: TK(150_000), saved: TK(15_000), targetDate: '2027-03-31', behind: true, inThisMonth: 0 }],
  owed: [
    { contactId: 'c1', name: 'Karim Traders', amount: TK(70_000), lastDate: '2026-07-01' },
    { contactId: 'c2', name: 'Rahim', amount: TK(45_000), lastDate: '2026-10-20' },
  ],
  biggestIncome: { category: 'Salary', amount: TK(85_000), date: '2026-10-01' },
  reads: { transactions: true, savings: true, loans: true },
  ...over,
});

describe('insights rules', () => {
  it('sums up the month: kept, its share, spending against the month before, the biggest spend', () => {
    expect(summary(inputs(), '2026-10')).toEqual({
      month: '2026-10',
      previous: '2026-09',
      income: TK(85_000),
      expenses: TK(52_300),
      kept: TK(32_700),
      keptPercent: 38,
      spentChange: -5,
      biggest: { name: 'House Rent', amount: TK(28_750) },
      mood: 'good',
    });
    expect(summary(inputs({ income: [] }), '2026-10').mood).toBe('tight');
    expect(summary(inputs({ income: [], expense: [] }), '2026-10').mood).toBe('quiet');
  });

  it('lists one to-do of each kind: a budget nearly used, a bill above usual, a goal behind, money owed and quiet', () => {
    const list = todos(inputs());
    expect(list.map((todo) => todo.kind)).toEqual(['budget', 'bill', 'goal', 'owed']);
    expect(list[0]).toMatchObject({ name: 'Shopping', left: TK(100), over: false });
    expect(list[1]).toMatchObject({ name: 'Bills & Utilities', now: TK(2_150), usual: TK(1_550) });
    expect(list[2]).toMatchObject({ name: 'iPhone', perMonth: TK(33_800), nothingIn: true });
    expect(list[3]).toMatchObject({ name: 'Karim Traders', amount: TK(70_000), months: 4 });
    expect(todos(inputs({ reads: { transactions: false, savings: false, loans: true } })).map((todo) => todo.kind)).toEqual(['owed']);
  });

  it('says what happened: the share kept against the month before, the category that rose, a budget kept, the biggest income', () => {
    const list = happenings(inputs(), '2026-10');
    expect(list).toEqual([
      { tone: 'good', kind: 'kept', percent: 38, before: 35, previous: '2026-09' },
      { tone: 'watch', kind: 'rose', name: 'Food & Dining', by: TK(2_400), previous: '2026-09' },
      { tone: 'good', kind: 'inside', name: 'Transport', left: TK(4_800) },
      { tone: 'info', kind: 'income', name: 'Salary', amount: TK(85_000), date: '2026-10-01' },
    ]);
  });

  it('suggests a tip per kind of spending from the last three months, biggest first', () => {
    const list = ways(inputs(), '2026-10');
    expect(list.map((way) => [way.tip, way.name, way.perMonth])).toEqual([
      ['eatOut', 'Food & Dining', TK(3_100)],
      ['ride', 'Transport', TK(500)],
      ['power', 'Bills & Utilities', TK(200)],
    ]);
  });

  it('answers the suggested questions from the same figures', () => {
    expect(spendAnswer(inputs(), '2026-10')).toMatchObject({ name: 'Food & Dining', total: TK(47_100), perMonth: TK(15_700), highest: '2026-10' });
    const afford = affordAnswer(inputs(), '2026-10');
    expect(afford).toMatchObject({ verdict: 'slow', amount: TK(30_000) });
    expect(owedAnswer(inputs())).toMatchObject({ count: 2, total: TK(115_000), quiet: { name: 'Karim Traders', months: 4 } });
    expect(owedAnswer(inputs({ reads: { transactions: true, savings: true, loans: false } }))).toBeNull();
  });
});

describe('insights rules without a category', () => {
  it('keeps uncategorised money out of the advice, but not out of the totals', () => {
    const plain = inputs({ expense: [{ month: '2026-10', category: 'Uncategorised', amount: TK(5_000) }], icons: new Map() });
    expect(summary(plain, '2026-10')).toMatchObject({ expenses: TK(5_000), biggest: { name: 'Uncategorised' } });
    expect(ways(plain, '2026-10')).toEqual([]);
    expect(spendAnswer(plain, '2026-10')).toBeNull();
  });
});
